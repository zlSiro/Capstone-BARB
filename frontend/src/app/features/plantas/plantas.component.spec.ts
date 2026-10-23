import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { Discipline, Machine, Plant } from '../../core/models';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { PlantasComponent } from './plantas.component';

/**
 * Tests del listado de plantas (HU-25 / CGBIDA-461, subtarea CGBIDA-466).
 *
 * Se verifica lo que el usuario ve y lo que dispara:
 *  - Las plantas de `/api/plants` con su ubicación.
 *  - El conteo de máquinas por planta, cruzando `/api/machines` por `plant_id`.
 *  - Las disciplinas de esas máquinas, resueltas por id contra `/api/disciplines`.
 *  - Estados de carga, error, vacío y el filtro de búsqueda.
 *  - Que «Nueva planta» abra el modal y que `(saved)` recargue la lista.
 */

const PLANTAS: Plant[] = [
  { id: 1, name: 'Planta Central San Bernardo', ubicacion: 'San Bernardo' },
  { id: 2, name: 'Planta Norte Antofagasta', ubicacion: 'Antofagasta' },
  { id: 3, name: 'Planta Vacía', ubicacion: null },
];

const MAQUINAS: Machine[] = [
  { id: 10, name: 'Compressor A1', discipline_id: 1, plant_id: 1 },
  { id: 11, name: 'Motor Drive D1', discipline_id: 2, plant_id: 1 },
  { id: 12, name: 'Pump E4', discipline_id: 1, plant_id: 2 },
];

const DISCIPLINAS: Discipline[] = [
  { id: 1, name: 'Mecánica' },
  { id: 2, name: 'Eléctrica' },
];

function crearServicio(over: Partial<Record<'getPlants' | 'getMachines' | 'getDisciplines', unknown>> = {}) {
  return {
    getPlants: vi.fn(() => over.getPlants ?? of(PLANTAS)),
    getMachines: vi.fn(() => over.getMachines ?? of(MAQUINAS)),
    getDisciplines: vi.fn(() => over.getDisciplines ?? of(DISCIPLINAS)),
    crearPlantaCompleta: vi.fn(),
  };
}

function setup(servicio = crearServicio()) {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PlantasComponent],
    providers: [
      { provide: CatalogService, useValue: servicio },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fixture = TestBed.createComponent(PlantasComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, servicio, toast };
}

function filas(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('[data-testid="fila-planta"]')];
}

function texto(el: HTMLElement, testid: string, indice = 0): string {
  const nodos = el.querySelectorAll(`[data-testid="${testid}"]`);
  return nodos[indice]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('PlantasComponent', () => {
  describe('carga y listado', () => {
    it('muestra las plantas con su ubicación y el total en el título', () => {
      const { el } = setup();
      expect(el.querySelector('h1')?.textContent).toContain('Plantas (3)');
      expect(filas(el)).toHaveLength(3);
      expect(texto(el, 'planta-nombre', 0)).toContain('Planta Central San Bernardo');
      expect(texto(el, 'planta-ubicacion', 0)).toBe('San Bernardo');
    });

    it('cuenta las máquinas de cada planta cruzando por plant_id', () => {
      const { el } = setup();
      // Planta 1 tiene 2 máquinas; planta 2 tiene 1; planta 3 no tiene.
      expect(texto(el, 'planta-maquinas', 0)).toBe('2');
      expect(texto(el, 'planta-maquinas', 1)).toBe('1');
      expect(texto(el, 'planta-maquinas', 2)).toBe('0');
    });

    it('una planta sin ubicación se muestra con guion y avisa que no tiene máquinas', () => {
      const { el } = setup();
      expect(texto(el, 'planta-ubicacion', 2)).toBe('—');
      const tercera = filas(el)[2];
      expect(tercera.textContent).toContain('Sin máquinas');
    });

    it('muestra las disciplinas de las máquinas de cada planta, sin repetir', () => {
      const { el } = setup();
      const primera = filas(el)[0];
      // Mecánica (id 1) y Eléctrica (id 2): dos disciplinas distintas.
      expect(primera.textContent).toContain('Eléctrica');
      expect(primera.textContent).toContain('Mecánica');
      // La planta 2 sólo usa Mecánica.
      const segunda = filas(el)[1];
      expect(segunda.textContent).toContain('Mecánica');
      expect(segunda.textContent).not.toContain('Eléctrica');
    });

    it('sin plantas muestra el estado vacío', () => {
      const { el } = setup(crearServicio({ getPlants: of([]) }));
      expect(el.querySelector('[data-testid="vacio"]')).not.toBeNull();
      expect(filas(el)).toHaveLength(0);
    });

    it('si fallan las máquinas, el listado igual se muestra con cero', () => {
      // Las plantas son lo esencial; el contador es accesorio y no debe tumbar la pantalla.
      const servicio = crearServicio({ getMachines: throwError(() => new Error('boom')) });
      const { el } = setup(servicio);
      expect(filas(el)).toHaveLength(3);
      expect(texto(el, 'planta-maquinas', 0)).toBe('0');
    });

    it('si fallan las plantas, muestra el error con reintento', () => {
      const error = new HttpErrorResponse({ status: 500, error: { detail: 'Error interno' } });
      const servicio = crearServicio({ getPlants: throwError(() => error) });
      const { el } = setup(servicio);
      expect(el.querySelector('[data-testid="error"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="error"]')?.textContent).toContain('Error interno');
      expect(filas(el)).toHaveLength(0);
    });
  });

  describe('filtro', () => {
    it('filtra por nombre y por ubicación', () => {
      const { fixture, el } = setup();
      const input = el.querySelector<HTMLInputElement>('#planta-filtro')!;

      input.value = 'antofagasta';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      expect(filas(el)).toHaveLength(1);
      expect(texto(el, 'planta-nombre')).toContain('Norte');

      input.value = 'san bernardo';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      expect(filas(el)).toHaveLength(1);
      expect(texto(el, 'planta-nombre')).toContain('Central');
    });

    it('sin coincidencias muestra el vacío sin romper el título', () => {
      const { fixture, el } = setup();
      const input = el.querySelector<HTMLInputElement>('#planta-filtro')!;
      input.value = 'zzzz';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();

      expect(filas(el)).toHaveLength(0);
      expect(el.querySelector('[data-testid="vacio"]')).not.toBeNull();
      // El total del título sigue siendo el real, no el filtrado.
      expect(el.querySelector('h1')?.textContent).toContain('Plantas (3)');
    });
  });

  describe('alta con el modal', () => {
    it('el modal no aparece hasta pulsar «Nueva planta»', () => {
      const { fixture, el } = setup();
      expect(el.querySelector('app-planta-form-modal')).toBeNull();

      el.querySelector<HTMLElement>('[data-testid="nueva-planta"]')!.click();
      fixture.detectChanges();
      expect(el.querySelector('app-planta-form-modal')).not.toBeNull();
    });

    it('al guardar se recarga la lista con la planta nueva', () => {
      // Primera carga sin la planta nueva; tras el alta, aparece.
      let plantas: Plant[] = [...PLANTAS];
      const servicio = crearServicio();
      servicio.getPlants = vi.fn(() => of(plantas));
      const { fixture, el, toast } = setup(servicio);

      expect(filas(el)).toHaveLength(3);

      plantas = [...PLANTAS, { id: 9, name: 'Planta Recién Creada', ubicacion: 'Quilicura' }];

      el.querySelector<HTMLElement>('[data-testid="nueva-planta"]')!.click();
      fixture.detectChanges();
      // El modal emite (saved) al terminar el POST.
      fixture.componentInstance['onSaved']();
      fixture.detectChanges();

      expect(el.querySelector('app-planta-form-modal')).toBeNull();
      expect(filas(el)).toHaveLength(4);
      expect(el.textContent).toContain('Planta Recién Creada');
      expect(toast.info).toHaveBeenCalled();
    });

    it('cerrar el modal no recarga la lista', () => {
      const { fixture, el, servicio } = setup();
      el.querySelector<HTMLElement>('[data-testid="nueva-planta"]')!.click();
      fixture.detectChanges();

      const llamadas = servicio.getPlants.mock.calls.length;
      fixture.componentInstance['closeModal']();
      fixture.detectChanges();

      expect(servicio.getPlants.mock.calls.length).toBe(llamadas);
      expect(el.querySelector('app-planta-form-modal')).toBeNull();
    });
  });
});
