import { TestBed } from '@angular/core/testing';

import { TrendData } from '../../../../core/models';
import { BacklogChartComponent } from './backlog-chart.component';

/**
 * Tests del grafico de backlog (HU-16 / CGBIDA-393).
 *
 * Se verifica lo que fija la replica del legacy (`FinancialDashboard.jsx:155-176`):
 * tipo area con curva monotone, colores amber/green, cuadricula solo horizontal, eje X en
 * MM-DD, eje Y entero, tooltip y auto-ocultado cuando no hay datos.
 */

function serie(abiertas: number[], cerradas: number[]): TrendData[] {
  return abiertas.map((a, i) => ({
    date: `2026-10-${String(i + 3).padStart(2, '0')}`,
    abiertas: a,
    cerradas: cerradas[i],
  }));
}

/** Los datos reales que devuelve el backend para la empresa 1 hoy. */
const REALES = serie(
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
);

function setup(puntos: TrendData[], lang: 'es' | 'en' = 'es') {
  TestBed.resetTestingModule();
  window.localStorage.setItem('barb.lang', lang);
  TestBed.configureTestingModule({ imports: [BacklogChartComponent] });
  const fixture = TestBed.createComponent(BacklogChartComponent);
  fixture.componentRef.setInput('puntos', puntos);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const AMBER = '#d97706';
const GREEN = '#059669';

describe('BacklogChartComponent', () => {
  describe('estructura y auto-ocultado', () => {
    it('renderiza el grafico cuando hay puntos', () => {
      const { el } = setup(REALES);
      expect(el.querySelector('[data-testid="backlog-chart"]')).not.toBeNull();
      expect(el.querySelector('svg')).not.toBeNull();
    });

    it('no renderiza NADA cuando la serie esta vacia, como el legacy', () => {
      const { el } = setup([]);
      expect(el.querySelector('[data-testid="backlog-chart"]')).toBeNull();
      expect(el.querySelector('svg')).toBeNull();
    });

    it('muestra el titulo y el subtitulo del bloque i18n', () => {
      const { el } = setup(REALES, 'es');
      expect(el.textContent).toContain('Salud Operacional: Backlog');
      expect(el.textContent).toContain('14 d');
    });
  });

  describe('replica del legacy', () => {
    it('dibuja dos lineas: abiertas y cerradas', () => {
      const { el } = setup(REALES);
      const abiertas = el.querySelector('[data-testid="linea-abiertas"]');
      const cerradas = el.querySelector('[data-testid="linea-cerradas"]');
      expect(abiertas).not.toBeNull();
      expect(cerradas).not.toBeNull();
      // strokeWidth={2} del legacy
      expect(abiertas!.getAttribute('stroke-width')).toBe('2');
      expect(cerradas!.getAttribute('stroke-width')).toBe('2');
    });

    it('usa los colores exactos del legacy: amber y green', () => {
      const { el } = setup(REALES);
      expect(el.querySelector('[data-testid="linea-abiertas"]')!.getAttribute('stroke')).toBe(AMBER);
      expect(el.querySelector('[data-testid="linea-cerradas"]')!.getAttribute('stroke')).toBe(GREEN);
    });

    it('usa relleno en gradiente y no color plano', () => {
      const { el } = setup(REALES);
      const areas = [...el.querySelectorAll('path[fill^="url("]')];
      expect(areas.length).toBe(2);
      expect(el.querySelector('#backlog-abiertas')).not.toBeNull();
      expect(el.querySelector('#backlog-cerradas')).not.toBeNull();
      // stop-opacity 0.3 -> 0, como los <stop> del legacy
      const stops = [...el.querySelectorAll('#backlog-abiertas stop')];
      expect(stops.map((s) => s.getAttribute('stop-opacity'))).toEqual(['0.3', '0']);
    });

    it('la cuadricula es solo horizontal', () => {
      const { el } = setup(REALES);
      const lineas = [...el.querySelectorAll('svg line')];
      expect(lineas.length).toBeGreaterThan(0);
      for (const l of lineas) {
        // Todas las lineas de cuadricula son horizontales: y1 == y2.
        expect(l.getAttribute('y1')).toBe(l.getAttribute('y2'));
      }
    });

    it('no dibuja marcadores en los vertices, como el legacy', () => {
      const { el } = setup(REALES);
      // El legacy no define `dot` ni `activeDot`, asi que no hay circulos de serie.
      expect(el.querySelectorAll('svg circle').length).toBe(0);
    });

    it('el eje X muestra MM-DD sin anio', () => {
      const { el } = setup(REALES);
      const textos = [...el.querySelectorAll('svg text')].map((t) => t.textContent?.trim());
      expect(textos).toContain('10-03');
      expect(textos).toContain('10-16');
      // No debe aparecer el anio en el eje.
      expect(textos.some((t) => t?.startsWith('2026'))).toBe(false);
    });

    it('el eje Y usa valores enteros', () => {
      const { el } = setup(serie([0, 3, 1], [1, 0, 2]));
      const marcas = [...el.querySelectorAll('svg text')]
        .map((t) => t.textContent?.trim() ?? '')
        .filter((t) => /^\d+$/.test(t));
      expect(marcas.length).toBeGreaterThan(0);
      for (const m of marcas) {
        expect(Number.isInteger(Number(m))).toBe(true);
      }
      // El maximo del eje es el mayor valor de las series.
      expect(marcas).toContain('3');
    });

    it('con la serie toda en cero el eje no divide por cero', () => {
      const { el } = setup(serie([0, 0, 0], [0, 0, 0]));
      expect(el.querySelector('svg')).not.toBeNull();
      const d = el.querySelector('[data-testid="linea-abiertas"]')!.getAttribute('d') ?? '';
      expect(d).not.toContain('NaN');
      expect(d).not.toContain('Infinity');
    });
  });

  describe('curva monotone', () => {
    it('la linea usa curvas cubicas, no segmentos rectos', () => {
      const { el } = setup(serie([0, 2, 1, 3], [1, 0, 2, 1]));
      const d = el.querySelector('[data-testid="linea-abiertas"]')!.getAttribute('d') ?? '';
      expect(d.startsWith('M ')).toBe(true);
      // `type="monotone"` de recharts produce cubicas: comando C, no L.
      expect(d).toContain(' C ');
      expect(d).not.toContain(' L ');
    });

    it('las coordenadas de la curva son numeros finitos', () => {
      const { el } = setup(serie([0, 2, 1, 3, 0], [1, 0, 2, 1, 0]));
      for (const id of ['linea-abiertas', 'linea-cerradas']) {
        const d = el.querySelector(`[data-testid="${id}"]`)!.getAttribute('d') ?? '';
        expect(d).not.toMatch(/NaN|Infinity|undefined/);
      }
    });

    it('el area cierra el path hasta la base', () => {
      const { el } = setup(REALES);
      const areas = [...el.querySelectorAll('path[fill^="url("]')];
      for (const a of areas) {
        expect(a.getAttribute('d')!.trim().endsWith('Z')).toBe(true);
      }
    });
  });

  describe('tooltip', () => {
    it('no hay tooltip al inicio', () => {
      const { el } = setup(REALES);
      expect(el.querySelector('[data-testid="backlog-tooltip"]')).toBeNull();
    });

    it('al pasar el cursor por una banda aparece el tooltip con los valores', () => {
      const { fixture, el } = setup(REALES);
      const banda = el.querySelector('[data-testid="banda-6"]') as SVGRectElement;
      banda.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();

      const tip = el.querySelector('[data-testid="backlog-tooltip"]');
      expect(tip).not.toBeNull();
      const texto = tip!.textContent ?? '';
      expect(texto).toContain('2026-10-09');
      // i18n, no la clave cruda del dataKey como hacia el legacy.
      expect(texto).toContain('Abiertas');
      expect(texto).toContain('Cerradas');
    });

    it('hay una banda de hover por cada punto', () => {
      const { el } = setup(REALES);
      expect(el.querySelectorAll('[data-testid^="banda-"]').length).toBe(14);
    });

    it('al salir del svg el tooltip desaparece', () => {
      const { fixture, el } = setup(REALES);
      (el.querySelector('[data-testid="banda-0"]') as SVGRectElement)
        .dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="backlog-tooltip"]')).not.toBeNull();

      el.querySelector('svg')!.dispatchEvent(new MouseEvent('mouseleave'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="backlog-tooltip"]')).toBeNull();
    });
  });

  describe('i18n y dark mode', () => {
    it('traduce los nombres de las series', () => {
      const es = setup(REALES, 'es').el.textContent ?? '';
      expect(es).toContain('Abiertas');
      expect(es).toContain('Cerradas');

      const en = setup(REALES, 'en').el.textContent ?? '';
      expect(en).toContain('Open');
      expect(en).toContain('Closed');
    });

    it('traduce el titulo del grafico', () => {
      expect(setup(REALES, 'es').el.textContent).toContain('Salud Operacional');
      expect(setup(REALES, 'en').el.textContent).toContain('Operational Health');
    });

    it('la tarjeta tiene variantes de modo oscuro', () => {
      const { el } = setup(REALES);
      const card = el.querySelector('[data-testid="backlog-chart"]')!;
      expect(card.className).toContain('dark:');
    });

    it('la cuadricula y las etiquetas tienen variante oscura', () => {
      const { el } = setup(REALES);
      // En SVG, `className` es un SVGAnimatedString: hay que leer `.baseVal`.
      const conDark = [...el.querySelectorAll('svg *')].some((n) => {
        const c = n.className;
        const texto = typeof c === 'string' ? c : (c as SVGAnimatedString).baseVal;
        return texto.includes('dark:');
      });
      expect(conDark).toBe(true);
    });

    it('el svg es accesible con role img y etiqueta', () => {
      const { el } = setup(REALES);
      const svg = el.querySelector('svg')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBeTruthy();
    });
  });
});
