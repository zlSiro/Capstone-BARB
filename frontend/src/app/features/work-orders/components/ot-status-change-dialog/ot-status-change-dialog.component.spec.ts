import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { WorkOrder, WorkOrderStatus } from '../../../../core/models';
import { OtStatusChangeDialogComponent } from './ot-status-change-dialog.component';

const orden = (estado: WorkOrderStatus) => ({ numero_ot: 'OT-1', machine_name: 'Bomba', estado }) as WorkOrder;

function montar(estado: WorkOrderStatus, to: WorkOrderStatus) {
  const fixture = TestBed.createComponent(OtStatusChangeDialogComponent);
  fixture.componentRef.setInput('order', orden(estado));
  fixture.componentRef.setInput('to', to);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const confirmar = () => Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Confirmar')) as HTMLButtonElement;
  const escribir = (texto: string) => {
    const area = el.querySelector('textarea') as HTMLTextAreaElement;
    area.value = texto;
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  return { fixture, el, confirmar, escribir };
}

describe('OtStatusChangeDialogComponent — comentario obligatorio', () => {
  it.each([
    ['pending', 'cancelled'],
    ['in_progress', 'cancelled'],
    ['por_validar', 'cancelled'],
    ['por_validar', 'in_progress'], // devolución
  ] as [WorkOrderStatus, WorkOrderStatus][])('%s → %s exige comentario', (desde, hacia) => {
    const { el, confirmar, escribir, fixture } = montar(desde, hacia);
    expect(confirmar().disabled).toBe(true);
    expect(el.querySelector('[data-testid="comentario-obligatorio"]')).not.toBeNull();
    escribir('   ');
    expect(confirmar().disabled).toBe(true);
    escribir('Motivo claro');
    expect(confirmar().disabled).toBe(false);
    expect(el.querySelector('[data-testid="comentario-obligatorio"]')).toBeNull();
    fixture.destroy();
  });

  it.each([
    ['pending', 'in_progress'],
    ['in_progress', 'por_validar'],
    ['por_validar', 'completed'],
  ] as [WorkOrderStatus, WorkOrderStatus][])('%s → %s deja el comentario opcional', (desde, hacia) => {
    const { el, confirmar } = montar(desde, hacia);
    expect(confirmar().disabled).toBe(false);
    expect(el.querySelector('[data-testid="comentario-obligatorio"]')).toBeNull();
  });

  it('emite el comentario recortado al confirmar', () => {
    const { fixture, confirmar, escribir } = montar('por_validar', 'in_progress');
    const emitidos: string[] = [];
    fixture.componentInstance.confirmed.subscribe(c => emitidos.push(c));
    escribir('  Falta apretar los pernos  ');
    confirmar().click();
    expect(emitidos).toEqual(['Falta apretar los pernos']);
  });
});
