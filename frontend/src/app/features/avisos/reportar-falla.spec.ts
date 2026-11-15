import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Aviso } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { ReportarFalla } from './reportar-falla';
import { reducirImagen, UMBRAL_REDUCCION_BYTES } from './reducir-imagen';

const PLANTAS = [
  { id: 1, name: 'Planta Norte' },
  { id: 2, name: 'Planta Sur' },
];

const DISCIPLINAS = [
  { id: 1, name: 'Mecánica' },
  { id: 2, name: 'Eléctrica' },
];

const MAQUINAS = [
  { id: 7, name: 'Prensa P-7', discipline_id: 1, plant_id: 1 },
  { id: 8, name: 'Compresor A1', discipline_id: 1, plant_id: 1 },
  { id: 9, name: 'Bomba B-2', discipline_id: 2, plant_id: 2 },
];

const creado = (parcial: Partial<Aviso> = {}) =>
  ({ aviso_id: 9, numero_aviso: 'AV-2026-0009', machine_name: 'Prensa P-7', foto: null, ...parcial }) as Aviso;

describe('Reportar falla', () => {
  let http: HttpTestingController;

  function setup(role = 'operador') {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { user: () => ({ role, name: 'T' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ReportarFalla);
    const emitidos: Aviso[] = [];
    fixture.componentInstance.created.subscribe((a) => emitidos.push(a));
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/plants')).flush(PLANTAS);
    http.expectOne((r) => r.url.endsWith('/disciplines')).flush(DISCIPLINAS);
    http.expectOne((r) => r.url.endsWith('/machines')).flush(MAQUINAS);
    fixture.detectChanges();
    return { fixture, emitidos };
  }

  type Fixture = ReturnType<typeof setup>['fixture'];
  const raiz = (f: Fixture) => f.nativeElement as HTMLElement;
  const texto = (f: Fixture) => raiz(f).textContent ?? '';
  const boton = (f: Fixture, etiqueta: string) =>
    Array.from(raiz(f).querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(etiqueta))!;

  function escribir(f: Fixture, id: string, valor: string) {
    const el = raiz(f).querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    el.value = valor;
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  /** Atajo: elegir la planta 1 y después la máquina, que es el flujo nuevo. */
  function elegirPlanta(f: Fixture, id = '1') {
    escribir(f, 'aviso-planta', id);
  }

  const select = (f: Fixture, id: string) => raiz(f).querySelector(`#${id}`) as HTMLSelectElement;
  /** El select de máquina se deshabilita desde su fieldset (Signal Forms no admite [disabled]). */
  const maquinaDeshabilitada = (f: Fixture) =>
    (raiz(f).querySelector('[data-testid="campo-maquina"]') as HTMLFieldSetElement).disabled;
  const opciones = (f: Fixture, id: string) =>
    Array.from(select(f, id).options).map((o) => o.textContent!.trim());

  async function elegirArchivo(f: Fixture, archivo: File, id = 'aviso-foto') {
    const input = raiz(f).querySelector(`#${id}`) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [archivo], configurable: true });
    input.dispatchEvent(new Event('change'));
    await f.whenStable();
    f.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:simulada'), revokeObjectURL: vi.fn() });
  });

  afterEach(() => http.verify());

  it('pide planta, disciplina y máquina en ese orden, y ya no pide gravedad', () => {
    const { fixture: f } = setup();
    const t = texto(f);
    expect(t.indexOf('Planta')).toBeLessThan(t.indexOf('Disciplina'));
    expect(t.indexOf('Disciplina')).toBeLessThan(t.indexOf('1. ¿Qué máquina'));
    expect(t.indexOf('1. ¿Qué máquina')).toBeLessThan(t.indexOf('2. ¿Qué está pasando?'));
    expect(t.indexOf('2. ¿Qué está pasando?')).toBeLessThan(t.indexOf('3. Foto de la falla'));
    // La gravedad ahora la decide el supervisor: el operario no la elige.
    expect(t).not.toContain('¿Qué tan grave es?');
    expect(raiz(f).querySelector('input[name="aviso-severidad"]')).toBeNull();
  });

  it('sin planta, disciplina y máquina están deshabilitadas', () => {
    const { fixture: f } = setup();
    expect(select(f, 'aviso-disciplina').disabled).toBe(true);
    expect(maquinaDeshabilitada(f)).toBe(true);
    expect(texto(f)).toContain('Elige una planta para filtrar las máquinas');
  });

  it('al elegir planta se habilita la máquina y solo aparecen sus equipos', () => {
    const { fixture: f } = setup();
    elegirPlanta(f, '1');
    expect(maquinaDeshabilitada(f)).toBe(false);
    expect(opciones(f, 'aviso-machine')).toEqual(['Selecciona la máquina', 'Prensa P-7', 'Compresor A1']);
  });

  it('la disciplina solo ofrece las que tienen equipos en la planta', () => {
    const { fixture: f } = setup();
    elegirPlanta(f, '2');
    expect(opciones(f, 'aviso-disciplina')).toEqual(['Todas las disciplinas', 'Eléctrica']);
  });

  it('la disciplina acota la lista de máquinas', () => {
    const { fixture: f } = setup();
    elegirPlanta(f, '1');
    escribir(f, 'aviso-disciplina', '1');
    expect(opciones(f, 'aviso-machine')).toEqual(['Selecciona la máquina', 'Prensa P-7', 'Compresor A1']);
  });

  it('cambiar de planta limpia la máquina elegida', () => {
    const { fixture: f } = setup();
    elegirPlanta(f, '1');
    escribir(f, 'aviso-machine', '7');
    elegirPlanta(f, '2');
    expect(select(f, 'aviso-machine').value).toBe('');
    expect(opciones(f, 'aviso-machine')).toEqual(['Selecciona la máquina', 'Bomba B-2']);
  });

  it('un pill de máquina reciente completa planta y disciplina', () => {
    localStorage.setItem('barb.aviso.maquinas', JSON.stringify([9]));
    const { fixture: f } = setup();
    raiz(f)
      .querySelectorAll('[aria-label="Máquinas recientes"] button')
      .forEach((b) => (b as HTMLElement).click());
    f.detectChanges();
    expect(select(f, 'aviso-planta').value).toBe('2');
    expect(select(f, 'aviso-machine').value).toBe('9');
  });

  it('exige máquina y descripción antes de enviar', () => {
    const { fixture: f } = setup();
    boton(f, 'Enviar aviso').click();
    f.detectChanges();
    http.expectNone((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    expect(texto(f)).toContain('Selecciona la máquina.');
    expect(texto(f)).toContain('Describe la falla.');
  });

  it('envía máquina y descripción (sin foto, sin gravedad) y confirma con el número', () => {
    const { fixture: f, emitidos } = setup();
    elegirPlanta(f, '1');
    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', '  Ruido metálico al arrancar  ');
    f.detectChanges();
    boton(f, 'Enviar aviso').click();

    const req = http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('maquina_id')).toBe('7');
    expect(body.get('descripcion')).toBe('Ruido metálico al arrancar');
    // El campo se eliminó del payload: la gravedad la define el supervisor.
    expect(body.has('severidad')).toBe(false);
    expect(body.has('foto')).toBe(false);
    req.flush(creado());
    f.detectChanges();

    expect(emitidos).toHaveLength(1);
    expect(raiz(f).querySelector('[data-testid="aviso-numero"]')!.textContent).toContain('AV-2026-0009');
    expect(boton(f, 'Ver mis avisos')).toBeDefined();
    expect(boton(f, 'Reportar otra')).toBeDefined();
  });

  it('los síntomas frecuentes empiezan el texto sin escribir', () => {
    const { fixture: f } = setup();
    boton(f, 'Fuga').click();
    boton(f, 'Vibración').click();
    f.detectChanges();
    expect((raiz(f).querySelector('#aviso-descripcion') as HTMLTextAreaElement).value).toBe('Fuga. Vibración');
  });

  it('adjunta una imagen, la previsualiza y la envía con el aviso', async () => {
    const { fixture: f } = setup();
    expect(texto(f)).toContain('Sin foto');
    await elegirArchivo(f, new File([new Uint8Array([137, 80, 78, 71])], 'falla.png', { type: 'image/png' }));
    expect(texto(f)).toContain('falla.png');
    expect(raiz(f).querySelector('img[alt="Vista previa de la foto adjunta"]')).not.toBeNull();

    elegirPlanta(f, '1');
    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', 'Fuga de aceite');
    boton(f, 'Enviar aviso').click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    const enviado = (req.request.body as FormData).get('foto') as File;
    expect(enviado).toBeInstanceOf(File);
    expect(enviado.name).toBe('falla.png');
    req.flush(creado({ foto: { original_name: 'falla.png', content_type: 'image/png' } }));
  });

  it('ofrece la cámara del celular y la galería como dos entradas distintas', () => {
    const { fixture: f } = setup();
    const camara = raiz(f).querySelector('#aviso-foto-camara') as HTMLInputElement;
    expect(camara.getAttribute('accept')).toBe('image/*');
    expect(camara.getAttribute('capture')).toBe('environment');
    expect((raiz(f).querySelector('#aviso-foto') as HTMLInputElement).getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
    expect(boton(f, 'Tomar foto')).toBeDefined();
    expect(boton(f, 'Elegir de la galería')).toBeDefined();
  });

  it('una foto tomada con la cámara también se adjunta', async () => {
    const { fixture: f } = setup();
    await elegirArchivo(f, new File([new Uint8Array([255, 216, 255])], 'IMG_1.jpg', { type: 'image/jpeg' }), 'aviso-foto-camara');
    expect(texto(f)).toContain('IMG_1.jpg');
  });

  it('se puede quitar la foto adjunta antes de enviar', async () => {
    const { fixture: f } = setup();
    await elegirArchivo(f, new File([new Uint8Array([255, 216, 255])], 'a.jpg', { type: 'image/jpeg' }));
    boton(f, 'Quitar').click();
    f.detectChanges();
    expect(texto(f)).toContain('Sin foto');

    elegirPlanta(f, '1');
    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', 'Falla sin foto');
    boton(f, 'Enviar aviso').click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    expect((req.request.body as FormData).has('foto')).toBe(false);
    req.flush(creado());
  });

  it('rechaza un archivo que no es imagen o que supera los 5 MB, sin adjuntarlo', async () => {
    const { fixture: f } = setup();
    await elegirArchivo(f, new File(['hola'], 'nota.txt', { type: 'text/plain' }));
    expect(texto(f)).toContain('Sin foto');

    await elegirArchivo(f, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' }));
    expect(texto(f)).toContain('Sin foto');
    expect(raiz(f).querySelector('img[alt="Vista previa de la foto adjunta"]')).toBeNull();
  });

  it('guarda un borrador mientras se escribe y lo recupera al volver a abrir', () => {
    const { fixture: f } = setup();
    elegirPlanta(f, '1');
    escribir(f, 'aviso-machine', '8');
    escribir(f, 'aviso-descripcion', 'Se calienta');
    f.detectChanges();
    TestBed.tick();
    expect(JSON.parse(localStorage.getItem('barb.aviso.borrador')!)).toMatchObject({ machineId: '8', descripcion: 'Se calienta' });

    TestBed.resetTestingModule();
    // El borrador tiene que seguir ahí: es lo que permite restaurar la selección.
    expect(JSON.parse(localStorage.getItem('barb.aviso.borrador')!).machineId).toBe('8');
    const { fixture: g } = setup();
    // El borrador restaura la máquina Y los filtros que la hacen visible en el select.
    g.detectChanges();
    expect((raiz(g).querySelector('#aviso-descripcion') as HTMLTextAreaElement).value).toBe('Se calienta');
    expect(select(g, 'aviso-planta').value).toBe('1');
    const maquina = select(g, 'aviso-machine');
    expect(maquina.options[maquina.selectedIndex]?.textContent?.trim()).toBe('Compresor A1');
  });

  it('al enviar borra el borrador y recuerda la máquina para la próxima vez', () => {
    const { fixture: f } = setup();
    elegirPlanta(f, '1');
    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', 'Fuga');
    f.detectChanges();
    TestBed.tick();
    boton(f, 'Enviar aviso').click();
    http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST').flush(creado());
    f.detectChanges();
    TestBed.tick();
    expect(localStorage.getItem('barb.aviso.borrador')).toBeNull();
    expect(JSON.parse(localStorage.getItem('barb.aviso.maquinas')!)).toEqual([7]);

    TestBed.resetTestingModule();
    const { fixture: g } = setup();
    expect(Array.from(raiz(g).querySelectorAll('[aria-label="Máquinas recientes"] button')).map((b) => b.textContent!.trim())).toEqual(['Prensa P-7']);
  });

  it('«Reportar otra» vuelve al formulario vacío', () => {
    const { fixture: f } = setup();
    elegirPlanta(f, '1');
    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', 'Fuga');
    boton(f, 'Enviar aviso').click();
    http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST').flush(creado());
    f.detectChanges();
    boton(f, 'Reportar otra').click();
    f.detectChanges();
    expect((raiz(f).querySelector('#aviso-descripcion') as HTMLTextAreaElement).value).toBe('');
    expect(maquinaDeshabilitada(f)).toBe(true);
  });

  it('si el envío falla, informa y conserva lo escrito', () => {
    const { fixture: f } = setup();
    elegirPlanta(f, '1');
    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', 'Fuga');
    boton(f, 'Enviar aviso').click();
    http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST').flush({ detail: 'caído' }, { status: 500, statusText: 'Error' });
    f.detectChanges();
    expect(raiz(f).querySelector('[data-testid="aviso-confirmacion"]')).toBeNull();
    expect((raiz(f).querySelector('#aviso-descripcion') as HTMLTextAreaElement).value).toBe('Fuga');
  });
});

describe('reducirImagen', () => {
  it('deja intacta una foto liviana', async () => {
    const f = new File([new Uint8Array(100)], 'a.png', { type: 'image/png' });
    expect(await reducirImagen(f)).toBe(f);
  });

  it('si el navegador no puede procesar una foto grande, devuelve la original', async () => {
    const f = new File([new Uint8Array(UMBRAL_REDUCCION_BYTES + 1)], 'grande.jpg', { type: 'image/jpeg' });
    expect(await reducirImagen(f)).toBe(f);
  });
});
