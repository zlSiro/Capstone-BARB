import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it, vi } from 'vitest';

import { I18nService } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { AyudaGuiaComponent } from './ayuda-guia.component';
import { AyudaPreguntarComponent } from './ayuda-preguntar.component';
import { RecorridosService } from './recorridos.service';

async function montar(role: string, url = '/ayuda/preguntar') {
  window.localStorage.setItem('barb.lang', 'es');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'ayuda/preguntar', component: AyudaPreguntarComponent },
        { path: 'ayuda/guia/:id', component: AyudaGuiaComponent },
      ]),
      { provide: AuthService, useValue: { user: signal({ id: 1, name: 'Ana', role }), privilegiosPendientes: signal(false) } },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  const el = harness.routeNativeElement as HTMLElement;
  return { harness, el, recorridos: TestBed.inject(RecorridosService), i18n: TestBed.inject(I18nService) };
}

const q = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const preguntar = (ctx: { harness: RouterTestingHarness; el: HTMLElement }, texto: string) => {
  const campo = q(ctx.el, 'preguntar-entrada') as HTMLInputElement;
  campo.value = texto;
  campo.dispatchEvent(new Event('input'));
  ctx.harness.detectChanges();
  ctx.el.querySelector('form')!.dispatchEvent(new Event('submit'));
  ctx.harness.detectChanges();
};

describe('AyudaPreguntarComponent («Pregúntale a la ayuda»)', () => {
  it('muestra la pregunta a la derecha y, debajo, la respuesta de la guía con su fuente', async () => {
    const { el } = await montar('supervisor', '/ayuda/preguntar?q=' + encodeURIComponent('¿Cómo devuelvo una OT al técnico?'));
    const pregunta = q(el, 'pregunta-usuario')!;
    expect(pregunta.textContent).toContain('¿Cómo devuelvo una OT al técnico?');
    expect(pregunta.className).toContain('self-end');

    expect(q(el, 'respuesta')!.textContent).toContain('Respuesta de la ayuda de BARB');
    expect(q(el, 'respuesta-resumen')!.textContent).toContain('comentario obligatorio');
    expect(q(el, 'respuesta-pasos')!.querySelectorAll('li')).toHaveLength(3);
    expect(q(el, 'respuesta-fuente')!.textContent).toContain('Fuente: guía «Validar o devolver una OT»');
  });

  it('ofrece los tres botones: mostrar en pantalla, ir a la pantalla y abrir la guía', async () => {
    const { el } = await montar('supervisor', '/ayuda/preguntar?q=' + encodeURIComponent('devolver una OT'));
    expect(q(el, 'respuesta-mostrar')!.textContent).toContain('Mostrarme en la pantalla');
    expect(q(el, 'respuesta-ir')!.textContent).toContain('Ir a Órdenes de trabajo');
    expect(q(el, 'respuesta-ir')!.getAttribute('href')).toBe('/work-orders');
    expect(q(el, 'respuesta-guia')!.textContent).toContain('Abrir la guía');
    expect(q(el, 'respuesta-guia')!.getAttribute('href')).toBe('/ayuda/guia/validar_devolver');
  });

  it('«Mostrarme en la pantalla» inicia el recorrido de esa guía', async () => {
    const { el, recorridos } = await montar('supervisor', '/ayuda/preguntar?q=' + encodeURIComponent('devolver una OT'));
    const iniciar = vi.spyOn(recorridos, 'iniciar').mockImplementation(() => undefined);
    const boton = q(el, 'respuesta-mostrar') as HTMLButtonElement;
    boton.click();
    expect(iniciar).toHaveBeenCalledWith('validar_devolver', boton);
  });

  it('sin pregunta en la URL solo muestra la caja para preguntar', async () => {
    const { el } = await montar('supervisor');
    expect(q(el, 'pregunta-usuario')).toBeNull();
    expect(q(el, 'preguntar-entrada')).not.toBeNull();
    expect(el.querySelector('nav a')!.getAttribute('href')).toBe('/ayuda');
  });

  it('se puede seguir preguntando: cada pregunta agrega su respuesta; una vacía se ignora', async () => {
    const ctx = await montar('tecnico');
    preguntar(ctx, '   ');
    expect(ctx.el.querySelectorAll('[data-testid="pregunta-usuario"]')).toHaveLength(0);

    preguntar(ctx, '¿cómo envío una OT a validación?');
    preguntar(ctx, 'buscar un manual');
    expect(ctx.el.querySelectorAll('[data-testid="pregunta-usuario"]')).toHaveLength(2);
    expect(ctx.el.querySelectorAll('[data-testid="respuesta"]')).toHaveLength(2);
    expect(q(ctx.el, 'respuesta-fuente')!.textContent).toContain('Iniciar y enviar a validación una OT');
    expect((q(ctx.el, 'preguntar-entrada') as HTMLInputElement).value).toBe('');
  });

  describe('si ninguna guía responde', () => {
    it('lo dice con claridad y ofrece DocChat (sin enviar nada) o contactar al administrador', async () => {
      const { el } = await montar('supervisor', '/ayuda/preguntar?q=' + encodeURIComponent('receta de cocina'));
      expect(q(el, 'respuesta')).toBeNull();
      expect(q(el, 'sin-respuesta')!.textContent).toContain('No encontré una guía para eso');
      expect(q(el, 'sin-respuesta')!.textContent).toContain('no inventa respuestas');
      const docchat = q(el, 'sin-respuesta-docchat')!;
      expect(docchat.textContent).toContain('Preguntar en DocChat');
      expect(docchat.getAttribute('href')).toBe('/chat'); // sin parámetros: no se envía la pregunta
      expect(q(el, 'sin-respuesta-admin')!.textContent).toContain('Contactar al administrador');
    });

    it('«Contactar al administrador» muestra el aviso (sin llamar a nada) y se puede ocultar', async () => {
      const ctx = await montar('supervisor', '/ayuda/preguntar?q=' + encodeURIComponent('receta de cocina'));
      expect(q(ctx.el, 'sin-respuesta-admin-texto')).toBeNull();
      q(ctx.el, 'sin-respuesta-admin')!.click();
      ctx.harness.detectChanges();
      expect(q(ctx.el, 'sin-respuesta-admin-texto')!.textContent).toContain('Avísale a tu administrador');
      q(ctx.el, 'sin-respuesta-admin')!.click();
      ctx.harness.detectChanges();
      expect(q(ctx.el, 'sin-respuesta-admin-texto')).toBeNull();
    });

    it('el superusuario no tiene DocChat: no se ofrece', async () => {
      const { el } = await montar('super_usuario', '/ayuda/preguntar?q=' + encodeURIComponent('receta de cocina'));
      expect(q(el, 'sin-respuesta-docchat')).toBeNull();
      expect(q(el, 'sin-respuesta-admin')).not.toBeNull();
    });
  });

  it('solo responde con guías del perfil: el operador no recibe la de validar OT', async () => {
    const { el } = await montar('operador', '/ayuda/preguntar?q=' + encodeURIComponent('¿Cómo devuelvo una OT al técnico?'));
    expect(q(el, 'respuesta-fuente')?.textContent ?? '').not.toContain('Validar o devolver');
  });

  it('al cambiar ES ↔ EN la respuesta se busca y se escribe en el idioma activo, sin recrear la vista', async () => {
    const ctx = await montar('supervisor', '/ayuda/preguntar?q=' + encodeURIComponent('validar validate cerrar close'));
    const respuesta = q(ctx.el, 'respuesta')!;
    expect(q(ctx.el, 'respuesta-fuente')!.textContent).toContain('Fuente: guía «Validar o devolver una OT»');
    expect(q(ctx.el, 'respuesta-ir')!.textContent).toContain('Ir a Órdenes de trabajo');

    ctx.i18n.setLang('en');
    ctx.harness.detectChanges();
    expect(q(ctx.el, 'respuesta')).toBe(respuesta);
    expect(q(ctx.el, 'respuesta-fuente')!.textContent).toContain('Source: guide “Validate or send back a work order”');
    expect(q(ctx.el, 'respuesta-mostrar')!.textContent).toContain('Show me on the screen');
    expect(q(ctx.el, 'respuesta-ir')!.textContent).toContain('Go to Work orders');
    expect(q(ctx.el, 'respuesta-resumen')!.textContent).toContain('mandatory comment');
    expect(ctx.el.querySelector('h1')!.textContent).toContain('Ask the help');

    ctx.i18n.setLang('es');
    ctx.harness.detectChanges();
    expect(q(ctx.el, 'respuesta-fuente')!.textContent).toContain('Fuente: guía «Validar o devolver una OT»');
    expect(ctx.el.querySelector('h1')!.textContent).toContain('Pregúntale a la ayuda');
  });

  it('no llama al backend ni a DocChat: no hace falta HttpClient', async () => {
    await expect(montar('gerente', '/ayuda/preguntar?q=costo')).resolves.toBeDefined();
  });
});

describe('AyudaGuiaComponent (abrir la guía)', () => {
  it('muestra el título, el resumen y los pasos numerados', async () => {
    const { el } = await montar('supervisor', '/ayuda/guia/validar_devolver');
    expect(q(el, 'guia-titulo')!.textContent).toContain('Validar o devolver una OT');
    expect(q(el, 'guia-resumen')!.textContent).toContain('comentario obligatorio');
    expect(q(el, 'guia-pasos')!.querySelectorAll('li')).toHaveLength(3);
    expect(q(el, 'guia-ir')!.getAttribute('href')).toBe('/work-orders');
    expect(q(el, 'guia-volver')!.getAttribute('href')).toBe('/ayuda');
  });

  it('«Mostrarme en la pantalla» inicia el recorrido', async () => {
    const { el, recorridos } = await montar('supervisor', '/ayuda/guia/validar_devolver');
    const iniciar = vi.spyOn(recorridos, 'iniciar').mockImplementation(() => undefined);
    const boton = q(el, 'guia-mostrar') as HTMLButtonElement;
    boton.click();
    expect(iniciar).toHaveBeenCalledWith('validar_devolver', boton);
  });

  it.each([
    ['una guía que no existe', 'supervisor', 'inventada'],
    ['una guía de otro perfil', 'operador', 'validar_devolver'],
  ])('%s: avisa y no muestra nada', async (_nombre, rol, id) => {
    const { el } = await montar(rol, `/ayuda/guia/${id}`);
    expect(q(el, 'guia-no-existe')!.textContent).toContain('no existe o no está disponible para tu perfil');
    expect(q(el, 'guia-titulo')).toBeNull();
  });

  it('cambia de idioma sin recrear la vista y vuelve a español', async () => {
    const ctx = await montar('supervisor', '/ayuda/guia/validar_devolver');
    const titulo = q(ctx.el, 'guia-titulo')!;
    ctx.i18n.setLang('en');
    ctx.harness.detectChanges();
    expect(q(ctx.el, 'guia-titulo')).toBe(titulo);
    expect(titulo.textContent).toContain('Validate or send back a work order');
    expect(q(ctx.el, 'guia-volver')!.textContent).toContain('Back to Learn BARB');
    ctx.i18n.setLang('es');
    ctx.harness.detectChanges();
    expect(titulo.textContent).toContain('Validar o devolver una OT');
  });
});
