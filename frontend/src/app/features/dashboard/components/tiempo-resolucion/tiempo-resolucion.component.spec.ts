import { TestBed } from '@angular/core/testing';

import { MachineData } from '../../../../core/models';
import { TiempoResolucionComponent } from './tiempo-resolucion.component';

/**
 * Tests del gráfico de tiempo de resolución por máquina (CGBIDA-400).
 *
 * Se fija lo que lo hace legible y lo que lo distingue de los demás gráficos:
 *  - Una barra por máquina, con el MTTR como altura.
 *  - Etiquetas del eje X inclinadas y ancladas al extremo, para que no se pisen.
 *  - Cuadrícula solo horizontal y eje Y con sufijo de minutos.
 *  - Tooltip flotante con nombre, MTTR y OTs, que desaparece al salir.
 */

const MAQUINAS: MachineData[] = [
  { id: '1', name: 'PLC Siemens S7 Principal', total: 16, ahorroGenerado: 638_000, mttr: 52.7, slaCompliance: 100 },
  { id: '2', name: 'Sistema Chiller Central', total: 15, ahorroGenerado: 3_206_000, mttr: 203.4, slaCompliance: 90 },
  { id: '3', name: 'Compressor A1', total: 14, ahorroGenerado: 442_000, mttr: 58.6, slaCompliance: 95 },
];

function setup(maquinas: MachineData[], lang: 'es' | 'en' = 'es') {
  TestBed.resetTestingModule();
  window.localStorage.setItem('barb.lang', lang);
  TestBed.configureTestingModule({ imports: [TiempoResolucionComponent] });
  const fixture = TestBed.createComponent(TiempoResolucionComponent);
  fixture.componentRef.setInput('maquinas', maquinas);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

function barra(el: HTMLElement, id: string): SVGPathElement {
  const b = el.querySelector(`[data-testid="resolucion-barra-${id}"]`);
  if (!b) throw new Error(`no existe la barra ${id}`);
  return b as SVGPathElement;
}

describe('TiempoResolucionComponent', () => {
  describe('estructura', () => {
    it('dibuja una barra por máquina', () => {
      const { el } = setup(MAQUINAS);
      expect(el.querySelectorAll('[data-testid^="resolucion-barra-"]').length).toBe(3);
    });

    it('una zona de hover por barra', () => {
      const { el } = setup(MAQUINAS);
      expect(el.querySelectorAll('[data-testid^="resolucion-zona-"]').length).toBe(3);
    });

    it('cada barra tiene un color distinto de la paleta', () => {
      const { el } = setup(MAQUINAS);
      const colores = MAQUINAS.map((m) => barra(el, m.id).getAttribute('fill')!);
      colores.forEach((c) => {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
        expect(c).not.toContain('var(');
      });
      expect(new Set(colores).size).toBe(3);
    });

    it('muestra el título y el subtítulo del bloque i18n', () => {
      const { el } = setup(MAQUINAS);
      expect(el.textContent).toContain('Tiempo de resolución');
      expect(el.textContent).toContain('Tiempo medio de reparación por máquina');
    });

    it('el svg es accesible con role img y etiqueta', () => {
      const { el } = setup(MAQUINAS);
      const svg = el.querySelector('svg')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBe('Tiempo de resolución');
    });
  });

  describe('ejes', () => {
    it('el eje Y rotula en minutos', () => {
      const { el } = setup(MAQUINAS);
      const textos = [...el.querySelectorAll('svg text')].map((t) => t.textContent ?? '');
      const minutos = textos.filter((t) => /^\d+m$/.test(t.trim()));
      expect(minutos.length).toBeGreaterThanOrEqual(3);
    });

    it('el tope del eje Y se redondea por encima del MTTR máximo', () => {
      // El máximo es 203.4, así que el tope tiene que ser al menos 250.
      const { el } = setup(MAQUINAS);
      const textos = [...el.querySelectorAll('svg text')].map((t) => (t.textContent ?? '').trim());
      expect(textos).toContain('250m');
    });

    it('las etiquetas del eje X van giradas 45 grados y ancladas al extremo', () => {
      // Sin esto los nombres de máquina se pisarían entre sí.
      const { el } = setup(MAQUINAS);
      const etiquetas = [...el.querySelectorAll('[data-testid^="resolucion-etiqueta-"]')];
      expect(etiquetas.length).toBe(3);
      etiquetas.forEach((e) => {
        expect(e.getAttribute('transform')).toMatch(/^rotate\(-45 /);
        expect(e.getAttribute('text-anchor')).toBe('end');
      });
    });

    it('la cuadrícula es solo horizontal', () => {
      // Solo líneas con y1 === y2: si hubiera verticales, y1 y y2 diferirían.
      const { el } = setup(MAQUINAS);
      const lineas = [...el.querySelectorAll('svg line')];
      expect(lineas.length).toBeGreaterThan(0);
      lineas.forEach((l) => expect(l.getAttribute('y1')).toBe(l.getAttribute('y2')));
    });
  });

  describe('proporción de las barras', () => {
    it('la barra más alta corresponde al MTTR más alto', () => {
      const { el } = setup(MAQUINAS);
      // Compárese la coordenada Y del borde superior: menor Y = barra más alta.
      const ySuperior = (id: string) => {
        const d = barra(el, id).getAttribute('d')!;
        const m = d.match(/L\s+[\d.]+,\s*([\d.]+)/);
        return Number(m![1]);
      };
      expect(ySuperior('2')).toBeLessThan(ySuperior('1'));
      expect(ySuperior('2')).toBeLessThan(ySuperior('3'));
    });

    it('con MTTR en cero la barra no colapsa ni produce NaN', () => {
      const { el } = setup([{ ...MAQUINAS[0], mttr: 0 }]);
      const d = barra(el, '1').getAttribute('d')!;
      expect(d).not.toMatch(/NaN|Infinity/);
    });
  });

  describe('tooltip', () => {
    function entrar(el: HTMLElement, id: string) {
      const zona = el.querySelector(`[data-testid="resolucion-zona-${id}"]`)!;
      zona.dispatchEvent(new MouseEvent('mouseenter'));
      return zona;
    }

    it('no hay tooltip al inicio', () => {
      const { el } = setup(MAQUINAS);
      expect(el.querySelector('[data-testid="resolucion-tooltip"]')).toBeNull();
    });

    it('al pasar el cursor muestra nombre, MTTR y OTs', () => {
      const { fixture, el } = setup(MAQUINAS);
      entrar(el, '2');
      fixture.detectChanges();
      const tip = el.querySelector('[data-testid="resolucion-tooltip"]')!;
      expect(tip).not.toBeNull();
      expect(tip.textContent).toContain('Sistema Chiller Central');
      expect(tip.textContent).toContain('203 min');
      expect(tip.textContent).toContain('15');
      expect(tip.textContent).toContain('MTTR');
      expect(tip.textContent).toContain('Volumen de OTs');
    });

    it('es flotante y no intercepta el mouse', () => {
      // `pointer-events-none` es lo que evita el parpadeo: si el tooltip capturara el
      // mouse taparía la zona de hover y se dispararía el mouseleave en loop.
      const { fixture, el } = setup(MAQUINAS);
      entrar(el, '1');
      fixture.detectChanges();
      const tip = el.querySelector('[data-testid="resolucion-tooltip"]') as HTMLElement;
      expect(tip.className).toContain('absolute');
      expect(tip.className).toContain('pointer-events-none');
    });

    it('desaparece al salir del svg', () => {
      const { fixture, el } = setup(MAQUINAS);
      entrar(el, '1');
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="resolucion-tooltip"]')).not.toBeNull();
      el.querySelector('svg')!.dispatchEvent(new MouseEvent('mouseleave'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="resolucion-tooltip"]')).toBeNull();
    });

    it('en inglés traduce las etiquetas del tooltip', () => {
      const { fixture, el } = setup(MAQUINAS, 'en');
      entrar(el, '3');
      fixture.detectChanges();
      const tip = el.querySelector('[data-testid="resolucion-tooltip"]')!;
      expect(tip.textContent).toContain('WO volume');
      expect(el.textContent).toContain('Resolution time');
    });
  });

  describe('casos borde', () => {
    it('sin máquinas muestra el aviso y no dibuja el gráfico', () => {
      const { el } = setup([]);
      expect(el.querySelector('[data-testid="tiempo-resolucion"]')).toBeNull();
      expect(el.querySelector('[data-testid="resolucion-vacio"]')).not.toBeNull();
      expect(el.textContent).toContain('Sin datos');
    });

    it('con un nombre largo lo trunca con elipsis', () => {
      const { el } = setup([
        { ...MAQUINAS[0], id: '9', name: 'Máquina con un nombre larguísimo de verdad' },
      ]);
      const etiqueta = el.querySelector('[data-testid="resolucion-etiqueta-9"]')!;
      expect(etiqueta.textContent).toContain('…');
    });

    it('la tarjeta tiene variantes de modo oscuro', () => {
      const { el } = setup(MAQUINAS);
      expect(el.querySelector('[data-testid="tiempo-resolucion"]')!.className).toContain('dark:');
    });

    it('con muchas máquinas sigue dibujando todas', () => {
      const muchas = Array.from({ length: 8 }, (_, i) => ({
        ...MAQUINAS[0],
        id: String(i + 10),
        name: `Equipo ${i + 1}`,
        mttr: 20 + i * 10,
      }));
      const { el } = setup(muchas);
      expect(el.querySelectorAll('[data-testid^="resolucion-barra-"]').length).toBe(8);
    });
  });
});
