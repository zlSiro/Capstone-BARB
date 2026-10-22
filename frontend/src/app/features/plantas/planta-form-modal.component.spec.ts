import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { PlantaCompletaResponse } from '../../core/models';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { PlantaFormModalComponent } from './planta-form-modal.component';

/**
 * Tests del alta masiva de plantas (HU-25 / CGBIDA-461, subtarea CGBIDA-466).
 *
 * Se verifica lo que el usuario ve y lo que se manda al backend:
 *  - Las dos listas dinámicas (disciplinas y máquinas) se agregan y se quitan.
 *  - El selector de disciplina de cada máquina se alimenta de las disciplinas escritas.
 *  - La confirmación existe y resume cuántas máquinas y disciplinas se van a crear.
 *  - El payload va limpio: sin filas vacías, sin disciplinas repetidas, ubicación "" -> null.
 *  - Un 409 del backend se muestra y NO cierra el modal.
 */

const RESPUESTA: PlantaCompletaResponse = {
  planta_id: 9,
  nombre: 'Planta Norte',
  ubicacion: 'Quilicura',
  disciplinas: [
    { disciplina_id: 3, nombre: 'Mecánica', creada: true },
    { disciplina_id: 4, nombre: 'Eléctrica', creada: false },
  ],
  maquinas: [{ maquina_id: 41, nombre: 'Compressor T1', codigo: 'T1', disciplina_id: 3 }],
};

function crearServicio(respuesta: PlantaCompletaResponse = RESPUESTA) {
  return { crearPlantaCompleta: vi.fn(() => of(respuesta)) };
}

function setup(servicio = crearServicio()) {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PlantaFormModalComponent],
    providers: [
      { provide: CatalogService, useValue: servicio },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fixture = TestBed.createComponent(PlantaFormModalComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, servicio, toast };
}

function escribir(el: HTMLElement, testid: string, valor: string, indice = 0): void {
  const inputs = el.querySelectorAll<HTMLInputElement>(`[data-testid="${testid}"]`);
  const input = inputs[indice];
  input.value = valor;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function elegir(el: HTMLElement, testid: string, valor: string, indice = 0): void {
  const selects = el.querySelectorAll<HTMLSelectElement>(`[data-testid="${testid}"]`);
  selects[indice].value = valor;
  selects[indice].dispatchEvent(new Event('change', { bubbles: true }));
}

function pulsar(el: HTMLElement, testid: string, indice = 0): void {
  el.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)[indice].click();
}

function texto(el: HTMLElement, testid: string): string {
  return el.querySelector(`[data-testid="${testid}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Completa el mínimo para poder confirmar. */
function llenarPlanta(fixture: { detectChanges: () => void }, el: HTMLElement, nombre = 'Planta Norte') {
  escribir(el, 'planta-nombre', nombre);
  fixture.detectChanges();
}

describe('PlantaFormModalComponent', () => {
  it('abre en el paso de datos, con el nombre y la ubicación', () => {
    const { el } = setup();
    expect(el.querySelector('h2')?.textContent).toContain('Nueva planta');
    expect(el.querySelector('[data-testid="planta-nombre"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="planta-ubicacion"]')).not.toBeNull();
    // Todavía no se ve la confirmación.
    expect(el.querySelector('[data-testid="confirmacion"]')).toBeNull();
  });

  describe('disciplinas', () => {
    it('empieza sin disciplinas y se pueden agregar', () => {
      const { fixture, el } = setup();
      expect(el.querySelector('[data-testid="sin-disciplinas"]')).not.toBeNull();

      pulsar(el, 'agregar-disciplina');
      pulsar(el, 'agregar-disciplina');
      fixture.detectChanges();

      expect(el.querySelectorAll('[data-testid="disciplina-input"]')).toHaveLength(2);
      expect(el.querySelector('[data-testid="sin-disciplinas"]')).toBeNull();
    });

    it('se pueden quitar', () => {
      const { fixture, el } = setup();
      pulsar(el, 'agregar-disciplina');
      pulsar(el, 'agregar-disciplina');
      fixture.detectChanges();

      pulsar(el, 'quitar-disciplina', 0);
      fixture.detectChanges();
      expect(el.querySelectorAll('[data-testid="disciplina-input"]')).toHaveLength(1);

      pulsar(el, 'quitar-disciplina', 0);
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="sin-disciplinas"]')).not.toBeNull();
    });
  });

  describe('máquinas', () => {
    it('se agregan y se quitan, con sus tres campos', () => {
      const { fixture, el } = setup();
      expect(el.querySelector('[data-testid="sin-maquinas"]')).not.toBeNull();

      pulsar(el, 'agregar-maquina');
      fixture.detectChanges();

      expect(el.querySelectorAll('[data-testid="maquina-nombre"]')).toHaveLength(1);
      expect(el.querySelectorAll('[data-testid="maquina-codigo"]')).toHaveLength(1);
      expect(el.querySelectorAll('[data-testid="maquina-disciplina"]')).toHaveLength(1);

      pulsar(el, 'quitar-maquina', 0);
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="sin-maquinas"]')).not.toBeNull();
    });

    it('el selector ofrece las disciplinas escritas, sin repetir', () => {
      const { fixture, el } = setup();
      pulsar(el, 'agregar-disciplina');
      pulsar(el, 'agregar-disciplina');
      pulsar(el, 'agregar-maquina');
      fixture.detectChanges();

      escribir(el, 'disciplina-input', 'Mecánica', 0);
      escribir(el, 'disciplina-input', 'mecánica', 1);
      fixture.detectChanges();

      const opciones = [...el.querySelectorAll<HTMLSelectElement>('[data-testid="maquina-disciplina"] option')]
        .map((o) => o.textContent?.trim());
      // La primera opción es "sin disciplina"; la disciplina repetida aparece una sola vez.
      expect(opciones[0]).toBe('Sin disciplina');
      expect(opciones.filter((o) => (o ?? '').toLowerCase() === 'mecánica')).toHaveLength(1);
    });

    it('una máquina a medias bloquea el avance', () => {
      const { fixture, el } = setup();
      llenarPlanta(fixture, el);
      pulsar(el, 'agregar-maquina');
      fixture.detectChanges();

      // Con nombre pero sin código no se puede confirmar.
      escribir(el, 'maquina-nombre', 'Compressor T1');
      fixture.detectChanges();
      pulsar(el, 'continuar');
      fixture.detectChanges();

      expect(el.querySelector('[data-testid="confirmacion"]')).toBeNull();
      expect(texto(el, 'error-maquinas')).toContain('código');
    });

    it('dos máquinas con el mismo código bloquean el avance', () => {
      const { fixture, el } = setup();
      llenarPlanta(fixture, el);
      pulsar(el, 'agregar-maquina');
      pulsar(el, 'agregar-maquina');
      fixture.detectChanges();

      escribir(el, 'maquina-nombre', 'A', 0);
      escribir(el, 'maquina-codigo', 'T1', 0);
      escribir(el, 'maquina-nombre', 'B', 1);
      escribir(el, 'maquina-codigo', 't1', 1);
      fixture.detectChanges();

      pulsar(el, 'continuar');
      fixture.detectChanges();

      expect(el.querySelector('[data-testid="confirmacion"]')).toBeNull();
      expect(texto(el, 'error-maquinas')).toContain('mismo código');
    });
  });

  describe('validación del nombre', () => {
    it('sin nombre no se avanza y se muestra el error', () => {
      const { fixture, el } = setup();
      pulsar(el, 'continuar');
      fixture.detectChanges();

      expect(el.querySelector('[data-testid="confirmacion"]')).toBeNull();
      expect(texto(el, 'error-nombre')).toContain('nombre');
    });
  });

  describe('confirmación', () => {
    it('resume cuántas máquinas y disciplinas se van a crear', () => {
      const { fixture, el } = setup();
      llenarPlanta(fixture, el);
      pulsar(el, 'agregar-disciplina');
      pulsar(el, 'agregar-maquina');
      pulsar(el, 'agregar-maquina');
      fixture.detectChanges();

      escribir(el, 'disciplina-input', 'Mecánica');
      escribir(el, 'maquina-nombre', 'Compressor T1', 0);
      escribir(el, 'maquina-codigo', 'T1', 0);
      escribir(el, 'maquina-nombre', 'Pump T2', 1);
      escribir(el, 'maquina-codigo', 'T2', 1);
      fixture.detectChanges();

      pulsar(el, 'continuar');
      fixture.detectChanges();

      const resumen = texto(el, 'confirmacion');
      expect(resumen).toContain('Planta Norte');
      expect(resumen).toContain('2 máquinas');
      expect(resumen).toContain('1 disciplina');
      // El botón de guardar existe en este paso.
      expect(el.querySelector('[data-testid="guardar"]')).not.toBeNull();
    });

    it('se puede volver sin perder lo escrito', () => {
      const { fixture, el } = setup();
      llenarPlanta(fixture, el, 'Planta Sur');
      pulsar(el, 'continuar');
      fixture.detectChanges();

      pulsar(el, 'volver');
      fixture.detectChanges();

      expect(el.querySelector('[data-testid="planta-nombre"]')).not.toBeNull();
      expect((el.querySelector('[data-testid="planta-nombre"]') as HTMLInputElement).value).toBe('Planta Sur');
    });
  });

  describe('envío al backend', () => {
    it('manda el payload limpio: sin filas vacías, sin repetidos, ubicación null', () => {
      const { fixture, el, servicio } = setup();
      llenarPlanta(fixture, el);

      // Dos disciplinas, una repetida y una vacía.
      pulsar(el, 'agregar-disciplina');
      pulsar(el, 'agregar-disciplina');
      pulsar(el, 'agregar-disciplina');
      fixture.detectChanges();
      escribir(el, 'disciplina-input', 'Mecánica', 0);
      escribir(el, 'disciplina-input', 'mecánica', 1);
      escribir(el, 'disciplina-input', '   ', 2);

      // Tres máquinas: dos con datos y una totalmente vacía.
      pulsar(el, 'agregar-maquina');
      pulsar(el, 'agregar-maquina');
      pulsar(el, 'agregar-maquina');
      fixture.detectChanges();
      escribir(el, 'maquina-nombre', 'Compressor T1', 0);
      escribir(el, 'maquina-codigo', 'T1', 0);
      elegir(el, 'maquina-disciplina', 'Mecánica', 0);
      escribir(el, 'maquina-nombre', 'Pump T2', 1);
      escribir(el, 'maquina-codigo', 'T2', 1);
      fixture.detectChanges();

      pulsar(el, 'continuar');
      fixture.detectChanges();
      pulsar(el, 'guardar');
      fixture.detectChanges();

      expect(servicio.crearPlantaCompleta).toHaveBeenCalledTimes(1);
      expect(servicio.crearPlantaCompleta).toHaveBeenCalledWith({
        nombre: 'Planta Norte',
        ubicacion: null,
        disciplinas: ['Mecánica'],
        maquinas: [
          { nombre: 'Compressor T1', codigo: 'T1', disciplina: 'Mecánica' },
          { nombre: 'Pump T2', codigo: 'T2', disciplina: null },
        ],
      });
    });

    it('al crear avisa por toast y emite la respuesta', () => {
      const { fixture, el, toast } = setup();
      const emitidos: PlantaCompletaResponse[] = [];
      fixture.componentInstance.saved.subscribe((r) => emitidos.push(r));

      llenarPlanta(fixture, el);
      pulsar(el, 'continuar');
      fixture.detectChanges();
      pulsar(el, 'guardar');
      fixture.detectChanges();

      expect(toast.success).toHaveBeenCalled();
      expect(emitidos).toHaveLength(1);
      expect(emitidos[0].planta_id).toBe(9);
      // El mensaje distingue disciplinas nuevas de reutilizadas.
      expect(toast.success.mock.calls[0][0]).toContain('1 disciplina(s) nueva(s), 1 reutilizada(s)');
    });

    it('un 409 del backend se muestra y NO cierra el modal', () => {
      const error = new HttpErrorResponse({
        status: 409,
        error: { detail: 'Ya existe una planta llamada «Planta Norte» en tu empresa.' },
      });
      const servicio = { crearPlantaCompleta: vi.fn(() => throwError(() => error)) };
      const { fixture, el, toast } = setup(servicio);
      const emitidos: PlantaCompletaResponse[] = [];
      fixture.componentInstance.saved.subscribe((r) => emitidos.push(r));

      llenarPlanta(fixture, el);
      pulsar(el, 'continuar');
      fixture.detectChanges();
      pulsar(el, 'guardar');
      fixture.detectChanges();

      expect(texto(el, 'error-servidor')).toContain('Ya existe una planta');
      expect(toast.error).toHaveBeenCalled();
      expect(emitidos).toHaveLength(0);
      // Sigue en la confirmación: el usuario puede corregir y reintentar.
      expect(el.querySelector('[data-testid="guardar"]')).not.toBeNull();
    });
  });

  it('cancelar emite closed', () => {
    const { fixture, el } = setup();
    let cerrado = false;
    fixture.componentInstance.closed.subscribe(() => (cerrado = true));

    const boton = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancelar')!;
    boton.click();

    expect(cerrado).toBe(true);
  });
});
