import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { HistoricoRespuesta, PeriodoHistorico } from '../../../../core/models';
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

function clic(el: HTMLElement, testid: string): void {
  (el.querySelector(`[data-testid="${testid}"]`) as HTMLElement).click();
}

describe('sla-historico: carga inicial', () => {
  it('pide el último semestre al arrancar', () => {
    const { getHistorical } = setup();
    expect(getHistorical).toHaveBeenCalledWith('month', 180);
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

describe('sla-historico: selector de ventana', () => {
  it('ofrece las cuatro opciones', () => {
    const { el } = setup();
    expect(el.querySelectorAll('[data-testid^="rango-hist-"]')).toHaveLength(4);
  });

  it('arranca con la opción del semestre activa', () => {
    const { el } = setup();
    const activo = el.querySelector('[data-testid="rango-hist-semestre"]') as HTMLElement;
    expect(activo.getAttribute('aria-pressed')).toBe('true');
  });

  it('un año pide semestres de 365 días', () => {
    const { fixture, el, getHistorical } = setup();
    clic(el, 'rango-hist-anio');
    fixture.detectChanges();
    expect(getHistorical).toHaveBeenCalledWith('semester', 365);
  });

  it('3 años pide años de 1095 días', () => {
    const { fixture, el, getHistorical } = setup();
    clic(el, 'rango-hist-tres');
    fixture.detectChanges();
    expect(getHistorical).toHaveBeenCalledWith('year', 1095);
  });

  it('5 años pide años de 1825 días', () => {
    const { fixture, el, getHistorical } = setup();
    clic(el, 'rango-hist-cinco');
    fixture.detectChanges();
    expect(getHistorical).toHaveBeenCalledWith('year', 1825);
  });

  it('no vuelve a pedir si se elige la ventana activa', () => {
    const { fixture, el, getHistorical } = setup();
    clic(el, 'rango-hist-semestre');
    fixture.detectChanges();
    expect(getHistorical).toHaveBeenCalledTimes(1);
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
