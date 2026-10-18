import { TestBed } from '@angular/core/testing';

import { MachineData } from '../../../../core/models';
import { MachineRankingComponent } from './machine-ranking.component';

/**
 * Tests del ranking de equipos (HU-16 / CGBIDA-394).
 *
 * Se verifica la replica del `BarChart layout="vertical"` del legacy
 * (`FinancialDashboard.jsx:196-215`) y los 6 desvios deliberados: animacion, tooltip,
 * tres metricas sin fallthrough, colores en hex, truncado del nombre y 5 equipos.
 *
 * Los 3 casos borde que se fijan aqui a proposito:
 *  - Empates: el sort debe ser ESTABLE, no dejar el orden al azar.
 *  - Borde exacto del truncado: 16 caracteres no truncan, 17 si.
 *  - Todos los valores en cero: no debe romperse ni ocultar el grafico.
 */

function maquina(over: Partial<MachineData> & { id: string }): MachineData {
  return {
    name: 'Equipo',
    total: 0,
    ahorroGenerado: 0,
    mttr: 0,
    slaCompliance: 0,
    ...over,
  } as MachineData;
}

/** Equipos con valores DISTINTOS en cada metrica, para ver el reordenamiento. */
const CINCO: MachineData[] = [
  maquina({ id: '1', name: 'Compressor A1', total: 16, mttr: 52.7, ahorroGenerado: 638_000 }),
  maquina({ id: '2', name: 'Motor Drive D1', total: 15, mttr: 120, ahorroGenerado: 1_200_000 }),
  maquina({ id: '3', name: 'Chiller Central', total: 14, mttr: 30, ahorroGenerado: 250_000 }),
  maquina({ id: '4', name: 'Pump E4', total: 14, mttr: 200, ahorroGenerado: 90_000 }),
  maquina({ id: '5', name: 'PLC Siemens S7', total: 2, mttr: 15, ahorroGenerado: 10_000 }),
];

function setup(maquinas: MachineData[], lang: 'es' | 'en' = 'es') {
  TestBed.resetTestingModule();
  window.localStorage.setItem('barb.lang', lang);
  TestBed.configureTestingModule({ imports: [MachineRankingComponent] });
  const fixture = TestBed.createComponent(MachineRankingComponent);
  fixture.componentRef.setInput('maquinas', maquinas);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

/** Orden de los equipos en el grafico, de arriba a abajo. */
function ordenEnPantalla(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-testid^="zona-"]')].map((z) =>
    (z as HTMLElement).dataset['testid']!.replace('zona-', '')
  );
}

function colorDe(el: HTMLElement, id: string): string | null {
  return el.querySelector(`[data-testid="barra-${id}"]`)?.getAttribute('fill') ?? null;
}

function cambiarA(fixture: ReturnType<typeof setup>['fixture'], valor: string): void {
  const sel = fixture.nativeElement.querySelector('[data-testid="selector-metrica"]') as HTMLSelectElement;
  sel.value = valor;
  sel.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

describe('MachineRankingComponent', () => {
  describe('estructura', () => {
    it('renderiza el grafico con los equipos', () => {
      const { el } = setup(CINCO);
      expect(el.querySelector('[data-testid="machine-ranking"]')).not.toBeNull();
      expect(el.querySelectorAll('[data-testid^="barra-"]').length).toBe(5);
    });

    it('muestra un estado vacio propio cuando no hay equipos', () => {
      const { el } = setup([]);
      expect(el.querySelector('[data-testid="machine-ranking"]')).toBeNull();
      expect(el.querySelector('[data-testid="ranking-vacio"]')).not.toBeNull();
    });

    it('las barras son horizontales con radio solo a la derecha', () => {
      const { el } = setup(CINCO);
      const barra = el.querySelector('[data-testid="barra-1"]')!;
      const alto = Number(barra.getAttribute('height'));
      const ancho = Number(barra.getAttribute('width'));
      expect(alto).toBe(16);
      expect(ancho).toBeGreaterThan(alto);
      expect(barra.getAttribute('rx')).toBe('4');
      expect(barra.getAttribute('ry')).toBe('4');
    });

    it('la cuadricula es solo vertical, como el eje numerico oculto', () => {
      const { el } = setup(CINCO);
      const lineas = [...el.querySelectorAll('svg line')];
      for (const l of lineas) {
        expect(l.getAttribute('x1')).toBe(l.getAttribute('x2'));
      }
    });
  });

  describe('metrica por defecto y selector', () => {
    it('arranca en Volumen de OTs y ordena por total', () => {
      const { el } = setup(CINCO);
      expect(ordenEnPantalla(el)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('el selector tiene exactamente 3 opciones, no 4', () => {
      const { el } = setup(CINCO);
      const opciones = [...el.querySelectorAll('[data-testid="selector-metrica"] option')];
      expect(opciones.length).toBe(3);
      expect(opciones.map((o) => (o as HTMLOptionElement).value)).toEqual(['ots', 'mttr', 'ahorro']);
    });

    it('al cambiar a MTTR reordena de mayor a menor', () => {
      const { fixture, el } = setup(CINCO);
      cambiarA(fixture, 'mttr');
      // mttr: 200 (4), 120 (2), 52.7 (1), 30 (3), 15 (5)
      expect(ordenEnPantalla(el)).toEqual(['4', '2', '1', '3', '5']);
    });

    it('al cambiar a Ahorro reordena de mayor a menor', () => {
      const { fixture, el } = setup(CINCO);
      cambiarA(fixture, 'ahorro');
      // ahorro: 1.2M (2), 638k (1), 250k (3), 90k (4), 10k (5)
      expect(ordenEnPantalla(el)).toEqual(['2', '1', '3', '4', '5']);
    });

    it('el selector refleja la metrica activa', () => {
      const { fixture, el } = setup(CINCO);
      const sel = el.querySelector('[data-testid="selector-metrica"]') as HTMLSelectElement;
      expect(sel.value).toBe('ots');
      cambiarA(fixture, 'mttr');
      expect(sel.value).toBe('mttr');
    });
  });

  describe('CASO BORDE 1: empates y sort estable', () => {
    it('con valores empatados conserva el orden que mando el backend', () => {
      // COMPORTAMIENTO FIJADO A PROPOSITO: `Array.prototype.sort` es estable desde ES2019,
      // asi que dos equipos con el MISMO total mantienen su orden de entrada. No es azar:
      // si alguien cambia el sort por uno inestable, este test debe fallar.
      const empatados = [
        maquina({ id: 'a', name: 'AAA', total: 5 }),
        maquina({ id: 'b', name: 'BBB', total: 5 }),
        maquina({ id: 'c', name: 'CCC', total: 5 }),
        maquina({ id: 'd', name: 'DDD', total: 9 }),
      ];
      const { el } = setup(empatados);
      // DDD primero (9), y los tres empates en 5 conservan a, b, c.
      expect(ordenEnPantalla(el)).toEqual(['d', 'a', 'b', 'c']);
    });

    it('el empate se mantiene tambien al cambiar de metrica', () => {
      const empatados = [
        maquina({ id: 'a', name: 'AAA', total: 1, mttr: 7 }),
        maquina({ id: 'b', name: 'BBB', total: 2, mttr: 7 }),
        maquina({ id: 'c', name: 'CCC', total: 3, mttr: 7 }),
      ];
      const { fixture, el } = setup(empatados);
      cambiarA(fixture, 'mttr');
      // Los tres tienen el mismo mttr: conservan el orden original a, b, c.
      expect(ordenEnPantalla(el)).toEqual(['a', 'b', 'c']);
    });

    it('todos los valores en cero conserva el orden original', () => {
      const ceros = [
        maquina({ id: 'x', name: 'XXX' }),
        maquina({ id: 'y', name: 'YYY' }),
        maquina({ id: 'z', name: 'ZZZ' }),
      ];
      const { el } = setup(ceros);
      expect(ordenEnPantalla(el)).toEqual(['x', 'y', 'z']);
    });
  });

  describe('CASO BORDE 2: borde exacto del truncado', () => {
    it('15 caracteres NO trunca', () => {
      const { el } = setup([maquina({ id: '1', name: 'A'.repeat(15), total: 1 })]);
      const texto = el.querySelector('[data-testid="nombre-1"]')!.textContent!.trim();
      expect(texto).toBe('A'.repeat(15));
      expect(texto).not.toContain('…');
    });

    it('16 caracteres NO trunca: es el limite exacto', () => {
      const { el } = setup([maquina({ id: '1', name: 'B'.repeat(16), total: 1 })]);
      const texto = el.querySelector('[data-testid="nombre-1"]')!.textContent!.trim();
      expect(texto).toBe('B'.repeat(16));
      expect(texto).not.toContain('…');
    });

    it('17 caracteres SI trunca a 16 mas elipsis', () => {
      const { el } = setup([maquina({ id: '1', name: 'C'.repeat(17), total: 1 })]);
      const nodo = el.querySelector('[data-testid="nombre-1"]')!;
      // Se lee el PRIMER nodo de texto, no `textContent`: el elemento tambien contiene un
      // `<title>` con el nombre completo, y `textContent` lo concatenaria.
      const texto = nodo.firstChild?.textContent?.trim() ?? '';
      expect(texto).toBe('C'.repeat(16) + '…');
      expect([...texto].length).toBe(17); // 16 letras + 1 elipsis
    });

    it('un nombre real largo se trunca y conserva el completo en el title', () => {
      const { el } = setup([maquina({ id: '1', name: 'Válvula de Presión V8', total: 1 })]);
      const nodo = el.querySelector('[data-testid="nombre-1"]')!;
      expect(nodo.textContent!.trim()).toContain('…');
      expect(nodo.querySelector('title')?.textContent).toBe('Válvula de Presión V8');
    });

    it('un nombre corto no lleva title', () => {
      const { el } = setup([maquina({ id: '1', name: 'Pump E4', total: 1 })]);
      const nodo = el.querySelector('[data-testid="nombre-1"]')!;
      expect(nodo.textContent!.trim()).toBe('Pump E4');
      expect(nodo.querySelector('title')).toBeNull();
    });
  });

  describe('CASO BORDE 3: todos los valores en cero', () => {
    const CEROS = [
      maquina({ id: '1', name: 'A', total: 0, mttr: 0, ahorroGenerado: 0 }),
      maquina({ id: '2', name: 'B', total: 0, mttr: 0, ahorroGenerado: 0 }),
    ];

    it('no oculta el grafico: las barras se muestran', () => {
      const { el } = setup(CEROS);
      expect(el.querySelector('[data-testid="machine-ranking"]')).not.toBeNull();
      expect(el.querySelectorAll('[data-testid^="barra-"]').length).toBe(2);
    });

    it('las barras tienen ancho 0, sin NaN ni Infinity', () => {
      const { el } = setup(CEROS);
      for (const id of ['1', '2']) {
        const ancho = el.querySelector(`[data-testid="barra-${id}"]`)!.getAttribute('width');
        expect(ancho).toBe('0');
        expect(ancho).not.toMatch(/NaN|Infinity/);
      }
    });

    it('no rompe al cambiar de metrica con todo en cero', () => {
      const { fixture, el } = setup(CEROS);
      for (const m of ['mttr', 'ahorro', 'ots']) {
        cambiarA(fixture, m);
        expect(el.querySelectorAll('[data-testid^="barra-"]').length).toBe(2);
        expect(el.innerHTML).not.toMatch(/NaN|Infinity/);
      }
    });
  });

  describe('color por POSICION en el ranking', () => {
    it('la primera barra es azul y la segunda verde, como la paleta del legacy', () => {
      const { el } = setup(CINCO);
      expect(colorDe(el, '1')).toBe('#2563eb');
      expect(colorDe(el, '2')).toBe('#059669');
    });

    it('al cambiar de metrica el color sigue a la POSICION, no al equipo', () => {
      const { fixture, el } = setup(CINCO);
      // En `ots`, el equipo 1 va primero: azul.
      expect(colorDe(el, '1')).toBe('#2563eb');
      // En `mttr` el primero es el equipo 4, que pasa a azul.
      cambiarA(fixture, 'mttr');
      expect(colorDe(el, '4')).toBe('#2563eb');
      // Y el equipo 1, que ahora va tercero, pasa a ambar.
      expect(colorDe(el, '1')).toBe('#d97706');
    });

    it('usa hex explicitos, nunca var(--cyan)', () => {
      const { el } = setup(CINCO);
      const fills = [...el.querySelectorAll('[data-testid^="barra-"]')].map((b) => b.getAttribute('fill'));
      for (const f of fills) {
        expect(f).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });
  });

  describe('tooltip', () => {
    it('no hay tooltip al inicio', () => {
      const { el } = setup(CINCO);
      expect(el.querySelector('[data-testid="ranking-tooltip"]')).toBeNull();
    });

    it('muestra el nombre del equipo y el valor formateado', () => {
      const { fixture, el } = setup(CINCO);
      (el.querySelector('[data-testid="zona-1"]') as SVGRectElement)
        .dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();

      const texto = el.querySelector('[data-testid="ranking-tooltip"]')!.textContent ?? '';
      expect(texto).toContain('Compressor A1');
      expect(texto).toContain('Volumen de OTs');
      expect(texto).toContain('16');
    });

    it('el ahorro se formatea como moneda, igual que las tarjetas de KPI', () => {
      const { fixture, el } = setup(CINCO);
      cambiarA(fixture, 'ahorro');
      (el.querySelector('[data-testid="zona-2"]') as SVGRectElement)
        .dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      const texto = el.querySelector('[data-testid="ranking-tooltip"]')!.textContent ?? '';
      // Mismo formato que la 392: $1.200.000
      expect(texto).toMatch(/\$1\.200\.000/);
    });

    it('el MTTR se muestra en minutos', () => {
      const { fixture, el } = setup(CINCO);
      cambiarA(fixture, 'mttr');
      (el.querySelector('[data-testid="zona-4"]') as SVGRectElement)
        .dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      const texto = el.querySelector('[data-testid="ranking-tooltip"]')!.textContent ?? '';
      expect(texto).toContain('200 min');
    });

    it('al salir del svg el tooltip desaparece', () => {
      const { fixture, el } = setup(CINCO);
      (el.querySelector('[data-testid="zona-1"]') as SVGRectElement)
        .dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="ranking-tooltip"]')).not.toBeNull();

      el.querySelector('svg')!.dispatchEvent(new MouseEvent('mouseleave'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="ranking-tooltip"]')).toBeNull();
    });
  });

  describe('desvio 1: animacion CSS de 200 ms', () => {
    it('la barra declara la transicion de 200 ms y no la de Recharts', () => {
      const { el } = setup(CINCO);
      const barra = el.querySelector('[data-testid="barra-1"]') as SVGRectElement;
      const transicion = barra.style.transition;
      expect(transicion).toContain('200ms');
      // No debe quedar rastro de los ~1500 ms de Recharts.
      expect(transicion).not.toContain('1500');
    });
  });

  describe('i18n y dark mode', () => {
    it('traduce el titulo y las opciones del selector', () => {
      const es = setup(CINCO, 'es').el.textContent ?? '';
      expect(es).toContain('Top 5 Equipos');
      expect(es).toContain('Volumen OTs');
      expect(es).toContain('MTTR (Minutos)');

      const en = setup(CINCO, 'en').el.textContent ?? '';
      expect(en).toContain('Top 5 Machines');
      expect(en).toContain('WO Volume');
      expect(en).toContain('MTTR (Minutes)');
    });

    it('la tarjeta y el select tienen variantes de modo oscuro', () => {
      const { el } = setup(CINCO);
      expect(el.querySelector('[data-testid="machine-ranking"]')!.className).toContain('dark:');
      expect((el.querySelector('[data-testid="selector-metrica"]') as HTMLElement).className)
        .toContain('dark:');
    });

    it('el svg es accesible', () => {
      const { el } = setup(CINCO);
      const svg = el.querySelector('svg')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBeTruthy();
    });
  });
});


