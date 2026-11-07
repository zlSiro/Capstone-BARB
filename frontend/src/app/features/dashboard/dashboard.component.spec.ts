import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { FinancialStats } from '../../core/models';
import { StatsService } from '../../core/services/stats.service';
import { DashboardComponent } from './dashboard.component';

/**
 * Tests del dashboard tras el rediseño (CGBIDA-515, 518, 519, 520, 521).
 *
 * Lo que se protege acá:
 *  - El orden de las tarjetas: **SLA primero** (CGBIDA-515).
 *  - La tarjeta de **Disponibilidad de Planta** en lugar de Ahorro (CGBIDA-519).
 *  - El **modal de costos**: abre desde el botón, cierra con X, con ESC y con overlay
 *    (CGBIDA-518), y muestra el desglose ordenado por costo.
 *  - El gráfico de **Escenarios de Impacto Anual** ya no existe (CGBIDA-521).
 *  - El semáforo simplificado llega al componente hijo (CGBIDA-520).
 */

/** Respuesta de ejemplo con los 5 KPIs nuevas y el semáforo simplificado. */
function stats(overrides: Partial<FinancialStats> = {}): FinancialStats {
  return {
    financials: {
      ahorro_generado: 10_042_000,
      disponibilidad_planta: 96.4,
      mttr: 88.1,
      efficiency: 97.7,
      costo_total_acumulado: 47_192_065.25,
      mtbfHours: 223.6,
      mtbf_visible: true,
    },
    impacto_anual: {
      escenario_sin_barb: 11_160_000,
      escenario_con_barb: 7_412_000,
      ahorro_proyectado: 3_748_000,
      incidentes_anuales: 31,
      impacto_visible: true,
      supuestos: { minutos_sin_barb: 180, costo_por_minuto: 2000, dias_periodo: 365 },
      supuestos_incompletos: false,
    },
    trend14Days: [],
    machines: [],
    machines_por_costo: [
      {
        id: 'm1', name: 'Pump E4', total: 12,
        ahorroGenerado: 0, mttr: 120, slaCompliance: 90, costo_total: 3_000_000,
      },
      {
        id: 'm2', name: 'Cinta C1', total: 8,
        ahorroGenerado: 0, mttr: 90, slaCompliance: 95, costo_total: 1_000_000,
      },
    ],
    por_tipo: [],
    estancadas: { total: 0, vencidas: 0, demoradas: 0, umbral_dias: 7 },
    salud_operacional: {
      estado: 'rojo',
      motivo: '13 OT(s) vencida(s) sin cerrar.',
      sla: 97.7,
      estancadas: 15,
      vencidas: 13,
    },
    ...overrides,
  } as FinancialStats;
}

/**
 * Monta el dashboard.
 *
 * El I18nService lee `localStorage['barb.lang']` en su constructor, asi que hay que
 * fijar el idioma ANTES de que TestBed cree el componente.
 */
function setup(respuesta: FinancialStats | Error = stats(), lang: 'es' | 'en' = 'es') {
  window.localStorage.setItem('barb.lang', lang);
  const getFinancialImpact = vi.fn(() =>
    respuesta instanceof Error ? throwError(() => respuesta) : of(respuesta)
  );

  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [{ provide: StatsService, useValue: { getFinancialImpact } }],
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, getFinancialImpact };
}

/** Claves de las tarjetas de KPI renderizadas, en orden. */
function clavesKpi(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-testid^="kpi-"]')]
    .map((n) => (n as HTMLElement).dataset['testid']?.replace('kpi-', '') ?? '')
    .filter(Boolean);
}

describe('dashboard: KPIs', () => {
  it('renderiza 5 tarjetas', () => {
    const { el } = setup();
    expect(clavesKpi(el)).toHaveLength(5);
  });

  it('pone el SLA primero (CGBIDA-515)', () => {
    const { el } = setup();
    expect(clavesKpi(el)[0]).toBe('sla');
  });

  it('muestra las 5 claves en el orden pedido', () => {
    const { el } = setup();
    expect(clavesKpi(el)).toEqual(['sla', 'disponibilidad', 'mttr', 'costo', 'mtbf']);
  });

  it('reemplaza Ahorro Generado por Disponibilidad de Planta (CGBIDA-519)', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid="kpi-ahorro"]')).toBeNull();
    const disp = el.querySelector('[data-testid="kpi-disponibilidad"]');
    expect(disp).not.toBeNull();
    expect(disp!.textContent).toContain('96.4%');
  });

  it('ya no renderiza el grafico de Escenarios de Impacto Anual (CGBIDA-521)', () => {
    const { el } = setup();
    expect(el.querySelector('app-impacto-escenarios')).toBeNull();
    expect(el.querySelector('[data-testid="impacto-escenarios"]')).toBeNull();
  });

  it('pide los datos con el rango elegido', () => {
    const { getFinancialImpact } = setup();
    expect(getFinancialImpact).toHaveBeenCalledWith('all');
  });

  it('en ingles cambia la etiqueta de la tarjeta de disponibilidad', () => {
    const { el } = setup(stats(), 'en');
    expect(el.textContent).toContain('Plant Availability');
  });

  it('el error no muestra ceros: muestra el aviso', () => {
    const { el } = setup(new Error('boom'));
    expect(el.textContent).toContain('No se pudieron cargar los KPIs');
    expect(el.querySelectorAll('[data-testid^="kpi-"]')).toHaveLength(0);
  });
});

describe('dashboard: semaforo simplificado (CGBIDA-520)', () => {
  it('el hijo recibe estado y motivo del backend', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid="estado-salud"]')?.textContent).toContain('Crítico');
    expect(el.querySelector('[data-testid="motivo-salud"]')?.textContent).toContain(
      '13 OT(s) vencida(s) sin cerrar.'
    );
  });

  it('muestra el SLA y las OTs vencidas en la linea simple', () => {
    const { el } = setup();
    const resumen = el.querySelector('[data-testid="resumen-salud"]')!.textContent ?? '';
    expect(resumen).toContain('97.7%');
    expect(resumen).toContain('13');
  });
});

describe('dashboard: modal de costos (CGBIDA-518)', () => {
  it('el boton "Ver detalle" aparece solo en la tarjeta de costo', () => {
    const { el } = setup();
    const botones = el.querySelectorAll('[data-testid="ver-detalle-costos"]');
    expect(botones).toHaveLength(1);
    expect(el.querySelector('[data-testid="kpi-costo"]')!.contains(botones[0])).toBe(true);
  });

  it('no muestra el modal hasta hacer clic', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid="modal-costos"]')).toBeNull();
  });

  it('abre el modal con overlay al hacer clic', () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-testid="ver-detalle-costos"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="modal-costos"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="overlay-costos"]')).not.toBeNull();
  });

  it('muestra el desglose ordenado por costo y el total', () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-testid="ver-detalle-costos"]') as HTMLElement).click();
    fixture.detectChanges();
    const filas = [...el.querySelectorAll('[data-testid^="costo-fila-"]')].map(
      (n) => n.textContent ?? ''
    );
    expect(filas).toHaveLength(2);
    // La de mayor costo va primero.
    expect(filas[0]).toContain('Pump E4');
    expect(filas[1]).toContain('Cinta C1');
    expect(el.querySelector('[data-testid="costo-total"]')!.textContent).toBeTruthy();
  });

  it('cierra con la X', () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-testid="ver-detalle-costos"]') as HTMLElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="cerrar-costos"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="modal-costos"]')).toBeNull();
  });

  it('cierra con la tecla ESC', () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-testid="ver-detalle-costos"]') as HTMLElement).click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="modal-costos"]')).toBeNull();
  });

  it('cierra al hacer clic en el overlay', () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-testid="ver-detalle-costos"]') as HTMLElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="overlay-costos"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="modal-costos"]')).toBeNull();
  });

  it('sin costos muestra el estado vacio', () => {
    const vacio = stats();
    vacio.machines_por_costo = [];
    const { fixture, el } = setup(vacio);
    (el.querySelector('[data-testid="ver-detalle-costos"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="costos-vacio"]')).not.toBeNull();
  });
});
