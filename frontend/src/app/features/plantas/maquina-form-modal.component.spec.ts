import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { Discipline, Machine, MaquinaCreada, Plant } from '../../core/models';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { MaquinaFormModalComponent } from './maquina-form-modal.component';

/**
 * Tests del alta de una máquina suelta en una planta existente (HU-25, CGBIDA-466).
 *
 * Se verifica: los tres campos, las validaciones de nombre y código, el datalist de
 * disciplinas, el payload que se manda (disciplina vacía -> null), el 409 del backend y
 * que cancelar no guarde nada.
 */

const PLANTA: Plant = { id: 9, name: 'Planta Norte', ubicacion: 'Quilicura' };

const DISCIPLINAS: Discipline[] = [
  { id: 1, name: 'Mecánica' },
  { id: 2, name: 'Eléctrica' },
];

const CREADA: MaquinaCreada = {
  maquina_id: 55,
  nombre: 'Compressor N1',
  codigo: 'N1',
  disciplina_id: 1,
};

function crearServicio(respuesta: MaquinaCreada = CREADA) {
  return { agregarMaquina: vi.fn(() => of(respuesta)) };
}

function setup(servicio = crearServicio()) {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [MaquinaFormModalComponent],
    providers: [
      { provide: CatalogService, useValue: servicio },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fixture = TestBed.createComponent(MaquinaFormModalComponent);
  fixture.componentRef.setInput('planta', PLANTA);
  fixture.componentRef.setInput('disciplinas', DISCIPLINAS);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, servicio, toast };
}

function escribir(el: HTMLElement, testid: string, valor: string): void {
  const input = el.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
  input.value = valor;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pulsar(el: HTMLElement, testid: string): void {
  el.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.click();
}

function texto(el: HTMLElement, testid: string): string {
  return el.querySelector(`[data-testid="${testid}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('MaquinaFormModalComponent', () => {
  it('muestra el nombre de la planta destino y los tres campos', () => {
    const { el } = setup();
    expect(el.querySelector('h2')?.textContent).toContain('Agregar máquina');
    expect(el.querySelector('[role="dialog"]')?.textContent).toContain('Planta Norte');
    expect(el.querySelector('[data-testid="maquina-nombre"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="maquina-codigo"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="maquina-disciplina"]')).not.toBeNull();
  });

  it('sugiere las disciplinas existentes en el datalist', () => {
    const { el } = setup();
    const opciones = [...el.querySelectorAll<HTMLOptionElement>('#disciplinas-existentes option')]
      .map((o) => o.value);
    expect(opciones).toEqual(['Eléctrica', 'Mecánica']);
  });

  it('sin nombre no llama al backend y muestra el error', () => {
    const { fixture, el, servicio } = setup();
    pulsar(el, 'guardar-maquina');
    fixture.detectChanges();

    expect(servicio.agregarMaquina).not.toHaveBeenCalled();
    expect(texto(el, 'error-nombre')).toContain('nombre');
  });

  it('sin código no llama al backend y muestra el error', () => {
    const { fixture, el, servicio } = setup();
    escribir(el, 'maquina-nombre', 'Compressor N1');
    fixture.detectChanges();

    pulsar(el, 'guardar-maquina');
    fixture.detectChanges();

    expect(servicio.agregarMaquina).not.toHaveBeenCalled();
    expect(texto(el, 'error-codigo')).toContain('código');
  });

  it('manda nombre, código y disciplina a la planta correcta', () => {
    const { fixture, el, servicio } = setup();
    escribir(el, 'maquina-nombre', 'Compressor N1');
    escribir(el, 'maquina-codigo', 'N1');
    escribir(el, 'maquina-disciplina', 'Mecánica');
    fixture.detectChanges();

    pulsar(el, 'guardar-maquina');
    fixture.detectChanges();

    expect(servicio.agregarMaquina).toHaveBeenCalledWith(9, {
      nombre: 'Compressor N1',
      codigo: 'N1',
      disciplina: 'Mecánica',
      sla_horas: null,
      costo_inactividad_minuto: null,
    });
  });

  it('una disciplina vacía viaja como null', () => {
    const { fixture, el, servicio } = setup();
    escribir(el, 'maquina-nombre', 'Generador');
    escribir(el, 'maquina-codigo', 'GEN-1');
    fixture.detectChanges();

    pulsar(el, 'guardar-maquina');
    fixture.detectChanges();

    expect(servicio.agregarMaquina).toHaveBeenCalledWith(9, {
      nombre: 'Generador',
      codigo: 'GEN-1',
      disciplina: null,
      sla_horas: null,
      costo_inactividad_minuto: null,
    });
  });

  it('al guardar emite la máquina creada y avisa por toast', () => {
    const { fixture, el, toast } = setup();
    const emitidas: MaquinaCreada[] = [];
    fixture.componentInstance.saved.subscribe((m) => emitidas.push(m));

    escribir(el, 'maquina-nombre', 'Compressor N1');
    escribir(el, 'maquina-codigo', 'N1');
    fixture.detectChanges();
    pulsar(el, 'guardar-maquina');
    fixture.detectChanges();

    expect(emitidas).toHaveLength(1);
    expect(emitidas[0].maquina_id).toBe(55);
    expect(toast.success).toHaveBeenCalled();
  });

  it('un 409 de código repetido se muestra y no cierra el modal', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { detail: 'Ya existe una máquina con el código «N1» en esta planta.' },
    });
    const servicio = { agregarMaquina: vi.fn(() => throwError(() => error)) };
    const { fixture, el, toast } = setup(servicio);
    const emitidas: MaquinaCreada[] = [];
    fixture.componentInstance.saved.subscribe((m) => emitidas.push(m));

    escribir(el, 'maquina-nombre', 'Compressor N1');
    escribir(el, 'maquina-codigo', 'N1');
    fixture.detectChanges();
    pulsar(el, 'guardar-maquina');
    fixture.detectChanges();

    expect(texto(el, 'error-servidor')).toContain('Ya existe una máquina');
    expect(toast.error).toHaveBeenCalled();
    expect(emitidas).toHaveLength(0);
    // El formulario sigue visible para corregir el código.
    expect(el.querySelector('[data-testid="maquina-codigo"]')).not.toBeNull();
  });

  it('cancelar emite closed y no guarda', () => {
    const { fixture, el, servicio } = setup();
    let cerrado = false;
    fixture.componentInstance.closed.subscribe(() => (cerrado = true));

    const boton = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancelar')!;
    boton.click();

    expect(cerrado).toBe(true);
    expect(servicio.agregarMaquina).not.toHaveBeenCalled();
  });
  describe('modo edición', () => {
    const MAQUINA: Machine = {
      id: 55,
      name: 'Compressor N1',
      codigo: 'N1',
      discipline_id: 1,
      plant_id: 9,
      sla_horas: 8,
      costo_inactividad_minuto: 3500,
    };

    function setupEdicion() {
      const servicio = {
        agregarMaquina: vi.fn(),
        actualizarMaquina: vi.fn(() =>
          of({
            maquina_id: 55,
            planta_id: 9,
            nombre: 'Compressor N1',
            codigo: 'N1',
            disciplina_id: 1,
            sla_horas: 8,
            costo_inactividad_minuto: 3500,
          }),
        ),
      };
      const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [MaquinaFormModalComponent],
        providers: [
          { provide: CatalogService, useValue: servicio },
          { provide: ToastService, useValue: toast },
        ],
      });
      const fixture = TestBed.createComponent(MaquinaFormModalComponent);
      fixture.componentRef.setInput('planta', PLANTA);
      fixture.componentRef.setInput('disciplinas', DISCIPLINAS);
      fixture.componentRef.setInput('maquina', MAQUINA);
      fixture.detectChanges();
      return { fixture, el: fixture.nativeElement as HTMLElement, servicio, toast };
    }

    it('titula «Editar máquina» y precarga los datos', () => {
      const { el } = setupEdicion();

      expect(el.textContent).toContain('Editar máquina');
      expect(el.querySelector<HTMLInputElement>('[data-testid="maquina-nombre"]')!.value).toBe(
        'Compressor N1',
      );
      expect(el.querySelector<HTMLInputElement>('[data-testid="maquina-codigo"]')!.value).toBe('N1');
      expect(el.querySelector<HTMLSelectElement>('[data-testid="maquina-disciplina-select"]')!.value).toBe('1');
      expect(el.querySelector<HTMLInputElement>('[data-testid="maquina-sla-horas"]')!.value).toBe('8');
      expect(
        el.querySelector<HTMLInputElement>('[data-testid="maquina-costo-inactividad"]')!.value,
      ).toBe('3500');
    });

    it('guardar llama al PATCH con el id y no al POST de alta', () => {
      const { fixture, el, servicio } = setupEdicion();

      (el.querySelector('[data-testid="guardar-maquina"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(servicio.agregarMaquina).not.toHaveBeenCalled();
      expect(servicio.actualizarMaquina).toHaveBeenCalledWith(55, {
        nombre: 'Compressor N1',
        codigo: 'N1',
        disciplina_id: 1,
        sla_horas: 8,
        costo_inactividad_minuto: 3500,
      });
    });

    it('al guardar emite la máquina actualizada', () => {
      const { fixture, el } = setupEdicion();
      const emitidas: unknown[] = [];
      fixture.componentInstance.saved.subscribe((m) => emitidas.push(m));

      (el.querySelector('[data-testid="guardar-maquina"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(emitidas.length).toBe(1);
      expect((emitidas[0] as { nombre: string }).nombre).toBe('Compressor N1');
    });
  });
});