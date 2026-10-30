import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Aviso } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { ReportarFalla } from './reportar-falla';
import { reducirImagen, UMBRAL_REDUCCION_BYTES } from './reducir-imagen';

const MAQUINAS = [
  { id: 7, name: 'Prensa P-7', discipline_id: 1, plant_id: 1 },
  { id: 8, name: 'Compresor A1', discipline_id: 1, plant_id: 1 },
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

  const gravedad = (f: Fixture, valor: string) => raiz(f).querySelector(`input[name="aviso-severidad"][value="${valor}"]`) as HTMLInputElement;

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

  it('sigue el orden máquina, qué pasa, gravedad y foto, y la gravedad parte en Media', () => {
    const { fixture: f } = setup();
    const t = texto(f);
    expect(t.indexOf('1. ¿Qué máquina')).toBeLessThan(t.indexOf('2. ¿Qué está pasando?'));
    expect(t.indexOf('2. ¿Qué está pasando?')).toBeLessThan(t.indexOf('3. ¿Qué tan grave es?'));
    expect(t.indexOf('3. ¿Qué tan grave es?')).toBeLessThan(t.indexOf('4. Foto de la falla'));
    expect(gravedad(f, 'medium').checked).toBe(true);
  });

  it('exige máquina y descripción antes de enviar', () => {
    const { fixture: f } = setup();
    boton(f, 'Enviar aviso').click();
    f.detectChanges();
    http.expectNone((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    expect(texto(f)).toContain('Selecciona la máquina.');
    expect(texto(f)).toContain('Describe la falla.');
  });

  it('envía máquina, descripción y gravedad (sin foto) y confirma con el número del aviso', () => {
    const { fixture: f, emitidos } = setup();
    escribir(f, 'aviso-machine', '7');
    gravedad(f, 'critical').click();
    escribir(f, 'aviso-descripcion', '  Ruido metálico al arrancar  ');
    f.detectChanges();
    boton(f, 'Enviar aviso').click();

    const req = http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('maquina_id')).toBe('7');
    expect(body.get('descripcion')).toBe('Ruido metálico al arrancar');
    expect(body.get('severidad')).toBe('critical');
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
    escribir(f, 'aviso-machine', '8');
    escribir(f, 'aviso-descripcion', 'Se calienta');
    f.detectChanges();
    TestBed.tick();
    expect(JSON.parse(localStorage.getItem('barb.aviso.borrador')!)).toMatchObject({ machineId: '8', descripcion: 'Se calienta' });

    TestBed.resetTestingModule();
    const { fixture: g } = setup();
    expect((raiz(g).querySelector('#aviso-descripcion') as HTMLTextAreaElement).value).toBe('Se calienta');
  });

  it('al enviar borra el borrador y recuerda la máquina para la próxima vez', () => {
    const { fixture: f } = setup();
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
    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', 'Fuga');
    boton(f, 'Enviar aviso').click();
    http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST').flush(creado());
    f.detectChanges();
    boton(f, 'Reportar otra').click();
    f.detectChanges();
    expect((raiz(f).querySelector('#aviso-descripcion') as HTMLTextAreaElement).value).toBe('');
    expect(gravedad(f, 'medium').checked).toBe(true);
  });

  it('si el envío falla, informa y conserva lo escrito', () => {
    const { fixture: f } = setup();
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
