import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { HistoricoRespuesta, PeriodoHistorico, SIN_FILTROS } from '../../../../core/models';
import { StatsService } from '../../../../core/services/stats.service';
import { SlaHistoricoComponent } from './sla-historico.component';

/**
 * Tests del gráfico histórico de SLA (CGBIDA-515).
 *
 * Lo que se protege:
 *  - La ventana por defecto (último semestre = mensual + 180 días).
 *  - Que las cuatro ventanas pidan la granularidad y los días correctos.
 *  - Que el SVG tenga un punto por período y una polilínea con las mismas coordenadas.
 *  - Los estados vacío y error: no se dibuja una línea plana cuando no hay datos.
 */

function periodo(etiqueta: string, sla: number): PeriodoHistorico {
  return {
    periodo: `${etiqueta}-01`,
    etiqueta,
    total_ots: 10,
    completadas: 8,
    sla,
    mttr: 100,
    mtbf_hours: null,
    fallas: 1,
    horas_periodo: 720,
    disponibilidad: 98,
  };
}

function respuesta(n = 6): HistoricoRespuesta {
  return {
    granularity: 'month',
    periods: Array.from({ length: n }, (_, i) => periodo(`2026-0${i + 1}`, 90 + i)),
  };
}

function setup(res: HistoricoRespuesta | Error = respuesta()) {
  window.localStorage.setItem('barb.lang', 'es');
  const getHistorical = vi.fn(() =>
    res instanceof Error ? throwError(() => res) : of(res)
  );

  TestBed.configureTestingModule({
    imports: [SlaHistoricoComponent],
    providers: [{ provide: StatsService, useValue: { getHistorical } }],
  });
  const fixture = TestBed.createComponent(SlaHistoricoComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, getHistorical };
}

describe('sla-historico: carga inicial', () => {
  it('pide la ventana del panel al arrancar (por defecto, histórico)', () => {
    const { getHistorical } = setup();
    expect(getHistorical).toHaveBeenCalledWith(SIN_FILTROS);
  });

  it('dibuja el SVG con un punto por período', () => {
    const { el } = setup(respuesta(6));
    expect(el.querySelector('[data-testid="hist-svg"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="hist-punto"]')).toHaveLength(6);
  });

  it('la polilínea tiene una coordenada por punto', () => {
    const { el } = setup(respuesta(4));
    const puntos = (el.querySelector('[data-testid="hist-linea"]') as SVGElement).getAttribute(
      'points'
    )!;
    expect(puntos.trim().split(/\s+/)).toHaveLength(4);
  });

  it('usa las etiquetas de período del backend en el eje X', () => {
    const { el } = setup(respuesta(3));
    expect(el.textContent).toContain('2026-01');
    expect(el.textContent).toContain('2026-03');
  });
});

describe('sla-historico: ventana global (CGBIDA-550)', () => {
  it('ya no tiene selector propio de ventana', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid="selector-historico"]')).toBeNull();
    expect(el.querySelectorAll('[data-testid^="rango-hist-"]')).toHaveLength(0);
  });

  it('vuelve a pedir cuando el panel cambia el rango', () => {
    const { fixture, getHistorical } = setup();

    fixture.componentRef.setInput('filtros', { ...SIN_FILTROS, rango: 30 });
    fixture.detectChanges();

    expect(getHistorical).toHaveBeenCalledTimes(2);
    expect(getHistorical).toHaveBeenLastCalledWith({ ...SIN_FILTROS, rango: 30 });
  });

  it('vuelve a pedir cuando cambia la planta', () => {
    const { fixture, getHistorical } = setup();

    fixture.componentRef.setInput('filtros', { ...SIN_FILTROS, planta_id: 4 });
    fixture.detectChanges();

    expect(getHistorical).toHaveBeenLastCalledWith({ ...SIN_FILTROS, planta_id: 4 });
  });

  it('no muestra el rótulo de la ventana: ya lo dice el filtro global', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid="hist-rango-activo"]')).toBeNull();
  });

  it('el SVG ocupa el ancho del contenedor y no lleva alto fijo', () => {
    const { el } = setup();
    const svg = el.querySelector('[data-testid="hist-svg"]') as SVGElement;

    // `w-full` + viewBox del ancho medido: sin esto el dibujo quedaba centrado con
    // cientos de px en blanco a los lados (CGBIDA-550).
    expect(svg.getAttribute("class")).toContain("w-full");
    expect(svg.getAttribute("class")).not.toContain("h-[240px]");
    expect(svg.getAttribute("height")).toBe("220");
    // En jsdom no hay ResizeObserver: el ancho por defecto es 720.
    expect(svg.getAttribute("viewBox")).toBe("0 0 720 220");
  });
});

describe('sla-historico: sin datos', () => {
  it('con menos de dos períodos muestra el aviso en vez de una linea', () => {
    const { el } = setup(respuesta(1));
    expect(el.querySelector('[data-testid="hist-svg"]')).toBeNull();
    expect(el.querySelector('[data-testid="hist-vacio"]')).not.toBeNull();
  });

  it('con cero períodos muestra el aviso', () => {
    const { el } = setup(respuesta(0));
    expect(el.querySelector('[data-testid="hist-vacio"]')).not.toBeNull();
  });

  it('con error muestra el mensaje y no dibuja la linea', () => {
    const { el } = setup(new Error('boom'));
    expect(el.querySelector('[data-testid="hist-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="hist-svg"]')).toBeNull();
  });
});

describe('sla-historico: escala dinamica del eje Y (UX)', () => {
  it('con datos altos el eje arranca cerca del minimo y no en cero', () => {
    const res: HistoricoRespuesta = {
      granularity: 'month',
      periods: [periodo('2026-01', 92), periodo('2026-02', 96)],
    };
    const { el } = setup(res);
    const eje = el.querySelector('[data-testid="hist-svg"]')!.textContent ?? '';
    // El minimo es 92 -> piso 85, asi la pendiente se nota.
    expect(eje).toContain('85');
    expect(eje).not.toContain('25');
  });

  it('el piso nunca sube de 90 aunque el SLA sea casi perfecto', () => {
    const res: HistoricoRespuesta = {
      granularity: 'month',
      periods: [periodo('2026-01', 99), periodo('2026-02', 100)],
    };
    const { el } = setup(res);
    const eje = el.querySelector('[data-testid="hist-svg"]')!.textContent ?? '';
    // El eje siempre abarca al menos 10 puntos: no se dibuja un 99-100 como catastrofe.
    expect(eje).toContain('90');
  });

  it('con datos bajos el piso baja para no exagerar la caida', () => {
    const res: HistoricoRespuesta = {
      granularity: 'month',
      periods: [periodo('2026-01', 20), periodo('2026-02', 40)],
    };
    const { el } = setup(res);
    const eje = el.querySelector('[data-testid="hist-svg"]')!.textContent ?? '';
    expect(eje).toContain('15');
  });
});

describe('sla-historico: tooltip del punto (CGBIDA-550)', () => {
  /** Dispara un evento de mouse sobre el i-esimo punto. */
  function sobrePunto(el: HTMLElement, indice: number, tipo: 'mouseenter' | 'mouseleave' = 'mouseenter'): void {
    const punto = el.querySelectorAll('[data-testid="hist-punto"]')[indice] as SVGElement;
    punto.dispatchEvent(new MouseEvent(tipo, { bubbles: true, clientX: 40, clientY: 40 }));
  }

  it('no usa el tooltip nativo del navegador', () => {
    // El elemento title del SVG es el que dibuja el cuadro blanco.
    const { el } = setup();
    expect(el.querySelector('title')).toBeNull();
  });

  it('al pasar el cursor muestra el tooltip con el periodo y el SLA', () => {
    const { fixture, el } = setup();

    sobrePunto(el, 0);
    fixture.detectChanges();

    const tip = el.querySelector('[data-testid="hist-tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain('2026-01');
    expect(tip!.textContent).toContain('SLA');
    expect(tip!.textContent).toContain('90%');
  });

  it('el tooltip usa los tokens del tema, no colores fijos', () => {
    const { fixture, el } = setup();

    sobrePunto(el, 0);
    fixture.detectChanges();

    const clases = el.querySelector('[data-testid="hist-tooltip"]')!.getAttribute('class') ?? '';
    expect(clases).toContain('bg-superficie');
    expect(clases).toContain('rounded-control');
    expect(clases).toContain('shadow-lg');
  });

  it('al salir del punto el tooltip se oculta', () => {
    const { fixture, el } = setup();

    sobrePunto(el, 0);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="hist-tooltip"]')).not.toBeNull();

    sobrePunto(el, 0, 'mouseleave');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="hist-tooltip"]')).toBeNull();
  });
});
