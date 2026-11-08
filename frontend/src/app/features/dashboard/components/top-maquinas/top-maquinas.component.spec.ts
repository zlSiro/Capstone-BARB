import { TestBed } from '@angular/core/testing';

import { TopMtbfData, TopMttrData } from '../../../../core/models';
import { MtbfUnitService } from '../../../../core/services/mtbf-unit.service';
import { TopMaquinasComponent } from './top-maquinas.component';

/**
 * Tests del Top 5 por máquina (CGBIDA-516 y 517).
 *
 * Lo que se protege:
 *  - Las dos listas se renderizan con el orden que manda el backend (peor primero).
 *  - Los estados vacíos de cada lista.
 *  - El MTBF respeta la unidad elegida por el usuario (horas/días/meses).
 */

function mttr(): TopMttrData[] {
  return [
    { id: 'm1', name: 'Pump E4', mttr: 289.8, completadas: 5 },
    { id: 'm2', name: 'Chiller', mttr: 247.7, completadas: 3 },
  ];
}

function mtbf(): TopMtbfData[] {
  return [
    { id: 'm1', name: 'Press B3', mtbf_hours: 2920, fallas: 3 },
    { id: 'm2', name: 'Cinta C1', mtbf_hours: 4380, fallas: 2 },
  ];
}

function setup(m: TopMttrData[] = mttr(), b: TopMtbfData[] = mtbf(), unidad?: 'horas' | 'dias') {
  window.localStorage.setItem('barb.lang', 'es');
  // El servicio persiste la unidad: se limpia para que cada test parta del default.
  window.localStorage.removeItem('barb.mtbfUnit');
  TestBed.configureTestingModule({ imports: [TopMaquinasComponent] });
  if (unidad) TestBed.inject(MtbfUnitService).setUnidad(unidad);
  const fixture = TestBed.createComponent(TopMaquinasComponent);
  fixture.componentRef.setInput('mttr', m);
  fixture.componentRef.setInput('mtbf', b);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('top-maquinas: render', () => {
  it('renderiza las dos listas', () => {
    const { el } = setup();
    expect(el.querySelectorAll('[data-testid="top-mttr-fila"]')).toHaveLength(2);
    expect(el.querySelectorAll('[data-testid="top-mtbf-fila"]')).toHaveLength(2);
  });

  it('respeta el orden del backend', () => {
    const { el } = setup();
    const filas = [...el.querySelectorAll('[data-testid="top-mttr-fila"]')].map(
      (n) => n.textContent ?? ''
    );
    expect(filas[0]).toContain('Pump E4');
    expect(filas[1]).toContain('Chiller');
  });

  it('muestra el MTTR en minutos', () => {
    const { el } = setup();
    expect(el.textContent).toContain('290 min');
  });

  it('muestra las fallas de cada máquina del MTBF', () => {
    const { el } = setup();
    expect(el.textContent).toContain('3 fallas');
  });
});

describe('top-maquinas: unidad del MTBF', () => {
  it('en horas muestra el valor tal cual', () => {
    const { el } = setup(mttr(), mtbf(), 'horas');
    // El servicio formatea con un decimal: 2920 h -> "2920.0 h".
    expect(el.textContent).toContain('2920.0 h');
  });

  it('en dias convierte las horas', () => {
    const { el } = setup(mttr(), mtbf(), 'dias');
    // 2920 h / 24 = 121.7 d
    expect(el.textContent).toContain('121.7 d');
  });
});

describe('top-maquinas: sin datos', () => {
  it('sin MTTR muestra el aviso de la lista', () => {
    const { el } = setup([], mtbf());
    expect(el.querySelector('[data-testid="top-mttr-vacio"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="top-mttr-fila"]')).toHaveLength(0);
  });

  it('sin MTBF muestra el aviso de la lista', () => {
    const { el } = setup(mttr(), []);
    expect(el.querySelector('[data-testid="top-mtbf-vacio"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="top-mtbf-fila"]')).toHaveLength(0);
  });
});
