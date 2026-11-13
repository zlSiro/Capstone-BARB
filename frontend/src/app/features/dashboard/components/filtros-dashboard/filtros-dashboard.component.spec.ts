import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FiltrosDashboardComponent } from './filtros-dashboard.component';
import { CatalogService } from '../../../../core/services/catalog.service';
import { Discipline, FiltrosDashboard, Machine, Plant, SIN_FILTROS } from '../../../../core/models';

const PLANTAS: Plant[] = [
  { id: 1, name: 'Planta Central', ubicacion: 'San Bernardo' },
  { id: 2, name: 'Planta Norte', ubicacion: 'Antofagasta' },
];

const DISCIPLINAS: Discipline[] = [
  { id: 10, name: 'Mecánica' },
  { id: 11, name: 'Eléctrica' },
  { id: 12, name: 'Instrumentación' },
];

const MAQUINAS: Machine[] = [
  // Planta 1: mecánica y eléctrica.
  { id: 100, name: 'Compressor A1', discipline_id: 10, plant_id: 1 },
  { id: 101, name: 'Pump E4', discipline_id: 10, plant_id: 1 },
  { id: 102, name: 'Motor D1', discipline_id: 11, plant_id: 1 },
  // Planta 2: solo mecánica. La 12 no la usa ninguna planta.
  { id: 103, name: 'Molino SAG', discipline_id: 10, plant_id: 2 },
];

function setup() {
  const catalogo = {
    getPlants: vi.fn(() => of(PLANTAS)),
    getDisciplines: vi.fn(() => of(DISCIPLINAS)),
    getMachines: vi.fn(() => of(MAQUINAS)),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FiltrosDashboardComponent],
    providers: [{ provide: CatalogService, useValue: catalogo }],
  });
  const fixture = TestBed.createComponent(FiltrosDashboardComponent);
  fixture.detectChanges();

  const emitidos: FiltrosDashboard[] = [];
  fixture.componentInstance.cambio.subscribe((f) => emitidos.push(f));

  return { fixture, el: fixture.nativeElement as HTMLElement, emitidos };
}

function select(el: HTMLElement, testid: string): HTMLSelectElement {
  return el.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`)!;
}

function elegir(el: HTMLElement, testid: string, valor: string): void {
  const s = select(el, testid);
  s.value = valor;
  s.dispatchEvent(new Event('change', { bubbles: true }));
}

function opciones(el: HTMLElement, testid: string): string[] {
  return [...select(el, testid).options].map((o) => o.textContent?.trim() ?? '');
}

/** Lo que se espera que emita el panel: los defaults mas lo que cambie cada test. */
function esperado(cambios: Partial<FiltrosDashboard> = {}): FiltrosDashboard {
  return { ...SIN_FILTROS, ...cambios };
}

describe('FiltrosDashboardComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // El servicio de moneda persiste en localStorage: sin esto un test arrastra
    // la eleccion del anterior.
    window.localStorage.setItem('barb.currency', 'CLP');
  });

  it('renderiza los tres selectores y arranca sin filtros', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="filtros-dashboard"]')).toBeTruthy();
    expect(select(el, 'filtro-planta')).toBeTruthy();
    expect(select(el, 'filtro-disciplina')).toBeTruthy();
    expect(select(el, 'filtro-maquina')).toBeTruthy();
    // Con "todas" + las dos plantas del catálogo.
    expect(opciones(el, 'filtro-planta')).toHaveLength(PLANTAS.length + 1);
  });

  it('disciplina y máquina arrancan deshabilitadas hasta elegir planta', () => {
    const { el } = setup();

    expect(select(el, 'filtro-disciplina').disabled).toBe(true);
    expect(select(el, 'filtro-maquina').disabled).toBe(true);
    expect(select(el, 'filtro-planta').disabled).toBe(false);
  });

  it('al elegir planta emite el filtro y habilita los otros dos', () => {
    const { fixture, el, emitidos } = setup();

    elegir(el, 'filtro-planta', '1');
    fixture.detectChanges();

    expect(emitidos).toEqual([esperado({ planta_id: 1 })]);
    expect(select(el, 'filtro-disciplina').disabled).toBe(false);
    expect(select(el, 'filtro-maquina').disabled).toBe(false);
    // Solo las disciplinas que esa planta usa: mecánica y eléctrica, no instrumentación.
    expect(opciones(el, 'filtro-disciplina')).toEqual(['Todas', 'Mecánica', 'Eléctrica']);
  });

  it('las máquinas se acotan a la planta elegida', () => {
    const { fixture, el } = setup();

    elegir(el, 'filtro-planta', '1');
    fixture.detectChanges();

    expect(opciones(el, 'filtro-maquina')).toEqual([
      'Todas',
      'Compressor A1',
      'Motor D1',
      'Pump E4',
    ]);
  });

  it('elegir disciplina acota las máquinas y emite el filtro completo', () => {
    const { fixture, el, emitidos } = setup();

    elegir(el, 'filtro-planta', '1');
    fixture.detectChanges();
    elegir(el, 'filtro-disciplina', '11');
    fixture.detectChanges();

    expect(opciones(el, 'filtro-maquina')).toEqual(['Todas', 'Motor D1']);
    expect(emitidos.at(-1)).toEqual(esperado({ planta_id: 1, disciplina_id: 11 }));
  });

  it('cambiar de planta limpia la disciplina y la máquina (eran de la anterior)', () => {
    const { fixture, el, emitidos } = setup();

    elegir(el, 'filtro-planta', '1');
    fixture.detectChanges();
    elegir(el, 'filtro-disciplina', '11');
    fixture.detectChanges();
    elegir(el, 'filtro-maquina', '102');
    fixture.detectChanges();

    elegir(el, 'filtro-planta', '2');
    fixture.detectChanges();

    expect(emitidos.at(-1)).toEqual(esperado({ planta_id: 2 }));
    // La planta 2 solo usa mecánica.
    expect(opciones(el, 'filtro-disciplina')).toEqual(['Todas', 'Mecánica']);
  });

  it('limpiar vuelve a "toda la empresa" y deshabilita los hijos', () => {
    const { fixture, el, emitidos } = setup();

    elegir(el, 'filtro-planta', '1');
    fixture.detectChanges();

    const boton = el.querySelector<HTMLButtonElement>('[data-testid="limpiar-filtros"]')!;
    expect(boton.disabled).toBe(false);
    boton.click();
    fixture.detectChanges();

    expect(emitidos.at(-1)).toEqual(SIN_FILTROS);
    expect(select(el, 'filtro-disciplina').disabled).toBe(true);
    expect(select(el, 'filtro-maquina').disabled).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Rango temporal y moneda: los otros dos controles globales (CGBIDA-550)
  // ---------------------------------------------------------------------------

  it('ofrece las cuatro ventanas de tiempo', () => {
    const { el } = setup();
    expect(opciones(el, 'filtro-rango')).toEqual([
      'Últimos 7 días',
      'Últimos 30 días',
      'Últimos 90 días',
      'Histórico',
    ]);
  });

  it('emite el rango elegido junto con el resto de los filtros', () => {
    const { fixture, el, emitidos } = setup();

    elegir(el, 'filtro-rango', '30');
    fixture.detectChanges();

    expect(emitidos.at(-1)).toEqual(esperado({ rango: 30 }));
  });

  it('no vuelve a emitir si se elige el rango que ya está activo', () => {
    const { fixture, el, emitidos } = setup();

    elegir(el, 'filtro-rango', 'all');
    fixture.detectChanges();

    expect(emitidos).toHaveLength(0);
  });

  it('la moneda se elige desde el panel y viaja en la emisión', () => {
    const { fixture, el, emitidos } = setup();

    const usd = el.querySelector<HTMLButtonElement>('[data-testid="moneda-USD"]')!;
    usd.click();
    fixture.detectChanges();

    expect(emitidos.at(-1)).toEqual(esperado({ moneda: 'USD' }));
    expect(usd.getAttribute('aria-pressed')).toBe('true');
  });

  it('limpiar no toca el rango ni la moneda: son preferencia, no filtro', () => {
    const { fixture, el, emitidos } = setup();

    elegir(el, 'filtro-rango', '7');
    fixture.detectChanges();
    elegir(el, 'filtro-planta', '1');
    fixture.detectChanges();

    const boton = el.querySelector<HTMLButtonElement>('[data-testid="limpiar-filtros"]')!;
    boton.click();
    fixture.detectChanges();

    expect(emitidos.at(-1)).toEqual(esperado({ rango: 7 }));
  });

  it('el botón de limpiar arranca deshabilitado (no hay nada que limpiar)', () => {
    const { el } = setup();
    const boton = el.querySelector<HTMLButtonElement>('[data-testid="limpiar-filtros"]')!;
    expect(boton.disabled).toBe(true);
  });
});
