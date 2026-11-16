import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MaquinaSelectorComponent } from './maquina-selector.component';

const PLANTAS = [
  { id: 1, name: 'Planta Central' },
  { id: 2, name: 'Planta Norte' },
];

const MAQUINAS = [
  { id: 5, name: 'Compressor A1', codigo: 'COMP-A1', discipline_id: 1, plant_id: 1 },
  { id: 6, name: 'Pump E4', codigo: 'PUMP-E4', discipline_id: 1, plant_id: 1 },
  { id: 9, name: 'Molino SAG', codigo: 'SAG-1', discipline_id: 1, plant_id: 2 },
];

describe('MaquinaSelectorComponent (HU-23)', () => {
  let fixture: ComponentFixture<MaquinaSelectorComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [MaquinaSelectorComponent] });
    fixture = TestBed.createComponent(MaquinaSelectorComponent);
    fixture.componentRef.setInput('maquinas', MAQUINAS);
    fixture.componentRef.setInput('plantas', PLANTAS);
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  const input = () => el.querySelector<HTMLInputElement>('[data-testid="maquina-input"]')!;
  const opciones = () => Array.from(el.querySelectorAll<HTMLElement>('[data-testid="maquina-opcion"]'));
  const lista = () => el.querySelector('[data-testid="maquina-lista"]');

  function escribir(texto: string) {
    input().value = texto;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  function tecla(key: string) {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  function abrir() {
    input().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
  }

  it('es un combobox con etiqueta asociada y la lista cerrada al inicio', () => {
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().labels?.[0]?.textContent).toContain('Equipo');
    expect(input().getAttribute('aria-controls')).toBeTruthy();
    expect(lista()).toBeNull();
  });

  it('al enfocar abre un listbox con «Sin máquina» y las máquinas agrupadas por planta', () => {
    abrir();

    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(lista()?.getAttribute('role')).toBe('listbox');
    const grupos = Array.from(el.querySelectorAll('[role="group"]')).map((g) => g.getAttribute('aria-label'));
    expect(grupos).toEqual(['Planta Central', 'Planta Norte']);
    expect(opciones().map((o) => o.textContent?.trim())).toEqual([
      'Sin máquina',
      'Compressor A1 (COMP-A1)',
      'Pump E4 (PUMP-E4)',
      'Molino SAG (SAG-1)',
    ]);
    expect(opciones().every((o) => o.getAttribute('role') === 'option')).toBe(true);
  });

  it('filtra por nombre o por código, sin distinguir tildes ni mayúsculas', () => {
    abrir();

    escribir('pump');
    expect(opciones().map((o) => o.textContent?.trim())).toEqual(['Pump E4 (PUMP-E4)']);

    escribir('SAG-1');
    expect(opciones().map((o) => o.textContent?.trim())).toEqual(['Molino SAG (SAG-1)']);

    escribir('MOLÍNO');
    expect(opciones()).toHaveLength(1);
  });

  it('sin coincidencias avisa y no ofrece «Sin máquina»', () => {
    abrir();
    escribir('zzz');

    expect(opciones()).toHaveLength(0);
    expect(el.querySelector('[data-testid="maquina-vacio"]')).not.toBeNull();
  });

  it('tolera la ortografía del inglés: «compresor» encuentra «Compressor A1»', () => {
    abrir();
    escribir('compresor');

    // El seed y el catálogo dicen «Compressor» (doble ese); quien escribe en español
    // teclea «compresor» y antes veía la lista vacía.
    expect(opciones().map((o) => o.textContent?.trim())).toEqual(['Compressor A1 (COMP-A1)']);
  });

  it('acepta prefijos y no arrastra equipos por una sola letra de diferencia en palabras cortas', () => {
    abrir();

    escribir('comp');
    expect(opciones()).toHaveLength(1);

    escribir('sag');
    expect(opciones().map((o) => o.textContent?.trim())).toEqual(['Molino SAG (SAG-1)']);

    // «pump» vs «pomp» difiere en una letra, pero con 4 letras la tolerancia aplica.
    escribir('pomp');
    expect(opciones()).toHaveLength(1);

    // «a1» no debe traer «b1»: por debajo de 3 letras no hay tolerancia.
    escribir('b1');
    expect(opciones()).toHaveLength(0);
  });

  it('elegir con el clic fija el valor, muestra su etiqueta y cierra la lista', () => {
    abrir();
    opciones()[2].click(); // Pump E4
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe(6);
    expect(input().value).toBe('Pump E4 (PUMP-E4)');
    expect(lista()).toBeNull();
  });

  it('teclado: ↓ mueve, Enter elige y aria-activedescendant sigue la opción activa', () => {
    abrir();
    expect(input().getAttribute('aria-activedescendant')).toBe(opciones()[0].id);

    tecla('ArrowDown');
    tecla('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(opciones()[2].id);

    tecla('Enter');
    expect(fixture.componentInstance.value()).toBe(6);
    expect(lista()).toBeNull();
  });

  it('teclado: ↑ desde la primera opción da la vuelta a la última', () => {
    abrir();
    tecla('ArrowUp');
    tecla('Enter');

    expect(fixture.componentInstance.value()).toBe(9);
  });

  it('Escape cierra y descarta lo escrito, conservando la selección previa', () => {
    fixture.componentInstance.value.set(5);
    fixture.detectChanges();
    abrir();
    escribir('mol');

    tecla('Escape');

    expect(lista()).toBeNull();
    expect(fixture.componentInstance.value()).toBe(5);
    expect(input().value).toBe('Compressor A1 (COMP-A1)');
  });

  it('«Sin máquina» y el botón de quitar desvinculan', () => {
    fixture.componentInstance.value.set(5);
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('[data-testid="maquina-limpiar"]')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBeNull();
    expect(input().value).toBe('');

    fixture.componentInstance.value.set(6);
    abrir();
    opciones()[0].click();
    expect(fixture.componentInstance.value()).toBeNull();
  });

  it('un clic fuera del componente cierra la lista', () => {
    abrir();
    document.body.click();
    fixture.detectChanges();

    expect(lista()).toBeNull();
  });

  it('deshabilitado no se abre', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    abrir();
    expect(input().disabled).toBe(true);
    expect(lista()).toBeNull();
  });

  it('marca la opción elegida con aria-selected', () => {
    fixture.componentInstance.value.set(9);
    fixture.detectChanges();
    abrir();

    expect(opciones().filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent?.trim())).toEqual([
      'Molino SAG (SAG-1)',
    ]);
  });
});
