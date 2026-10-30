import { TestBed } from '@angular/core/testing';

import { ImpactoAnual } from '../../../../core/models';
import { ImpactoEscenariosComponent } from './impacto-escenarios.component';
import { siguelTema } from '../../../../testing/tema';

/**
 * CGBIDA-436: gráfico de Escenarios de Impacto Anual.
 *
 * Reemplaza al de Tiempo de Resolución, que duplicaba el ranking en su métrica MTTR.
 * Lo que estos tests blindan:
 *  - Que se dibujen DOS escenarios y el ahorro, que es lo que ningún otro gráfico mostraba.
 *  - Que la barra "con BARB" sea proporcional a la "sin BARB" (si no, el gráfico mentiría
 *    sobre la magnitud del ahorro).
 *  - Que con `impacto_visible = false` NO se dibujen barras en cero.
 */

const IMPACTO: ImpactoAnual = {
  escenario_sin_barb: 11_160_000,
  escenario_con_barb: 7_412_000,
  ahorro_proyectado: 3_748_000,
  incidentes_anuales: 31,
  impacto_visible: true,
  supuestos: { minutos_sin_barb: 180, costo_por_minuto: 2000, dias_periodo: 365 },
  supuestos_incompletos: false,
};

function setup(impacto: ImpactoAnual | null = IMPACTO, lang: 'es' | 'en' = 'es') {
  TestBed.resetTestingModule();
  window.localStorage.setItem('barb.lang', lang);
  window.localStorage.clear();
  window.localStorage.setItem('barb.lang', lang);
  TestBed.configureTestingModule({ imports: [ImpactoEscenariosComponent] });
  const fixture = TestBed.createComponent(ImpactoEscenariosComponent);
  fixture.componentRef.setInput('impacto', impacto);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

function ancho(el: HTMLElement, testid: string): number {
  const r = el.querySelector(`[data-testid="${testid}"]`);
  if (!r) throw new Error(`no existe ${testid}`);
  return Number(r.getAttribute('width'));
}

describe('ImpactoEscenariosComponent', () => {
  describe('estructura', () => {
    it('dibuja los dos escenarios', () => {
      const { el } = setup();
      expect(el.querySelector('[data-testid="barra-sin-barb"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="barra-con-barb"]')).not.toBeNull();
    });

    it('dibuja el tramo del ahorro', () => {
      const { el } = setup();
      expect(el.querySelector('[data-testid="tramo-ahorro"]')).not.toBeNull();
    });

    it('muestra las tres cifras', () => {
      const { el } = setup();
      expect(el.querySelector('[data-testid="valor-sin-barb"]')!.textContent).toContain('11.160.000');
      expect(el.querySelector('[data-testid="valor-con-barb"]')!.textContent).toContain('7.412.000');
      expect(el.querySelector('[data-testid="valor-ahorro"]')!.textContent).toContain('3.748.000');
    });

    it('el svg es accesible', () => {
      const { el } = setup();
      const svg = el.querySelector('svg')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBe('Escenarios de Impacto Anual');
    });

    it('tiene variantes de modo oscuro', () => {
      const { el } = setup();
      expect(siguelTema(el.querySelector('[data-testid="impacto-escenarios"]')!.className)).toBe(true);
    });
  });

  describe('proporción de las barras', () => {
    it('la barra sin BARB ocupa el ancho completo porque es la referencia', () => {
      const { el } = setup();
      const util = 720 - 120 - 16;
      expect(ancho(el, 'barra-sin-barb')).toBe(util);
    });

    it('la barra con BARB es proporcional al costo', () => {
      const { el } = setup();
      const util = 720 - 120 - 16;
      // 7.412.000 / 11.160.000 = 66,4%
      const esperado = (util * 7_412_000) / 11_160_000;
      expect(ancho(el, 'barra-con-barb')).toBeCloseTo(esperado, 1);
    });

    it('el tramo de ahorro completa la barra de referencia', () => {
      const { el } = setup();
      const util = 720 - 120 - 16;
      const segmento = ancho(el, 'tramo-ahorro');
      expect(ancho(el, 'barra-con-barb') + segmento).toBeCloseTo(util, 1);
    });

    it('con costos iguales no hay tramo de ahorro', () => {
      const { el } = setup({
        ...IMPACTO,
        escenario_con_barb: 11_160_000,
        ahorro_proyectado: 0,
      });
      expect(ancho(el, 'tramo-ahorro')).toBe(0);
    });
  });

  describe('estados sin datos', () => {
    it('con impacto_visible=false muestra el aviso y ninguna barra', () => {
      const { el } = setup({
        ...IMPACTO,
        escenario_sin_barb: null,
        escenario_con_barb: null,
        ahorro_proyectado: null,
        impacto_visible: false,
      });
      // La tarjeta sigue existiendo; lo que desaparece son las barras.
      expect(el.querySelector('[data-testid="impacto-escenarios"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="barra-sin-barb"]')).toBeNull();
      const aviso = el.querySelector('[data-testid="impacto-vacio"]');
      expect(aviso).not.toBeNull();
      expect(aviso!.textContent).toContain('90 días');
    });

    it('sin impacto (null) no rompe', () => {
      const { el } = setup(null);
      expect(el.querySelector('[data-testid="impacto-vacio"]')).not.toBeNull();
    });

    it('con escenario sin BARB en cero no dibuja proporciones imposibles', () => {
      const { el } = setup({
        ...IMPACTO,
        escenario_sin_barb: 0,
        escenario_con_barb: 0,
        ahorro_proyectado: 0,
      });
      expect(el.querySelector('[data-testid="barra-sin-barb"]')).toBeNull();
      expect(el.querySelector('[data-testid="impacto-vacio"]')).not.toBeNull();
    });
  });

  describe('i18n', () => {
    it('traduce los títulos en inglés', () => {
      const { el } = setup(IMPACTO, 'en');
      expect(el.textContent).toContain('Annual Impact Scenarios');
      expect(el.textContent).toContain('Without BARB Scenario');
      expect(el.textContent).toContain('With BARB Scenario');
    });
  });
});
