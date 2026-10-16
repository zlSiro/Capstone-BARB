import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { FinancialStats } from '../../core/models';
import { StatsService } from '../../core/services/stats.service';
import { DashboardComponent } from './dashboard.component';

/**
 * Tests del dashboard de KPIs (HU-16 / CGBIDA-392).
 *
 * Se verifica lo que la subtarea cierra:
 *  - Las 6 tarjetas de indicador, cada una con su valor y QUE mide.
 *  - El cambio de idioma afecta a las 6, no solo a una.
 *  - Las tarjetas tienen variante de modo oscuro.
 *  - Los estados de carga y de error, y que el error NO muestre ceros.
 *  - El estado del MTBF y del impacto cuando el rango no alcanza.
 */

/** Respuesta de ejemplo con los 6 KPIs visibles. */
function stats(overrides: Partial<FinancialStats> = {}): FinancialStats {
  return {
    financials: {
      ahorro_generado: 10_042_000,
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
    ...overrides,
  } as FinancialStats;
}

/**
 * Monta el dashboard.
 *
 * El I18nService lee `localStorage['barb.lang']` en su constructor, asi que hay que
 * fijar el idioma ANTES de que TestBed cree el componente.
 */
function setup(
  respuesta: FinancialStats | Error = stats(),
  lang: 'es' | 'en' = 'es',
  pendiente = false
) {
  window.localStorage.setItem('barb.lang', lang);
  const fuente = new Subject<FinancialStats>();
  const getFinancialImpact = pendiente
    ? vi.fn(() => fuente.asObservable())
    : vi.fn(() => (respuesta instanceof Error ? throwError(() => respuesta) : of(respuesta)));

  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [{ provide: StatsService, useValue: { getFinancialImpact } }],
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, getFinancialImpact, fuente };
}

/** Devuelve el texto de una tarjeta concreta por su data-testid. */
function tarjeta(el: HTMLElement, clave: string): HTMLElement {
  const t = el.querySelector(`[data-testid="kpi-${clave}"]`);
  if (!t) throw new Error(`no existe la tarjeta ${clave}`);
  return t as HTMLElement;
}

const CLAVES = ['mttr', 'sla', 'costo', 'mtbf', 'ahorro', 'impacto'];

describe('DashboardComponent', () => {
  describe('los 6 indicadores', () => {
    it('pide las metricas al servicio al construirse', () => {
      const { getFinancialImpact } = setup();
      expect(getFinancialImpact).toHaveBeenCalledWith('all');
    });

    it('renderiza exactamente las 6 tarjetas esperadas', () => {
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
      expect(tarjeta(el, 'mtbf').textContent).toContain('223.6 h');
      // El costo y el ahorro van formateados en CLP.
      expect(tarjeta(el, 'costo').textContent).toMatch(/47\.192\.065/);
      expect(tarjeta(el, 'ahorro').textContent).toMatch(/10\.042\.000/);
      expect(tarjeta(el, 'impacto').textContent).toMatch(/3\.748\.000/);
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

    it('cada tarjeta lleva al menos una clase dark:', () => {
      const { el } = setup();
      for (const clave of CLAVES) {
        const t = tarjeta(el, clave);
        expect(t.className).toContain('dark:');
        const internos = [...t.querySelectorAll('*')].some((n) => n.className.includes('dark:'));
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
      sinImpacto.impacto_anual.impacto_visible = false;
      sinImpacto.impacto_anual.ahorro_proyectado = null;
      const { el } = setup(sinImpacto);
      const texto = tarjeta(el, 'impacto').textContent ?? '';
      expect(texto).toContain('90 dias');
      expect(texto).not.toContain('null');
    });

    it('con supuestos_incompletos lo refleja en la descripcion', () => {
      const incompleto = stats();
      incompleto.impacto_anual.supuestos_incompletos = true;
      const { el } = setup(incompleto);
      expect(tarjeta(el, 'impacto').textContent).toContain('Estimado');
    });

    it('no muestra ceros cuando el backend no puede calcular', () => {
      // Este es el criterio de la HU: avisar en vez de mostrar ceros.
      const vacio = stats();
      vacio.financials.mtbfHours = null;
      vacio.financials.mtbf_visible = false;
      vacio.impacto_anual.ahorro_proyectado = null;
      vacio.impacto_anual.impacto_visible = false;
      const { el } = setup(vacio);
      expect(tarjeta(el, 'mtbf').textContent).not.toMatch(/\b0 h\b/);
      expect(tarjeta(el, 'impacto').textContent).not.toMatch(/\$\s?0\b/);
    });
  });

  describe('i18n', () => {
    /**
     * Monta el componente en un idioma y devuelve su texto.
     *
     * `TestBed.resetTestingModule()` es imprescindible: el I18nService es
     * `providedIn: 'root'` y se cachea entre montajes, asi que sin el reset el segundo
     * `setup()` reutiliza la instancia anterior y el idioma no cambia.
     */
    function textoEn(lang: 'es' | 'en'): string {
      TestBed.resetTestingModule();
      return setup(stats(), lang).el.textContent ?? '';
    }

    it('en espanol muestra las etiquetas en espanol', () => {
      const texto = textoEn('es');
      expect(texto).toContain('MTTR Global');
      expect(texto).toContain('Cumplimiento de SLA');
      expect(texto).toContain('Costo Directo');
      expect(texto).toContain('Ahorro Generado a la fecha');
    });

    it('en ingles muestra las MISMAS 6 etiquetas traducidas', () => {
      const texto = textoEn('en');
      expect(texto).toContain('Global MTTR');
      expect(texto).toContain('SLA Compliance');
      expect(texto).toContain('Direct Cost');
      expect(texto).toContain('Savings Generated to Date');
      expect(texto).toContain('Projected Annual Impact');
    });

    it('traduce las descripciones, no solo las etiquetas', () => {
      const es = textoEn('es');
      const en = textoEn('en');
      expect(es).toContain('Tiempo medio de reparacion');
      expect(en).toContain('Average repair time');
      expect(es).not.toEqual(en);
    });

    it('el titulo de la pagina cambia de idioma', () => {
      expect(textoEn('es')).toContain('Dashboard KPI');
      expect(textoEn('en')).toContain('KPI Dashboard');
    });

    it('las 6 tarjetas siguen presentes al cambiar de idioma', () => {
      TestBed.resetTestingModule();
      const { el } = setup(stats(), 'en');
      for (const clave of CLAVES) {
        expect(tarjeta(el, clave)).toBeTruthy();
      }
    });
  });

  describe('estados de carga y error', () => {
    it('mientras carga muestra el aviso y ninguna tarjeta', () => {
      const { el } = setup(stats(), 'es', true);
      expect(el.textContent).toContain('Cargando KPIs');
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(0);
    });

    it('si falla la llamada muestra el error y NO muestra tarjetas', () => {
      const { el } = setup(new Error('503'), 'es');
      expect(el.textContent).toContain('No se pudieron cargar los KPIs');
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(0);
    });

    it('el error no muestra ceros', () => {
      const { el } = setup(new Error('503'), 'es');
      const texto = el.textContent ?? '';
      expect(texto).not.toMatch(/\$\s?0\b/);
      expect(texto).not.toContain('0%');
    });

    it('el aviso de error es una alerta accesible', () => {
      const { el } = setup(new Error('503'), 'es');
      expect(el.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('el aviso de carga es un estado accesible', () => {
      const { el } = setup(stats(), 'es', true);
      expect(el.querySelector('[role="status"]')).not.toBeNull();
    });
  });

  describe('formato de moneda', () => {
    it('usa separador de miles y no muestra decimales', () => {
      const { el } = setup();
      const texto = tarjeta(el, 'costo').textContent ?? '';
      expect(texto).toMatch(/47\.192\.065/);
      expect(texto).not.toMatch(/47\.192\.065[.,]\d/);
    });
  });
});
