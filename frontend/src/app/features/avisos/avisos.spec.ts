import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Avisos } from './avisos';
import { Aviso } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { ReportarFallaUi } from '../../core/services/reportar-falla-ui';

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

describe('Avisos de falla (bandeja)', () => {
  let http: HttpTestingController;

  function setup(role: string, lista: Aviso[] = LISTA) {
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
    http.expectOne((r) => r.url.endsWith('/avisos') && r.method === 'GET').flush(lista);
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = ReturnType<typeof setup>;
  const raiz = (f: Fixture) => f.nativeElement as HTMLElement;
  const texto = (f: Fixture) => raiz(f).textContent ?? '';
  const tarjetas = (f: Fixture) => Array.from(raiz(f).querySelectorAll('article'));
  const botonesEn = (ambito: ParentNode, etiqueta: string) =>
    Array.from(ambito.querySelectorAll('button')).filter((b) => b.textContent?.trim().startsWith(etiqueta));
  const botones = (f: Fixture, etiqueta: string) => botonesEn(raiz(f), etiqueta);
  const dialogo = (f: Fixture) => raiz(f).querySelector('[role="dialog"]') as HTMLElement;

  function escribir(f: Fixture, id: string, valor: string) {
    const el = raiz(f).querySelector(`#${id}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
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

  it('el supervisor parte de los pendientes, con las acciones de decisión dentro de cada tarjeta', () => {
    const f = setup('supervisor');
    expect(texto(f)).toContain('Avisos de falla (4)');
    expect(tarjetas(f)).toHaveLength(2);
    expect(texto(f)).toContain('AV-2026-0001');
    expect(texto(f)).toContain('AV-2026-0002');
    expect(texto(f)).not.toContain('AV-2026-0003'); // con OT: oculto en el filtro «Pendiente»
    for (const t of tarjetas(f)) {
      expect(botonesEn(t, 'Generar OT')).toHaveLength(1);
      expect(botonesEn(t, 'Descartar')).toHaveLength(1);
    }
    expect(texto(f)).toContain('Reportó Operador Molino');
  });

  it('muestra la gravedad con texto y la ordena: lo pendiente primero, lo más reciente arriba', () => {
    const f = setup('supervisor', [
      aviso({ aviso_id: 5, estado: 'con_ot', status: 'Con OT', numero_ot: 'OT-1', created_at: '2026-10-29T10:00:00Z' }),
      aviso({ aviso_id: 6, created_at: '2026-10-27T10:00:00Z' }),
      aviso({ aviso_id: 7, created_at: '2026-10-28T10:00:00Z', severidad: 'critical' }),
    ]);
    botones(f, 'Todos')[0].click();
    f.detectChanges();
    const orden = tarjetas(f).map((t) => t.querySelector('.codigo')!.textContent!.trim());
    expect(orden).toEqual(['AV-2026-0007', 'AV-2026-0006', 'AV-2026-0005']);
    expect(tarjetas(f)[0].textContent).toContain('Crítica');
    expect(tarjetas(f)[0].querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Gravedad Crítica');
  });

  it('los filtros muestran el resultado de cada decisión', () => {
    const f = setup('supervisor');
    botones(f, 'Con OT')[0].click();
    f.detectChanges();
    expect(texto(f)).toContain('OT-2026-0042');
    botones(f, 'Descartado')[0].click();
    f.detectChanges();
    expect(texto(f)).toContain('Motivo del descarte: Ya está en la OT-2026-0012');
  });

  it('quien solo reporta ve «Mis avisos», todo lo suyo y ninguna acción de decisión', () => {
    const f = setup('operador');
    expect(texto(f)).toContain('Mis avisos de falla (4)');
    expect(texto(f)).toContain('AV-2026-0003');
    expect(texto(f)).toContain('Motivo del descarte: Ya está en la OT-2026-0012');
    expect(texto(f)).not.toContain('Reportó Operador Molino');
    expect(botones(f, 'Generar OT')).toHaveLength(0);
    expect(botones(f, 'Descartar')).toHaveLength(0);
    expect(raiz(f).querySelector('[data-testid="aviso-detalle"]')).toBeNull();
  });

  it('sin avisos, quien puede reportar ve un llamado a hacerlo que abre el diálogo global', () => {
    const f = setup('operador', []);
    expect(texto(f)).toContain('Todavía no hay avisos.');
    botones(f, 'Reportar una falla')[0].click();
    expect(TestBed.inject(ReportarFallaUi).abierto()).toBe(true);
  });

  it('el supervisor sin pendientes ve un estado vacío claro', () => {
    const f = setup('supervisor', [aviso({ aviso_id: 3, estado: 'con_ot', status: 'Con OT', numero_ot: 'OT-1' })]);
    expect(texto(f)).toContain('No hay avisos pendientes de decisión.');
  });

  it('un aviso enviado desde el diálogo global aparece en la lista de quien lo reportó', () => {
    const f = setup('operador');
    TestBed.inject(ReportarFallaUi).notificarCreado(aviso({ aviso_id: 9, machine_name: 'Prensa P-7' }));
    f.detectChanges();
    expect(texto(f)).toContain('AV-2026-0009');
    expect(texto(f)).toContain('Mis avisos de falla (5)');
  });

  it('si no se pudo cargar, informa y permite reintentar', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { user: () => ({ role: 'supervisor', name: 'T' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(Avisos);
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/avisos')).flush({ detail: 'caído' }, { status: 500, statusText: 'Error' });
    f.detectChanges();
    expect(raiz(f).querySelector('[role="alert"]')).not.toBeNull();
    botones(f, 'Reintentar')[0].click();
    http.expectOne((r) => r.url.endsWith('/avisos')).flush(LISTA);
  });

  it('generar la OT envía el técnico y la prioridad sugerida por la gravedad, y el aviso pasa a «Con OT»', () => {
    const f = setup('supervisor');
    botonesEn(tarjetas(f)[0], 'Generar OT')[0].click();
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/technicians')).flush([{ id: 4, name: 'Carlos Mendoza', email: 'c@x.cl', role: 'tecnico' }]);
    f.detectChanges();

    // Sin técnico no se envía nada.
    botonesEn(dialogo(f), 'Generar OT')[0].click();
    f.detectChanges();
    http.expectNone((r) => r.url.includes('/generar-ot'));

    escribir(f, 'gen-tecnico', '4');
    botonesEn(dialogo(f), 'Generar OT')[0].click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos/1/generar-ot'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ tecnico_id: 4, priority: 'high' }); // gravedad «alta» -> prioridad alta
    req.flush({ aviso: aviso({ aviso_id: 1, estado: 'con_ot', status: 'Con OT', numero_ot: 'OT-2026-0050', resuelto_por: 'Supervisor Turno A' }), ot: {} });
    f.detectChanges();

    // El panel de detalle pasa al siguiente aviso (el 2, que tiene foto) y la pide.
    http.expectOne((r) => r.url.endsWith('/avisos/2/foto')).flush(new Blob(['x'], { type: 'image/jpeg' }));
    expect(texto(f)).not.toContain('AV-2026-0001'); // ya no está en «Pendiente»
    expect(texto(f)).toContain('Avisos de falla (4)');
  });

  it('descartar exige el motivo, ofrece motivos rápidos y lo envía', () => {
    const f = setup('supervisor');
    botonesEn(tarjetas(f)[0], 'Descartar')[0].click();
    f.detectChanges();

    botonesEn(dialogo(f), 'Descartar aviso')[0].click(); // sin motivo
    f.detectChanges();
    http.expectNone((r) => r.url.includes('/descartar'));
    expect(texto(f)).toContain('Indica el motivo del descarte.');

    botonesEn(dialogo(f), 'Falsa alarma')[0].click(); // motivo rápido
    f.detectChanges();
    expect((raiz(f).querySelector('#descartar-motivo') as HTMLTextAreaElement).value).toBe('Falsa alarma');
    botonesEn(dialogo(f), 'Descartar aviso')[0].click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos/1/descartar'));
    expect(req.request.body).toEqual({ motivo: 'Falsa alarma' });
    req.flush(aviso({ aviso_id: 1, estado: 'descartado', status: 'Descartado', motivo_descarte: 'Falsa alarma' }));
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/avisos/2/foto')).flush(new Blob(['x'], { type: 'image/jpeg' }));
    expect(texto(f)).not.toContain('AV-2026-0001');
  });

  it('el motivo también se puede escribir a mano', () => {
    const f = setup('supervisor');
    botonesEn(tarjetas(f)[0], 'Descartar')[0].click();
    f.detectChanges();
    escribir(f, 'descartar-motivo', 'Ya lo revisó mantención');
    botonesEn(dialogo(f), 'Descartar aviso')[0].click();
    const req = http.expectOne((r) => r.url.endsWith('/avisos/1/descartar'));
    expect(req.request.body).toEqual({ motivo: 'Ya lo revisó mantención' });
    req.flush(aviso({ aviso_id: 1, estado: 'descartado', status: 'Descartado', motivo_descarte: 'Ya lo revisó mantención' }));
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/avisos/2/foto')).flush(new Blob(['x'], { type: 'image/jpeg' }));
  });

  it('el supervisor abre la foto del aviso con «Ver foto» (se descarga con su sesión)', () => {
    const f = setup('supervisor');
    const verFoto = tarjetas(f).flatMap((t) => botonesEn(t, 'Ver foto'));
    expect(verFoto).toHaveLength(1); // solo el aviso 2 tiene foto
    verFoto[0].click();
    f.detectChanges();

    const req = http.expectOne((r) => r.url.endsWith('/avisos/2/foto'));
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x'], { type: 'image/jpeg' }));
    f.detectChanges();

    expect(dialogo(f).querySelector('img[alt^="Foto de la falla del aviso"]')).not.toBeNull();
  });

  it('si la foto ya no está disponible lo informa', () => {
    const f = setup('supervisor');
    tarjetas(f).flatMap((t) => botonesEn(t, 'Ver foto'))[0].click();
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/avisos/2/foto')).flush(new Blob(['no']), { status: 404, statusText: 'Not Found' });
    f.detectChanges();
    expect(texto(f)).toContain('La foto ya no está disponible.');
  });

  it('en pantalla ancha el panel de detalle muestra el aviso elegido con su foto y la decisión a la vista', () => {
    const f = setup('supervisor');
    const detalle = () => raiz(f).querySelector('[data-testid="aviso-detalle"]') as HTMLElement;
    expect(detalle().textContent).toContain('AV-2026-0001'); // por defecto, el primero
    expect(detalle().textContent).toContain('Este aviso no tiene foto.');
    expect(botonesEn(detalle(), 'Generar OT')).toHaveLength(1);

    botonesEn(tarjetas(f)[1], 'Ver detalle')[0].click();
    f.detectChanges();
    expect(detalle().textContent).toContain('AV-2026-0002');
    http.expectOne((r) => r.url.endsWith('/avisos/2/foto')).flush(new Blob(['x'], { type: 'image/jpeg' }));
    f.detectChanges();
    expect(detalle().querySelector('img')).not.toBeNull();
    expect(tarjetas(f)[1].getAttribute('aria-current')).toBe('true');
  });
});
