import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { WorkOrder } from '../../../../core/models';
import { OtDetailSheetComponent } from './ot-detail-sheet.component';

function orden(parcial: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'OT-2026-0042',
    numero_ot: 'OT-2026-0042',
    ot_id: 42,
    title: 'Vibración anormal en el motor',
    description: 'Vibración anormal en el motor',
    machine_name: 'Compresor A1',
    plant_name: 'Planta Central',
    discipline_name: 'Mecánica',
    priority: 'high',
    estado: 'pending',
    status: 'Open',
    created_at: '2026-10-28T12:00:00Z',
    tecnico_nombre: 'Carlos Mendoza',
    tipo: 'corrective',
    allowed_transitions: [],
    status_history: [],
    ...parcial,
  } as WorkOrder;
}

function render(order: WorkOrder) {
  TestBed.configureTestingModule({ imports: [OtDetailSheetComponent] });
  const fixture = TestBed.createComponent(OtDetailSheetComponent);
  fixture.componentRef.setInput('order', order);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('OtDetailSheetComponent: origen de la OT', () => {
  it('identifica en una esquina el reporte de falla que dio origen a la OT', () => {
    const el = render(orden({ aviso_falla_id: 7, numero_aviso: 'AV-2026-0007' }));
    const badge = el.querySelector('[data-testid="modal-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Reporte de falla de origen');
    expect(badge!.textContent).toContain('AV-2026-0007');
    // Está en la cabecera, junto al botón de cerrar (la esquina superior derecha del modal).
    expect(badge!.parentElement!.querySelector('button[aria-label="Cerrar"]')).not.toBeNull();
  });

  it('una OT creada directamente no muestra ningún reporte de origen', () => {
    const el = render(orden({ aviso_falla_id: null, numero_aviso: null }));
    expect(el.querySelector('[data-testid="modal-badge"]')).toBeNull();
    expect(el.textContent).toContain('OT-2026-0042');
  });
});
