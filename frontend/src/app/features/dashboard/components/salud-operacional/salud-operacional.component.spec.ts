import { TestBed } from '@angular/core/testing';

import { SaludOperacionalData } from '../../../../core/models';
import { SaludOperacionalComponent } from './salud-operacional.component';

/**
 * CGBIDA-435: tarjeta de Salud Operacional.
 *
 * Lo que estos tests blindan:
 *  - Que el número grande sea el índice que calcula el backend, no un recálculo local.
 *  - Que el color siga al estado, con los cuatro casos.
 *  - Que el desglose explique POR QUÉ ese color (un semáforo sin causa es otra caja negra).
 *  - **Que `insuficiente` NUNCA se pinte como verde ni muestre 100%.**
 */

const VERDE: SaludOperacionalData = {
  indice: 96.5,
  estado: 'verde',
  componentes: {
    sla: { valor: 97.7, estado: 'verde', score: 97.7 },
    mtbf: { valor: 800, estado: 'verde', score: 100 },
    backlog: { valor: 2.1, estado: 'verde', score: 100 },
  },
};

const ROJO: SaludOperacionalData = {
  indice: 42.8,
  estado: 'rojo',
  componentes: {
    sla: { valor: 97.7, estado: 'verde', score: 97.7 },
    mtbf: { valor: 223.6, estado: 'rojo', score: 30.6 },
    backlog: { valor: 31.8, estado: 'rojo', score: 0 },
  },
};

const INSUFICIENTE: SaludOperacionalData = {
  indice: null,
  estado: 'insuficiente',
  componentes: {
    sla: { valor: 100, estado: 'verde', score: 100 },
    mtbf: { valor: null, estado: 'insuficiente', score: null },
    backlog: { valor: 2.1, estado: 'verde', score: 100 },
  },
};

function setup(salud: SaludOperacionalData | null = ROJO, lang: 'es' | 'en' = 'es') {
  TestBed.resetTestingModule();
  window.localStorage.clear();
  window.localStorage.setItem('barb.lang', lang);
  TestBed.configureTestingModule({ imports: [SaludOperacionalComponent] });
  const fixture = TestBed.createComponent(SaludOperacionalComponent);
  fixture.componentRef.setInput('salud', salud);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

function texto(el: HTMLElement, testid: string): string {
  return el.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim() ?? '';
}

describe('SaludOperacionalComponent', () => {
  describe('el índice', () => {
    it('muestra el índice del backend con un decimal', () => {
      const { el } = setup(ROJO);
      expect(texto(el, 'indice-salud')).toBe('42.8%');
    });

    it('no recalcula el índice por su cuenta', () => {
      // Si lo recalculara, 96.5 del backend no coincidiría con la media de los scores.
      const { el } = setup(VERDE);
      expect(texto(el, 'indice-salud')).toBe('96.5%');
    });

    it('el anillo refleja el porcentaje', () => {
      const { el } = setup(ROJO);
      const dash = el.querySelector('[data-testid="arco-salud"]')!.getAttribute('stroke-dasharray')!;
      const avance = Number(dash.split(' ')[0]);
      // Anillo de 180 px con trazo de 16: r=72.
      const circunferencia = 2 * Math.PI * 72;
      expect(avance / circunferencia).toBeCloseTo(0.428, 2);
    });

    it('el número del centro no se toca con el trazo', () => {
      // El anillo deja 64 px de radio libre (72 de radio menos 8 de medio trazo). El texto
      // más ancho posible es "100.0%" a 30 px: ~108 px de ancho, o sea 54 de semiancho.
      const { el } = setup(ROJO);
      const texto = el.querySelector('[data-testid="indice-salud"]')!;
      const fontSize = Number(texto.getAttribute('font-size'));
      const radioLibre = 72 - 16 / 2;
      const semianchoPeorCaso = (0.6 * fontSize * '100.0%'.length) / 2;
      expect(semianchoPeorCaso).toBeLessThan(radioLibre);
    });

    it('el porcentaje es más chico que antes (30 px, no 38)', () => {
      const { el } = setup(ROJO);
      const texto = el.querySelector('[data-testid="indice-salud"]')!;
      expect(Number(texto.getAttribute('font-size'))).toBeLessThanOrEqual(32);
    });

    it('ya no dibuja la tendencia de backlog', () => {
      // Se quitó por ruidosa: 14 puntos con valores de 1 a 4 se veían como un electro.
      const { el } = setup(ROJO);
      expect(el.querySelector('[data-testid="tendencia-salud"]')).toBeNull();
      expect(el.querySelector('[data-testid="tendencia-panel"]')).toBeNull();
    });
  });

  describe('los colores', () => {
    it('verde usa el verde de la paleta', () => {
      const { el } = setup(VERDE);
      expect(el.querySelector('[data-testid="arco-salud"]')!.getAttribute('stroke')).toBe('#059669');
      expect(texto(el, 'estado-salud')).toBe('Saludable');
    });

    it('rojo usa el rojo de la paleta', () => {
      const { el } = setup(ROJO);
      expect(el.querySelector('[data-testid="arco-salud"]')!.getAttribute('stroke')).toBe('#c0281e');
      expect(texto(el, 'estado-salud')).toBe('Crítico');
    });

    it('amarillo tiene su propio color y etiqueta', () => {
      const { el } = setup({ ...VERDE, estado: 'amarillo' });
      expect(el.querySelector('[data-testid="arco-salud"]')!.getAttribute('stroke')).toBe('#d97706');
      expect(texto(el, 'estado-salud')).toBe('Atención');
    });

    it('insuficiente se pinta en gris, nunca en verde', () => {
      const { el } = setup(INSUFICIENTE);
      expect(el.querySelector('[data-testid="arco-salud"]')!.getAttribute('stroke')).toBe('#9ca3af');
      expect(texto(el, 'estado-salud')).toBe('Sin datos');
    });
  });

  describe('estado insuficiente', () => {
    it('muestra un guion en vez de un número inventado', () => {
      const { el } = setup(INSUFICIENTE);
      expect(texto(el, 'indice-salud')).toBe('—');
    });

    it('el anillo queda vacío, no al 100%', () => {
      const { el } = setup(INSUFICIENTE);
      const dash = el.querySelector('[data-testid="arco-salud"]')!.getAttribute('stroke-dasharray')!;
      expect(Number(dash.split(' ')[0])).toBe(0);
    });

    it('explica qué falta', () => {
      const { el } = setup(INSUFICIENTE);
      const aviso = el.querySelector('[data-testid="salud-aviso"]');
      expect(aviso).not.toBeNull();
      expect(aviso!.textContent).toContain('Faltan datos históricos');
    });

    it('con datos completos no muestra el aviso', () => {
      const { el } = setup(VERDE);
      expect(el.querySelector('[data-testid="salud-aviso"]')).toBeNull();
    });

    it('sin salud (null) no rompe y no pinta verde', () => {
      const { el } = setup(null);
      expect(texto(el, 'indice-salud')).toBe('—');
      expect(el.querySelector('[data-testid="arco-salud"]')!.getAttribute('stroke')).toBe('#9ca3af');
    });
  });

  describe('el desglose', () => {
    it('muestra los tres componentes con su valor y su estado', () => {
      const { el } = setup(ROJO);
      const lista = el.querySelector('[data-testid="componentes-salud"]')!;
      expect(lista.querySelectorAll('li').length).toBe(3);
      const t = lista.textContent ?? '';
      expect(t).toContain('SLA');
      expect(t).toContain('97.7%');
      expect(t).toContain('MTBF');
      // El MTBF respeta la unidad compartida: por defecto, dias.
      expect(t).toContain('9.3 d');
      expect(t).toContain('Backlog');
      expect(t).toContain('31.8 sem');
      // Cada sub-tarjeta dice su estado en palabras, no solo con color.
      expect(t).toContain('Saludable');
      expect(t).toContain('Crítico');
    });

    it('un componente sin valor se muestra como guion', () => {
      const { el } = setup(INSUFICIENTE);
      const lista = el.querySelector('[data-testid="componentes-salud"]')!;
      expect(lista.textContent).toContain('—');
    });
  });


  describe('accesibilidad e i18n', () => {
    it('el anillo declara su estado en el aria-label', () => {
      const { el } = setup(ROJO);
      const svg = el.querySelector('[data-testid="anillo-salud"]')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toContain('Crítico');
    });

    it('traduce al inglés', () => {
      const { el } = setup(ROJO, 'en');
      expect(el.textContent).toContain('Operational Health');
      expect(texto(el, 'estado-salud')).toBe('Critical');
    });

    it('tiene variantes de modo oscuro', () => {
      const { el } = setup(ROJO);
      expect(el.querySelector('[data-testid="salud-operacional"]')!.className).toContain('dark:');
    });
  });
});



