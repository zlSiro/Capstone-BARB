import { TestBed } from '@angular/core/testing';

import { PorTipoData } from '../../../../core/models';
import { TipoDonutComponent } from './tipo-donut.component';

/**
 * Tests de la dona por tipo de intervencion (HU-16 / CGBIDA-395).
 *
 * Se verifica la replica del `PieChart` del legacy (`Dashboard.tsx:328-344`):
 * radio interior 60, radio exterior 90, 4 grados de separacion, leyenda al pie y tooltip.
 *
 * Los casos borde que se fijan a proposito:
 *  - Un solo tipo: la dona debe ser un anillo completo, sin hueco de separacion.
 *  - Serie vacia o todo en cero: no dibuja dona y muestra el aviso.
 *  - Un segmento de mas de 180 grados: el arco debe partirse (largeArcFlag = 1).
 *  - Los porcentajes redondeados deben sumar 100.
 */

const REAL: PorTipoData[] = [
  { tipo: 'corrective', total: 70 },
  { tipo: 'preventive', total: 30 },
  { tipo: 'inspection', total: 25 },
  { tipo: 'predictive', total: 21 },
];

function setup(datos: PorTipoData[], lang: 'es' | 'en' = 'es') {
  TestBed.resetTestingModule();
  window.localStorage.setItem('barb.lang', lang);
  TestBed.configureTestingModule({ imports: [TipoDonutComponent] });
  const fixture = TestBed.createComponent(TipoDonutComponent);
  fixture.componentRef.setInput('datos', datos);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

function segmento(el: HTMLElement, tipo: string): SVGPathElement {
  const s = el.querySelector(`[data-testid="segmento-${tipo}"]`);
  if (!s) throw new Error(`no existe el segmento ${tipo}`);
  return s as SVGPathElement;
}

/** Extrae los dos radios del path de un segmento anular. */
function radios(d: string): { ext: number; int: number } {
  const m = [...d.matchAll(/A\s+([\d.]+),([\d.]+)/g)];
  return { ext: Number(m[0][1]), int: Number(m[1][1]) };
}

/**
 * Convierte un punto del path a su angulo en grados, medido desde las 12 en punto.
 *
 * El componente aplica `(angulo - 90)` a seno y coseno con centro en (100, 100). Esta
 * funcion hace el camino inverso, para medir la separacion real entre segmentos en lugar
 * de comparar coordenadas: dos puntos distintos pueden pertenecer a segmentos contiguos
 * sin separacion entre ellos.
 */
function anguloDe(x: number, y: number): number {
  const grados = (Math.atan2(y - 100, x - 100) * 180) / Math.PI;
  return (((grados + 90) % 360) + 360) % 360;
}

describe('TipoDonutComponent', () => {
  describe('estructura', () => {
    it('dibuja un segmento por cada tipo VISIBLE: predictivo se oculta', () => {
      const { el } = setup(REAL);
      // CGBIDA-435: «predictivo» se filtra, quedan 3.
      expect(el.querySelectorAll('[data-testid^="segmento-"]').length).toBe(3);
      expect(el.querySelector('[data-testid="segmento-predictive"]')).toBeNull();
    });

    it('muestra el total de los tipos visibles en el centro', () => {
      const { el } = setup(REAL);
      // 70 + 30 + 25 = 125 (ya sin los 21 predictivos).
      expect(el.querySelector('[data-testid="dona-total"]')!.textContent!.trim()).toBe('125');
    });

    it('la leyenda lista los tres tipos visibles con su valor y porcentaje', () => {
      const { el } = setup(REAL);
      expect(el.querySelectorAll('[data-testid^="leyenda-"]').length).toBe(3);
      expect(el.querySelector('[data-testid="leyenda-predictive"]')).toBeNull();

      const corr = el.querySelector('[data-testid="leyenda-corrective"]')!.textContent ?? '';
      expect(corr).toContain('Correctivo');
      expect(corr).toContain('70');
      expect(corr).toContain('56'); // 70/125 = 56 %
    });

    it('el tooltip aparece al pasar el cursor y desaparece al salir', () => {
      const { fixture, el } = setup(REAL);
      expect(el.querySelector('[data-testid="dona-tooltip"]')).toBeNull();

      segmento(el, 'preventive').dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      const tip = el.querySelector('[data-testid="dona-tooltip"]')!;
      expect(tip.textContent).toContain('Preventivo');
      expect(tip.textContent).toContain('30');

      el.querySelector('svg')!.dispatchEvent(new MouseEvent('mouseleave'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="dona-tooltip"]')).toBeNull();
    });
  });

  describe('replica del legacy', () => {
    it('usa radio exterior 90 y radio interior 60', () => {
      const { el } = setup(REAL);
      // CGBIDA-435: se miden los tres tipos visibles.
      for (const tipo of ['corrective', 'preventive', 'inspection']) {
        const { ext, int } = radios(segmento(el, tipo).getAttribute('d')!);
        expect(ext).toBe(90);
        expect(int).toBe(60);
      }
    });

    it('usa la paleta del legacy en orden, sin var(--*)', () => {
      const { el } = setup(REAL);
      // Con «predictivo» filtrado quedan los tres primeros colores de la paleta.
      const esperado = ['#2563eb', '#059669', '#d97706'];
      const tipos = ['corrective', 'preventive', 'inspection'];
      tipos.forEach((t, i) => {
        const fill = segmento(el, t).getAttribute('fill');
        expect(fill).toBe(esperado[i]);
        expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('respeta los 4 grados de separacion entre segmentos', () => {
      // Se miden los angulos reales de los arcos, no los puntos: dos puntos distintos
      // pueden pertenecer a segmentos contiguos SIN separacion (el path cambia de forma
      // aunque los angulos coincidan). Comparar coordenadas no verifica el paddingAngle.
      // Esta prueba nacio de una mutacion que sobrevivio: poner SEPARACION = 0 no rompia
      // nada, es decir, la separacion no estaba verificada.
      const { el } = setup(REAL);
      const angulos = [...el.querySelectorAll('[data-testid^="segmento-"]')].map((n) => {
        const d = (n as SVGPathElement).getAttribute('d')!;
        const inicio = d.match(/^M\s+([-\d.]+),([-\d.]+)/)!;
        const finArco = d.match(/A\s+90,90\s+0\s+[01]\s+1\s+([-\d.]+),([-\d.]+)/)!;
        return {
          inicio: anguloDe(Number(inicio[1]), Number(inicio[2])),
          fin: anguloDe(Number(finArco[1]), Number(finArco[2])),
        };
      });

      // Entre el fin de un segmento y el inicio del siguiente debe haber ~4 grados.
      for (let i = 0; i < angulos.length - 1; i++) {
        let hueco = angulos[i + 1].inicio - angulos[i].fin;
        if (hueco < 0) hueco += 360; // el ultimo puede cruzar el origen
        expect(hueco).toBeCloseTo(4, 1);
      }

      // Y el barrido total debe ser 360 - 4*n: queda un hueco por segmento DIBUJADO
      // (no por fila recibida: «predictivo» se filtra en CGBIDA-435).
      const barridos = angulos.map((a) => {
        let b = a.fin - a.inicio;
        if (b < 0) b += 360;
        return b;
      });
      expect(barridos.reduce((x, y) => x + y, 0)).toBeCloseTo(360 - 4 * angulos.length, 1);
    });
  });

  describe('CASO BORDE: un solo tipo', () => {
    it('dibuja un anillo completo sin hueco de separacion', () => {
      const { el } = setup([{ tipo: 'preventive', total: 12 }]);
      const d = segmento(el, 'preventive').getAttribute('d')!;
      // El anillo completo se dibuja con DOS arcos de 180 grados (bandera 1).
      const arcos = [...d.matchAll(/A\s+90,90/g)];
      expect(arcos.length).toBe(2);
      expect(d).toContain('A 90,90 0 1 1');
      expect(d).not.toMatch(/NaN|Infinity/);
    });

    it('el porcentaje es 100 y el total coincide', () => {
      const { el } = setup([{ tipo: 'preventive', total: 12 }]);
      expect(el.querySelector('[data-testid="dona-total"]')!.textContent!.trim()).toBe('12');
      expect(el.querySelector('[data-testid="leyenda-preventive"]')!.textContent).toContain('100');
    });
  });

  describe('CASO BORDE: un segmento mayor a 180 grados', () => {
    it('parte el arco con largeArcFlag', () => {
      const { el } = setup([
        { tipo: 'corrective', total: 90 },
        { tipo: 'preventive', total: 10 },
      ]);
      const d = segmento(el, 'corrective').getAttribute('d')!;
      // 90/100 = 90% de 352 grados disponibles = 316.8 grados -> necesita el flag grande.
      expect(d).toContain('A 90,90 0 1 1');
    });

    it('el segundo segmento es chico y usa el flag corto', () => {
      const { el } = setup([
        { tipo: 'corrective', total: 90 },
        { tipo: 'preventive', total: 10 },
      ]);
      const d = segmento(el, 'preventive').getAttribute('d')!;
      // 10/100 = 35.2 grados -> arco corto.
      expect(d).toContain('A 90,90 0 0 1');
    });
  });

  describe('CASO BORDE: sin datos', () => {
    it('con la lista vacia no dibuja la dona y muestra el aviso', () => {
      const { el } = setup([]);
      expect(el.querySelector('[data-testid="tipo-donut"]')).toBeNull();
      expect(el.querySelector('[data-testid="dona-vacia"]')).not.toBeNull();
      expect(el.textContent).toContain('Sin datos');
    });

    it('con todos los valores en cero tampoco dibuja la dona', () => {
      const { el } = setup([
        { tipo: 'corrective', total: 0 },
        { tipo: 'preventive', total: 0 },
      ]);
      expect(el.querySelector('[data-testid="tipo-donut"]')).toBeNull();
      expect(el.querySelector('[data-testid="dona-vacia"]')).not.toBeNull();
    });

    it('no hay NaN ni Infinity en ningun path con valores en cero', () => {
      const { el } = setup([
        { tipo: 'corrective', total: 0 },
        { tipo: 'preventive', total: 0 },
      ]);
      expect(el.innerHTML).not.toMatch(/NaN|Infinity/);
    });
  });

  describe('porcentajes', () => {
    /**
     * Lee el porcentaje del ultimo `<span>` de la fila de leyenda.
     *
     * NO se usa un regex sobre `textContent`: la fila concatena "Correctivo" + "70" + "48%",
     * y `/(\d+)%$/` captura "7048", porque `\d+` es codicioso y atraviesa el total.
     * Ese era el defecto del test, no del componente.
     */
    const porcentajes = (el: HTMLElement): number[] =>
      [...el.querySelectorAll('[data-testid^="leyenda-"]')].map((li) => {
        const spans = li.querySelectorAll('span');
        const texto = spans[spans.length - 1].textContent!.trim();
        return Number(texto.replace('%', ''));
      });

    it('los porcentajes suman exactamente 100', () => {
      const { el } = setup(REAL);
      expect(porcentajes(el).reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('los porcentajes de la serie real son 56, 24 y 20', () => {
      // 70/125, 30/125 y 25/125 sobre los tres tipos visibles (CGBIDA-435).
      const { el } = setup(REAL);
      expect(porcentajes(el)).toEqual([56, 24, 20]);
    });

    it('CASO BORDE: tres partes iguales suman 100, no 99', () => {
      // 1/3 = 33.33% cada una. Redondeando por separado da 33+33+33 = 99.
      // El reparto por mayor residuo fuerza 34+33+33 = 100.
      const { el } = setup([
        { tipo: 'corrective', total: 1 },
        { tipo: 'preventive', total: 1 },
        { tipo: 'inspection', total: 1 },
      ]);
      const pcts = porcentajes(el);
      expect(pcts.reduce((a, b) => a + b, 0)).toBe(100);
      expect(pcts.filter((p) => p === 34).length).toBe(1);
    });

    it('el porcentaje refleja la proporcion real', () => {
      const { el } = setup([
        { tipo: 'corrective', total: 75 },
        { tipo: 'preventive', total: 25 },
      ]);
      expect(porcentajes(el)).toEqual([75, 25]);
    });
  });

  describe('i18n y dark mode', () => {
    it('traduce el titulo y los nombres de los tipos', () => {
      const es = setup(REAL, 'es').el.textContent ?? '';
      expect(es).toContain('Distribución por Tipo de Mantenimiento');
      expect(es).toContain('Correctivo');
      expect(es).toContain('Inspección');

      const en = setup(REAL, 'en').el.textContent ?? '';
      expect(en).toContain('Distribution by Maintenance Type');
      expect(en).toContain('Corrective');
      expect(en).toContain('Inspection');
    });

    it('la tarjeta y la leyenda tienen variantes de modo oscuro', () => {
      const { el } = setup(REAL);
      expect(el.querySelector('[data-testid="tipo-donut"]')!.className).toContain('dark:');
      const conDark = [...el.querySelectorAll('*')].some((n) => {
        const c = n.className;
        const texto = typeof c === 'string' ? c : (c as SVGAnimatedString).baseVal;
        return typeof texto === 'string' && texto.includes('dark:');
      });
      expect(conDark).toBe(true);
    });

    it('el svg es accesible con role img y etiqueta', () => {
      const { el } = setup(REAL);
      const svg = el.querySelector('svg')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBe('Distribución por Tipo de Mantenimiento');
    });
  });

  describe('orden de los segmentos', () => {
    it('respeta el orden que manda el backend (volumen descendente)', () => {
      const { el } = setup(REAL);
      const orden = [...el.querySelectorAll('[data-testid^="segmento-"]')].map((n) =>
        (n as SVGPathElement).dataset['testid']!.replace('segmento-', '')
      );
      expect(orden).toEqual(['corrective', 'preventive', 'inspection']);
    });
  });

  // ===========================================================================
  // Tipos que el componente no conoce (CGBIDA-399)
  // ===========================================================================
  describe('tipos fuera del catalogo conocido', () => {
    it('un tipo sin traduccion usa el valor crudo del backend, no queda vacio', () => {
      // Si el enum crece (por ejemplo 'lubrication') el backend lo va a mandar y el
      // bloque i18n todavia no lo tendra. La dona debe seguir mostrando algo legible
      // en vez de un hueco.
      const { el } = setup([
        { tipo: 'corrective', total: 10 },
        { tipo: 'lubrication', total: 5 },
      ]);
      expect(el.querySelector('[data-testid="segmento-lubrication"]')).not.toBeNull();
      const leyenda = el.querySelector('[data-testid="leyenda-lubrication"]')!.textContent ?? '';
      expect(leyenda).toContain('lubrication');
      expect(leyenda).toContain('5');
    });

    it('un tipo desconocido igual participa del total y del porcentaje', () => {
      const { el } = setup([
        { tipo: 'corrective', total: 75 },
        { tipo: 'futuro', total: 25 },
      ]);
      expect(el.querySelector('[data-testid="dona-total"]')!.textContent!.trim()).toBe('100');
      expect(el.querySelector('[data-testid="leyenda-futuro"]')!.textContent).toContain('25');
    });
  });

  // ===========================================================================
  // Paleta extendida (CGBIDA-399)
  // ===========================================================================
  describe('paleta extendida', () => {
    it('el sexto tipo usa un hex explicito, no un var() sin definir', () => {
      // El legacy tenia este defecto: su paleta referenciaba `var(--cyan)` para el sexto
      // color, y esa variable no estaba definida en el tema claro, asi que la sexta barra
      // salia sin color. Aca la paleta es hex, y el sexto tipo debe tener color propio y
      // distinto de los cinco anteriores.
      // CGBIDA-435 filtra «predictivo», así que con seis filas se dibujan cinco.
      const seis = [
        { tipo: 'corrective', total: 10 },
        { tipo: 'preventive', total: 9 },
        { tipo: 'inspection', total: 8 },
        { tipo: 'predictive', total: 7 },
        { tipo: 'extra1', total: 6 },
        { tipo: 'extra2', total: 5 },
      ];
      const visibles = seis.filter((d) => d.tipo !== 'predictive');
      const { el } = setup(seis);
      const colores = visibles.map((d) => segmento(el, d.tipo).getAttribute('fill')!);

      // Todos son hex de 6 digitos y ninguno es un var().
      colores.forEach((c) => {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
        expect(c).not.toContain('var(');
      });
      // Y todos son distintos entre si.
      expect(new Set(colores).size).toBe(visibles.length);
    });
  });
});





