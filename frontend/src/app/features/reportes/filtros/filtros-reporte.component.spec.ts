import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { FiltrosReporte, ReporteId } from '../../../core/models';
import { columnasDisponibles, columnasElegidas } from '../columnas';
import { CAT } from '../fixtures';
import { FiltrosReporteComponent } from './filtros-reporte.component';
import { filtrosPorDefecto } from './filtros-url';

@Component({
  imports: [FiltrosReporteComponent],
  template: `<app-filtros-reporte
    [id]="id()"
    [filtros]="filtros()"
    [cat]="cat"
    [columnas]="columnas()"
    [columnasMostradas]="mostradas()"
    (cambio)="cambios.push($event)"
    (limpiar)="limpiados = limpiados + 1"
    (buscar)="busquedas.push($event)" />`,
})
class Anfitrion {
  readonly id = signal<ReporteId>('r3');
  readonly filtros = signal<FiltrosReporte>(filtrosPorDefecto('r3'));
  readonly puedeFinanzas = signal(false);
  readonly cat = CAT;
  readonly cambios: FiltrosReporte[] = [];
  limpiados = 0;
  readonly busquedas: string[] = [];
  readonly columnas = () => columnasDisponibles(this.id(), this.puedeFinanzas());
  readonly mostradas = () => columnasElegidas(this.id(), this.filtros().cols, this.puedeFinanzas());
}

function montar(id: ReporteId, f: Partial<FiltrosReporte> = {}, finanzas = false) {
  TestBed.configureTestingModule({});
  const fx = TestBed.createComponent(Anfitrion);
  fx.componentInstance.id.set(id);
  fx.componentInstance.puedeFinanzas.set(finanzas);
  fx.componentInstance.filtros.set({ ...filtrosPorDefecto(id), ...f });
  fx.detectChanges();
  return fx;
}

const sel = (fx: { nativeElement: unknown }, testid: string) => (fx.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`)!;
const cambiar = (el: HTMLSelectElement, valor: string) => {
  el.value = valor;
  el.dispatchEvent(new Event('change'));
};

describe('componente de filtros', () => {
  it('R3 no ofrece periodo (es una foto del momento) y sí estado, prioridad, técnico y tramo', () => {
    const fx = montar('r3');
    const el = fx.nativeElement as HTMLElement;
    expect(sel(fx, 'f-dias')).toBeNull();
    expect(el.querySelector('#f-prioridad')).not.toBeNull();
    expect(el.querySelector('#f-tecnico')).not.toBeNull();
    expect(el.querySelector('#f-tramo')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="f-estados"] input').length).toBe(5); // solo los estados abiertos
  });

  it('R1 ofrece periodo, topología en cascada y granularidad', () => {
    const fx = montar('r1');
    expect(sel(fx, 'f-dias')).not.toBeNull();
    expect(sel(fx, 'f-planta')).not.toBeNull();
    expect(sel(fx, 'f-gran')).not.toBeNull();
  });

  it('al elegir una planta, la máquina de otra planta se limpia (cascada)', () => {
    const fx = montar('r1', { planta: 1, maquina: 100 });
    cambiar(sel(fx, 'f-planta'), '2');
    const emitido = fx.componentInstance.cambios.at(-1)!;
    expect(emitido.planta).toBe(2);
    expect(emitido.maquina).toBeNull();
  });

  it('las máquinas ofrecidas son solo las de la planta elegida', () => {
    const fx = montar('r1', { planta: 2 });
    const opciones = [...sel(fx, 'f-maquina').options].map((o) => o.textContent?.trim());
    expect(opciones).toContain('Molino');
    expect(opciones).not.toContain('Bomba');
  });

  it('elegir «Histórico» emite dias = null', () => {
    const fx = montar('r1');
    cambiar(sel(fx, 'f-dias'), 'hist');
    expect(fx.componentInstance.cambios.at(-1)!.dias).toBeNull();
  });

  it('el selector de columnas no ofrece las de costo a quien no ve KPIs financieros', () => {
    const sin = montar('r6');
    expect((sin.nativeElement as HTMLElement).querySelector('[data-testid="col-costo_real"]')).toBeNull();
    TestBed.resetTestingModule();
    const con = montar('r6', {}, true);
    expect((con.nativeElement as HTMLElement).querySelector('[data-testid="col-costo_real"]')).not.toBeNull();
  });

  it('quitar una columna la saca de la elección; nunca se queda sin columnas', () => {
    const fx = montar('r3', { cols: ['numero_ot'] });
    const caja = (fx.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="col-numero_ot"]')!;
    caja.click();
    expect(fx.componentInstance.cambios.at(-1)!.cols).toEqual(['numero_ot']); // era la única: se mantiene
    const otra = (fx.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="col-estado"]')!;
    otra.click();
    expect(fx.componentInstance.cambios.at(-1)!.cols).toEqual(['numero_ot', 'estado']);
  });

  it('R9: buscar emite el número escrito y limpiar avisa a la página', () => {
    const fx = montar('r9');
    const el = fx.nativeElement as HTMLElement;
    const entrada = el.querySelector<HTMLInputElement>('[data-testid="f-numero-ot"]')!;
    entrada.value = 'OT-2026-0042';
    el.querySelector<HTMLButtonElement>('[data-testid="f-buscar"]')!.click();
    expect(fx.componentInstance.busquedas).toEqual(['OT-2026-0042']);
    el.querySelector<HTMLButtonElement>('[data-testid="filtros-limpiar"]')!.click();
    expect(fx.componentInstance.limpiados).toBe(1);
  });
});
