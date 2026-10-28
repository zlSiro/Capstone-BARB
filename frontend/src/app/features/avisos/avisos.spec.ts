import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Avisos } from './avisos';
import { Aviso } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';

function aviso(parcial: Partial<Aviso> & { aviso_id: number }): Aviso {
  return {
    numero_aviso: `AV-2026-000${parcial.aviso_id}`,
    maquina_id: 1,
    machine_name: 'Compresor A1',
    plant_name: 'Planta Central',
    empresa_id: 1,
    descripcion: 'Vibración anormal en el motor',
    severidad: 'high',
    estado: 'pendiente',
    status: 'Pendiente',
    reportado_por: { id: 11, nombre: 'Operador Molino', rol: 'operador' },
    created_at: '2026-10-28T12:00:00Z',
    resuelto_en: null,
    resuelto_por: null,
    motivo_descarte: null,
    numero_ot: null,
    foto: null,
    ...parcial,
  };
}

const LISTA: Aviso[] = [
  aviso({ aviso_id: 1 }),
  aviso({ aviso_id: 2, descripcion: 'Fuga de aceite', severidad: 'critical', foto: { original_name: 'fuga.jpg', content_type: 'image/jpeg' } }),
  aviso({ aviso_id: 3, estado: 'con_ot', status: 'Con OT', numero_ot: 'OT-2026-0042', resuelto_por: 'Supervisor Turno A' }),
  aviso({ aviso_id: 4, estado: 'descartado', status: 'Descartado', motivo_descarte: 'Ya está en la OT-2026-0012', resuelto_por: 'Supervisor Turno A' }),
];

describe('Avisos de falla', () => {
  let http: HttpTestingController;

  function setup(role: string) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { user: () => ({ role, name: 'T' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Avisos);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'GET').flush(LISTA);
    fixture.detectChanges();
    return fixture;
  }

  const texto = (f: ReturnType<typeof setup>) => (f.nativeElement as HTMLElement).textContent ?? '';
  const botones = (f: ReturnType<typeof setup>, etiqueta: string) =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll('button')).filter((b) => b.textContent?.trim().startsWith(etiqueta));

  function escribir(f: ReturnType<typeof setup>, id: string, valor: string) {
    const el = (f.nativeElement as HTMLElement).querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    el.value = valor;
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  // jsdom no implementa las URL de blob: se simulan.
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:simulada'), revokeObjectURL: vi.fn() });
  });

  afterEach(() => http.verify());

  /** Simula que el usuario elige un archivo en el `<input type="file">`. */
  function elegirArchivo(f: ReturnType<typeof setup>, archivo: File) {
    const input = (f.nativeElement as HTMLElement).querySelector('#aviso-foto') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [archivo], configurable: true });
    input.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  /** Abre el formulario de reportar una falla y responde el catálogo de máquinas. */
  function abrirReportar(f: ReturnType<typeof setup>) {
    botones(f, '+ Reportar falla')[0].click();
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/machines')).flush([{ id: 7, name: 'Prensa P-7', discipline_id: 1, plant_id: 1 }]);
    f.detectChanges();
  }

  it('el supervisor parte de los pendientes y ve las acciones de decisión', () => {
    const f = setup('supervisor');
    expect(texto(f)).toContain('Avisos de falla (4)');
    expect(texto(f)).toContain('AV-2026-0001');
    expect(texto(f)).toContain('AV-2026-0002');
    expect(texto(f)).not.toContain('AV-2026-0003'); // con OT: oculto en el filtro «Pendiente»
    expect(botones(f, 'Generar OT')).toHaveLength(2);
    expect(botones(f, 'Descartar')).toHaveLength(2);
    expect(texto(f)).toContain('Reportado por');
  });

  it('los filtros muestran el resultado de cada decisión', () => {
    const f = setup('supervisor');
    botones(f, 'Con OT')[0].click();
    f.detectChanges();
    expect(texto(f)).toContain('OT-2026-0042');
    botones(f, 'Descartado')[0].click();
    f.detectChanges();
    expect(texto(f)).toContain('Motivo: Ya está en la OT-2026-0012');
  });

  it('quien solo reporta ve «Mis avisos», todo lo suyo y ninguna acción de decisión', () => {
    const f = setup('operador');
    expect(texto(f)).toContain('Mis avisos de falla (4)');
    expect(texto(f)).toContain('AV-2026-0003');
    expect(texto(f)).toContain('Motivo: Ya está en la OT-2026-0012');
    expect(texto(f)).not.toContain('Reportado por');
    expect(botones(f, 'Generar OT')).toHaveLength(0);
    expect(botones(f, 'Descartar')).toHaveLength(0);
    expect(botones(f, '+ Reportar falla')).toHaveLength(1);
  });

  it('generar la OT envía el técnico y la prioridad sugerida por la gravedad, y el aviso pasa a «Con OT»', () => {
    const f = setup('supervisor');
    botones(f, 'Generar OT')[0].click();
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/technicians')).flush([{ id: 4, name: 'Carlos Mendoza', email: 'c@x.cl', role: 'tecnico' }]);
    f.detectChanges();

    // Sin técnico no se envía nada.
    botones(f, 'Generar OT').find((b) => b.closest('[role="dialog"]'))!.click();
    f.detectChanges();
    http.expectNone((r) => r.url.includes('/generar-ot'));

    escribir(f, 'gen-tecnico', '4');
    botones(f, 'Generar OT').find((b) => b.closest('[role="dialog"]'))!.click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos/1/generar-ot'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ tecnico_id: 4, priority: 'high' }); // gravedad «alta» -> prioridad alta
    req.flush({ aviso: aviso({ aviso_id: 1, estado: 'con_ot', status: 'Con OT', numero_ot: 'OT-2026-0050', resuelto_por: 'Supervisor Turno A' }), ot: {} });
    f.detectChanges();

    expect(texto(f)).not.toContain('AV-2026-0001'); // ya no está en «Pendiente»
    expect(texto(f)).toContain('Avisos de falla (4)');
  });

  it('descartar exige el motivo y lo envía', () => {
    const f = setup('supervisor');
    botones(f, 'Descartar')[0].click();
    f.detectChanges();

    botones(f, 'Descartar aviso')[0].click(); // sin motivo
    f.detectChanges();
    http.expectNone((r) => r.url.includes('/descartar'));
    expect(texto(f)).toContain('Indica el motivo del descarte.');

    escribir(f, 'descartar-motivo', 'Falsa alarma');
    botones(f, 'Descartar aviso')[0].click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos/1/descartar'));
    expect(req.request.body).toEqual({ motivo: 'Falsa alarma' });
    req.flush(aviso({ aviso_id: 1, estado: 'descartado', status: 'Descartado', motivo_descarte: 'Falsa alarma' }));
    f.detectChanges();
    expect(texto(f)).not.toContain('AV-2026-0001');
  });

  it('reportar una falla envía máquina, descripción y gravedad (sin foto), y el aviso aparece en la lista', () => {
    const f = setup('operador');
    abrirReportar(f);

    botones(f, 'Enviar aviso')[0].click(); // vacío: no envía
    http.expectNone((r) => r.url.endsWith('/avisos') && r.method === 'POST');

    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-severidad', 'critical');
    escribir(f, 'aviso-descripcion', '  Ruido metálico al arrancar  ');
    botones(f, 'Enviar aviso')[0].click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('maquina_id')).toBe('7');
    expect(body.get('descripcion')).toBe('Ruido metálico al arrancar');
    expect(body.get('severidad')).toBe('critical');
    expect(body.has('foto')).toBe(false);
    req.flush(aviso({ aviso_id: 9, machine_name: 'Prensa P-7', descripcion: 'Ruido metálico al arrancar', severidad: 'critical' }));
    f.detectChanges();

    expect(texto(f)).toContain('AV-2026-0009');
    expect(texto(f)).toContain('Mis avisos de falla (5)');
  });

  it('el formulario permite adjuntar una imagen, la previsualiza y la envía con el aviso', () => {
    const f = setup('operador');
    abrirReportar(f);

    expect(texto(f)).toContain('Foto de la falla (opcional)');
    expect(texto(f)).toContain('Sin foto');
    elegirArchivo(f, new File([new Uint8Array([137, 80, 78, 71])], 'falla.png', { type: 'image/png' }));
    expect(texto(f)).toContain('falla.png');
    expect((f.nativeElement as HTMLElement).querySelector('img[alt="Vista previa de la foto adjunta"]')).not.toBeNull();

    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', 'Fuga de aceite');
    botones(f, 'Enviar aviso')[0].click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    const enviado = (req.request.body as FormData).get('foto') as File;
    expect(enviado).toBeInstanceOf(File);
    expect(enviado.name).toBe('falla.png');
    req.flush(aviso({ aviso_id: 9, foto: { original_name: 'falla.png', content_type: 'image/png' } }));
    f.detectChanges();
    expect(texto(f)).toContain('Ver foto');
  });

  it('se puede quitar la foto adjunta antes de enviar', () => {
    const f = setup('operador');
    abrirReportar(f);
    elegirArchivo(f, new File([new Uint8Array([255, 216, 255])], 'a.jpg', { type: 'image/jpeg' }));
    botones(f, 'Quitar')[0].click();
    f.detectChanges();

    expect(texto(f)).toContain('Sin foto');
    escribir(f, 'aviso-machine', '7');
    escribir(f, 'aviso-descripcion', 'Falla sin foto');
    botones(f, 'Enviar aviso')[0].click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'POST');
    expect((req.request.body as FormData).has('foto')).toBe(false);
    req.flush(aviso({ aviso_id: 9 }));
  });

  it('rechaza un archivo que no es imagen o que supera los 5 MB, sin adjuntarlo', () => {
    const f = setup('operador');
    abrirReportar(f);

    elegirArchivo(f, new File(['hola'], 'nota.txt', { type: 'text/plain' }));
    expect(texto(f)).toContain('Sin foto');

    elegirArchivo(f, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' }));
    expect(texto(f)).toContain('Sin foto');
    expect((f.nativeElement as HTMLElement).querySelector('img[alt="Vista previa de la foto adjunta"]')).toBeNull();
  });

  it('el supervisor abre la foto del aviso con «Ver foto» (se descarga con su sesión)', () => {
    const f = setup('supervisor');
    expect(botones(f, '📎 Ver foto')).toHaveLength(1); // solo el aviso 2 tiene foto
    botones(f, '📎 Ver foto')[0].click();
    f.detectChanges();

    const req = http.expectOne((r) => r.url.endsWith('/avisos/2/foto'));
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x'], { type: 'image/jpeg' }));
    f.detectChanges();

    expect((f.nativeElement as HTMLElement).querySelector('img[alt^="Foto de la falla del aviso"]')).not.toBeNull();
  });

  it('si la foto ya no está disponible lo informa', () => {
    const f = setup('supervisor');
    botones(f, '📎 Ver foto')[0].click();
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/avisos/2/foto')).flush(new Blob(['no']), { status: 404, statusText: 'Not Found' });
    f.detectChanges();
    expect(texto(f)).toContain('La foto ya no está disponible.');
  });
});
