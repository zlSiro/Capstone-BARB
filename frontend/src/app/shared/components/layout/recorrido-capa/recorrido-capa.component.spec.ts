import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nService } from '../../../../core/i18n/i18n.service';
import { AuthService } from '../../../../core/services/auth.service';
import { RecorridosService } from '../../../../features/ayuda/recorridos.service';
import { RecorridoCapaComponent } from './recorrido-capa.component';

function montar(role = 'tecnico', url = '/work-orders') {
  const router = {
    url,
    navigateByUrl: vi.fn(async (u: string) => {
      router.url = u;
      return true;
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router },
      { provide: AuthService, useValue: { user: signal({ id: 1, name: 'Ana', role }), privilegiosPendientes: signal(false) } },
    ],
  });
  const fixture = TestBed.createComponent(RecorridoCapaComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, r: TestBed.inject(RecorridosService), i18n: TestBed.inject(I18nService) };
}

const q = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

async function iniciar(ctx: ReturnType<typeof montar>, id = 'iniciar_enviar', origen?: HTMLElement) {
  ctx.r.iniciar(id, origen);
  await vi.advanceTimersByTimeAsync(10);
  ctx.fixture.detectChanges();
}

function marca(objetivo: string, etiqueta = 'div'): HTMLElement {
  const el = document.createElement(etiqueta);
  el.setAttribute('data-tour', objetivo);
  document.body.appendChild(el);
  return el;
}

describe('RecorridoCapaComponent (burbuja del recorrido guiado)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.setItem('barb.lang', 'es');
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });

  it('sin recorrido activo no dibuja nada', () => {
    const { el } = montar();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(q(el, 'recorrido-velo')).toBeNull();
  });

  it('muestra «Paso n de total», el título y el texto del paso, con barra de avance', async () => {
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    expect(q(ctx.el, 'recorrido-paso')!.textContent).toContain('Paso 1 de 5');
    expect(q(ctx.el, 'recorrido-paso')!.textContent).toContain('Iniciar y enviar a validación una OT');
    expect(q(ctx.el, 'recorrido-titulo')!.textContent).toContain('Abre «Órdenes de trabajo»');
    expect(q(ctx.el, 'recorrido-texto')!.textContent).toContain('órdenes que tienes asignadas');
    const barra = ctx.el.querySelector('[role="progressbar"]')!;
    expect(barra.getAttribute('aria-valuenow')).toBe('1');
    expect(barra.getAttribute('aria-valuemax')).toBe('5');
  });

  it('es un diálogo con aria-labelledby apuntando a su título', async () => {
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    const dialogo = ctx.el.querySelector('[role="dialog"]')!;
    const titulo = q(ctx.el, 'recorrido-titulo')!;
    expect(dialogo.getAttribute('aria-labelledby')).toBe(titulo.id);
  });

  it('el elemento se resalta con un borde (no solo color) y el velo no captura clics', async () => {
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    const resaltado = q(ctx.el, 'recorrido-resaltado')!;
    expect(resaltado.className).toContain('border-[3px]');
    expect(resaltado.className).toContain('border-senal');
    expect(resaltado.className).toContain('pointer-events-none');
    expect(resaltado.style.boxShadow).toContain('var(--velo)');
  });

  it('un paso sin elemento (o sin objetivo) usa un velo completo y la burbuja centrada', async () => {
    const ctx = montar();
    await iniciar(ctx, 'reportar_falla');
    ctx.r.siguiente(); // paso 2 sin objetivo
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'recorrido-velo')).not.toBeNull();
    expect(q(ctx.el, 'recorrido-resaltado')).toBeNull();
    expect(q(ctx.el, 'recorrido-burbuja')!.className).toContain('-translate-x-1/2');
  });

  it('si el elemento no aparece muestra el aviso traducido y sigue pudiéndose avanzar', async () => {
    const ctx = montar();
    ctx.r.iniciar('iniciar_enviar');
    await vi.advanceTimersByTimeAsync(3_500);
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'recorrido-sin-elemento')!.textContent).toContain('No encontré este elemento');
    expect(q(ctx.el, 'recorrido-siguiente')!.hasAttribute('disabled')).toBe(false);
  });

  it('«Siguiente», «Anterior» y «Terminar» funcionan; «Anterior» está deshabilitado en el primer paso', async () => {
    marca('ot-fila');
    marca('ot-estado');
    const ctx = montar();
    await iniciar(ctx);
    expect(q(ctx.el, 'recorrido-anterior')!.hasAttribute('disabled')).toBe(true);

    q(ctx.el, 'recorrido-siguiente')!.click();
    await vi.advanceTimersByTimeAsync(10);
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'recorrido-paso')!.textContent).toContain('Paso 2 de 5');
    expect(q(ctx.el, 'recorrido-anterior')!.hasAttribute('disabled')).toBe(false);

    q(ctx.el, 'recorrido-anterior')!.click();
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'recorrido-paso')!.textContent).toContain('Paso 1 de 5');

    for (let i = 0; i < 4; i++) {
      q(ctx.el, 'recorrido-siguiente')!.click();
      ctx.fixture.detectChanges();
    }
    expect(q(ctx.el, 'recorrido-siguiente')!.textContent!.trim()).toBe('Terminar');
    q(ctx.el, 'recorrido-siguiente')!.click();
    ctx.fixture.detectChanges();
    expect(ctx.el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('«Salir del recorrido» y la X lo cierran', async () => {
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    q(ctx.el, 'recorrido-salir')!.click();
    ctx.fixture.detectChanges();
    expect(ctx.el.querySelector('[role="dialog"]')).toBeNull();

    await iniciar(ctx);
    q(ctx.el, 'recorrido-cerrar')!.click();
    ctx.fixture.detectChanges();
    expect(ctx.el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Esc lo cierra', async () => {
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    ctx.fixture.detectChanges();
    expect(ctx.r.activo()).toBeNull();
    expect(ctx.el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('el foco entra en la burbuja al empezar y vuelve al botón que lo inició al salir', async () => {
    marca('ot-fila');
    const ctx = montar();
    const boton = document.createElement('button');
    document.body.appendChild(boton);
    boton.focus();

    await iniciar(ctx, 'iniciar_enviar', boton);
    await vi.advanceTimersByTimeAsync(10);
    expect(document.activeElement).toBe(q(ctx.el, 'recorrido-burbuja'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    ctx.fixture.detectChanges();
    expect(document.activeElement).toBe(boton);
  });

  it('cada cambio de paso se anuncia en una región aria-live', async () => {
    marca('ot-fila');
    marca('ot-estado');
    const ctx = montar();
    await iniciar(ctx);
    const region = q(ctx.el, 'recorrido-anuncio')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Paso 1 de 5');

    q(ctx.el, 'recorrido-siguiente')!.click();
    await vi.advanceTimersByTimeAsync(10);
    ctx.fixture.detectChanges();
    expect(region.textContent).toContain('Paso 2 de 5');
    expect(region.textContent).toContain('Elige la OT');
  });

  it('sugiere «hacerlo de verdad» solo cuando lo resaltado es un control', async () => {
    marca('ot-fila', 'div');
    marca('ot-estado', 'select');
    const ctx = montar();
    await iniciar(ctx);
    expect(q(ctx.el, 'recorrido-sugerencia')).toBeNull(); // la tabla no es un control
    ctx.r.siguiente();
    ctx.r.siguiente(); // paso 3: el selector de estado
    await vi.advanceTimersByTimeAsync(10);
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'recorrido-sugerencia')!.textContent).toContain('Puedes hacer el cambio de verdad');
  });

  it('al cambiar ES ↔ EN el texto cambia sin recrear la burbuja y vuelve al regresar a ES', async () => {
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    const burbuja = q(ctx.el, 'recorrido-burbuja')!;
    const titulo = q(ctx.el, 'recorrido-titulo')!;
    expect(titulo.textContent).toContain('Abre «Órdenes de trabajo»');

    ctx.i18n.setLang('en');
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'recorrido-burbuja')).toBe(burbuja);
    expect(q(ctx.el, 'recorrido-titulo')).toBe(titulo);
    expect(titulo.textContent).toContain('Open “Work orders”');
    expect(q(ctx.el, 'recorrido-paso')!.textContent).toContain('Step 1 of 5');
    expect(q(ctx.el, 'recorrido-salir')!.textContent).toContain('Leave the tour');
    expect(q(ctx.el, 'recorrido-anuncio')!.textContent).toContain('Step 1 of 5');
    expect(burbuja.querySelector('[role="progressbar"]')!.getAttribute('aria-label')).toBe('Tour progress');

    ctx.i18n.setLang('es');
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'recorrido-burbuja')).toBe(burbuja);
    expect(titulo.textContent).toContain('Abre «Órdenes de trabajo»');
    expect(q(ctx.el, 'recorrido-paso')!.textContent).toContain('Paso 1 de 5');
  });

  it('en el celular la burbuja va abajo, sobre la barra inferior', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    const clase = q(ctx.el, 'recorrido-burbuja')!.className;
    expect(clase).toContain('inset-x-3');
    expect(clase).toContain('bottom-[calc(5rem+env(safe-area-inset-bottom))]');
  });

});

/**
 * El registro resaltado puede estar muy abajo (listas largas) y la burbuja no debe perderse de vista: se ubica con su altura
 * real dentro de la pantalla y el registro se encuadra en la zona libre, sin tener que desplazarse a leer las instrucciones.
 */
describe('RecorridoCapaComponent: el registro y la burbuja se ven de inmediato', () => {
  const ALTO_PANTALLA = 800;
  const ALTO_BURBUJA = 320;

  /** Rectángulos falsos: jsdom no tiene diseño, así que cada elemento informa el rectángulo que la prueba le asigna. */
  function conRectangulos(objetivo: { top: number; height: number }, burbujaTop = 400) {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: ALTO_PANTALLA });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => ALTO_BURBUJA });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const caja = (top: number, height: number) =>
        ({ top, bottom: top + height, left: 100, right: 500, width: 400, height, x: 100, y: top, toJSON: () => ({}) }) as DOMRect;
      if (this.getAttribute('data-tour')) return caja(objetivo.top, objetivo.height);
      if (this.getAttribute('data-testid') === 'recorrido-burbuja') return caja(burbujaTop, ALTO_BURBUJA);
      return caja(0, 0);
    });
  }
  const arriba = (el: HTMLElement) => Number.parseFloat(q(el, 'recorrido-burbuja')!.style.top);

  /** Un contenedor con scroll (como el <main> de BARB) que contiene el registro resaltado. */
  function contenedorConFila() {
    const contenedor = document.createElement('main');
    contenedor.style.overflowY = 'auto';
    Object.defineProperty(contenedor, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(contenedor, 'clientHeight', { configurable: true, value: 700 });
    contenedor.scrollBy = vi.fn();
    document.body.appendChild(contenedor);
    const fila = document.createElement('div');
    fila.setAttribute('data-tour', 'ot-fila');
    contenedor.appendChild(fila);
    return contenedor;
  }
  const desplazamiento = (contenedor: HTMLElement) =>
    ((contenedor.scrollBy as ReturnType<typeof vi.fn>).mock.calls[0][0] as { top: number }).top;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.setItem('barb.lang', 'es');
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  });

  it.each([
    ['un registro muy abajo en una lista larga', { top: 3000, height: 60 }],
    ['un registro muy arriba (ya desplazado)', { top: -2000, height: 60 }],
    ['una fila en el borde inferior', { top: 760, height: 60 }],
    ['un elemento más alto que la pantalla', { top: -500, height: 3000 }],
    ['un registro a la mitad', { top: 300, height: 60 }],
  ])('la burbuja queda completamente dentro de la pantalla con %s', async (_nombre, objetivo) => {
    conRectangulos(objetivo);
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    await vi.advanceTimersByTimeAsync(300);
    ctx.fixture.detectChanges();
    const top = arriba(ctx.el);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(top + ALTO_BURBUJA).toBeLessThanOrEqual(ALTO_PANTALLA - 12);
  });

  it('con espacio debajo, la burbuja va justo bajo el registro (no en la parte alta de la página)', async () => {
    conRectangulos({ top: 300, height: 60 });
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    await vi.advanceTimersByTimeAsync(300);
    ctx.fixture.detectChanges();
    expect(arriba(ctx.el)).toBe(300 + 60 + 14);
  });

  it('con el registro al fondo, la burbuja va encima de él', async () => {
    conRectangulos({ top: 700, height: 60 });
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    await vi.advanceTimersByTimeAsync(300);
    ctx.fixture.detectChanges();
    expect(arriba(ctx.el) + ALTO_BURBUJA).toBeLessThanOrEqual(700);
  });

  it('el borde de resaltado se recorta a la pantalla (un elemento muy alto no lo dibuja fuera de ella)', async () => {
    conRectangulos({ top: -500, height: 3000 });
    marca('ot-fila');
    const ctx = montar();
    await iniciar(ctx);
    ctx.fixture.detectChanges();
    const borde = q(ctx.el, 'recorrido-resaltado')!;
    expect(Number.parseFloat(borde.style.top)).toBeGreaterThanOrEqual(-4);
    expect(Number.parseFloat(borde.style.top) + Number.parseFloat(borde.style.height)).toBeLessThanOrEqual(ALTO_PANTALLA + 8);
  });

  it('un registro fuera de pantalla se desplaza dentro del contenedor que lo contiene hasta dejarlo a la vista', async () => {
    conRectangulos({ top: 3000, height: 60 });
    const contenedor = contenedorConFila();
    const ctx = montar();
    await iniciar(ctx);
    await vi.advanceTimersByTimeAsync(300);
    expect(contenedor.scrollBy).toHaveBeenCalled();
    expect(desplazamiento(contenedor)).toBeGreaterThan(2000); // desde el fondo de la lista hasta la zona visible
  });

  it('un registro que ya se ve entero no desplaza nada', async () => {
    conRectangulos({ top: 300, height: 60 });
    const contenedor = contenedorConFila();
    const ctx = montar();
    await iniciar(ctx);
    await vi.advanceTimersByTimeAsync(300);
    expect(contenedor.scrollBy).not.toHaveBeenCalled();
  });

  it('en el celular el registro queda por encima de la burbuja (que va abajo y lo taparía)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    conRectangulos({ top: 600, height: 40 }, 480); // la burbuja empieza en y = 480
    const contenedor = contenedorConFila();
    const ctx = montar();
    await iniciar(ctx);
    await vi.advanceTimersByTimeAsync(300);
    // Zona libre: de 12 a 466 (burbuja en 480 menos la separación). El registro, en 600–640, se sube hacia su centro.
    const top = desplazamiento(contenedor);
    expect(600 - top).toBeGreaterThanOrEqual(12);
    expect(600 - top + 40).toBeLessThanOrEqual(466);
  });
});
