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
  // El grafico historico (CGBIDA-515) es hijo y pide sus propios datos.
  const getHistorical = vi.fn(() => of({ granularity: 'month' as const, periods: [] }));

  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [{ provide: StatsService, useValue: { getFinancialImpact, getHistorical } }],
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

// El KPI de Impacto se elimino en CGBIDA-435: su cifra vive en el grafico de abajo.
const CLAVES = ['mttr', 'sla', 'costo', 'mtbf', 'ahorro'];

/** Lo que recibe un supervisor o un ingeniero: el backend omite todo campo de costo (`ver_kpis_financieros`). */
function statsSinFinanzas(): FinancialStats {
  const completo = stats();
  const { ahorro_generado: _a, costo_total_acumulado: _c, ...financials } = completo.financials;
  const { impacto_anual: _i, machines_por_costo: _m, ...resto } = completo;
  return {
    ...resto,
    financials,
    // Una máquina operativa (sin ahorro ni costo): el ranking solo se dibuja si hay equipos.
    machines: [{ id: '1', name: 'Bomba BP-3', total: 4, mttr: 35, slaCompliance: 90 }],
    financieros_visibles: false,
  };
}

describe('DashboardComponent', () => {
  describe('sin acceso a los KPIs financieros (supervisor, ingeniero)', () => {
    it('muestra solo las tarjetas operativas, sin costo ni ahorro', () => {
      const { el } = setup(statsSinFinanzas());
      const claves = [...el.querySelectorAll('[data-testid^="kpi-"]')].map((n) =>
        (n as HTMLElement).dataset['testid']?.replace('kpi-', '')
      );
      expect(claves.sort()).toEqual(['mtbf', 'mttr', 'sla']);
    });

    it('oculta el impacto anual y las métricas de ahorro y costo del ranking', () => {
      const { el } = setup(statsSinFinanzas());
      expect(el.querySelector('app-impacto-escenarios')).toBeNull();
      const valores = [...el.querySelectorAll('[data-testid="selector-metrica"] option')].map((o) => (o as HTMLOptionElement).value);
      expect(valores).toEqual(['ots', 'mttr']);
    });

    it('sigue mostrando los KPIs operativos y la salud operacional', () => {
      const { el } = setup(statsSinFinanzas());
      expect(tarjeta(el, 'mttr').textContent).toContain('88.1m');
      expect(el.querySelector('app-salud-operacional')).not.toBeNull();
    });

    it('con el gerente (financieros_visibles ausente o true) conserva las 5 tarjetas y el impacto', () => {
      const { el } = setup();
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(5);
      expect(el.querySelector('app-impacto-escenarios')).not.toBeNull();
    });
  });

  describe('los 5 indicadores', () => {
    it('pide las metricas al servicio al construirse', () => {
      const { getFinancialImpact } = setup();
      expect(getFinancialImpact).toHaveBeenCalledWith('all');
    });

    it('renderiza exactamente las 5 tarjetas esperadas', () => {
      const { el } = setup();
      const claves = [...el.querySelectorAll('[data-testid^="kpi-"]')].map((n) =>
        (n as HTMLElement).dataset['testid']?.replace('kpi-', '')
      );
      expect(claves.sort()).toEqual([...CLAVES].sort());
    });

    it('cada tarjeta muestra su valor calculado', () => {
      const { el } = setup();
      expect(tarjeta(el, 'mttr').textContent).toContain('88.1m');
      expect(tarjeta(el, 'sla').textContent).toContain('97.7%');
      expect(tarjeta(el, 'mtbf').textContent).toContain('9.3 d');
      // El costo y el ahorro van formateados en CLP.
      expect(tarjeta(el, 'costo').textContent).toMatch(/47\.192\.065/);
      expect(tarjeta(el, 'ahorro').textContent).toMatch(/10\.042\.000/);
      // El impacto ya no es tarjeta: se comprueba en el grafico de escenarios.
      expect(el.textContent).toMatch(/3\.748\.000/);
    });

    it('cada tarjeta dice QUE mide, no solo el numero', () => {
      const { el } = setup();
      for (const clave of CLAVES) {
        const textos = [...tarjeta(el, clave).querySelectorAll('p')].map((p) => p.textContent ?? '');
        // Etiqueta + valor + descripcion = 3 parrafos, y la descripcion no puede ir vacia.
        expect(textos.length).toBe(3);
        expect(textos[2].trim().length).toBeGreaterThan(0);
      }
    });

    it('cada tarjeta usa colores del tema (claro y oscuro)', () => {
      const { el } = setup();
      for (const clave of CLAVES) {
        const t = tarjeta(el, clave);
        expect(siguelTema(t.className)).toBe(true);
        const internos = [...t.querySelectorAll('*')].some((n) => siguelTema(n.className));
        expect(internos).toBe(true);
      }
    });
  });

  describe('estado del MTBF y del impacto', () => {
    it('con mtbf_visible=false muestra el aviso en vez de un numero', () => {
      const sinMtbf = stats();
      sinMtbf.financials.mtbfHours = null;
      sinMtbf.financials.mtbf_visible = false;
      const { el } = setup(sinMtbf);
      const texto = tarjeta(el, 'mtbf').textContent ?? '';
      expect(texto).toContain('Requiere historial');
      expect(texto).not.toContain('null');
    });

    it('con impacto_visible=false muestra el aviso en vez de un numero', () => {
      const sinImpacto = stats();
      sinImpacto.impacto_anual!.impacto_visible = false;
      sinImpacto.impacto_anual!.ahorro_proyectado = null;
      const { el } = setup(sinImpacto);
      // CGBIDA-435: el aviso vive en el grafico de escenarios, no en una tarjeta de KPI.
      const texto = el.querySelector('[data-testid="impacto-vacio"]')?.textContent ?? '';
      expect(texto).toContain('90 días');
      expect(texto).not.toContain('null');
    });

    it('con supuestos_incompletos lo refleja en el subtitulo del grafico', () => {
      const incompleto = stats();
      incompleto.impacto_anual!.supuestos_incompletos = true;
      const { el } = setup(incompleto);
      // El aviso de "estimado" se mudo con el KPI al grafico.
      expect(el.querySelector('[data-testid="impacto-escenarios"]')!.textContent).toContain(
        'Estimado'
      );
    });

    it('no muestra ceros cuando el backend no puede calcular', () => {
      // Este es el criterio de la HU: avisar en vez de mostrar ceros.
      const vacio = stats();
      vacio.financials.mtbfHours = null;
      vacio.financials.mtbf_visible = false;
      vacio.impacto_anual!.ahorro_proyectado = null;
      vacio.impacto_anual!.impacto_visible = false;
      const { el } = setup(vacio);
      expect(tarjeta(el, 'mtbf').textContent).not.toMatch(/\b0 d\b/);
      expect(el.querySelector('[data-testid="impacto-vacio"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="valor-ahorro"]')).toBeNull();
    });
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

describe('dashboard: graficos nuevos (CGBIDA-515, 516, 517)', () => {
  it('integra el historico de SLA y el top 5 sin romper las tarjetas', () => {
    const { el } = setup();
    expect(el.querySelector('app-sla-historico')).not.toBeNull();
    expect(el.querySelector('app-top-maquinas')).not.toBeNull();
    expect(clavesKpi(el)).toHaveLength(5);
  });

  it('el top 5 de MTTR usa la lista de la respuesta', () => {
    const conTop = stats();
    conTop.top_5_peor_mttr = [{ id: 'x1', name: 'Pump E4', mttr: 289.8, completadas: 5 }];
    const { el } = setup(conTop);
    const filas = el.querySelectorAll('[data-testid="top-mttr-fila"]');
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain('Pump E4');
  });

  it('el top 5 de MTBF usa la lista de la respuesta', () => {
    const conTop = stats();
    conTop.top_5_peor_mtbf = [{ id: 'x2', name: 'Press B3', mtbf_hours: 2920, fallas: 3 }];
    const { el } = setup(conTop);
    const filas = el.querySelectorAll('[data-testid="top-mtbf-fila"]');
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain('Press B3');
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
