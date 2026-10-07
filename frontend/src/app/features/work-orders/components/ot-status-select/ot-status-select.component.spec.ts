import { TestBed } from '@angular/core/testing';

import { WorkOrder } from '../../../../core/models';
import { OtStatusSelectComponent, StatusChangeRequest } from './ot-status-select.component';

function makeOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'OT-2026-0001',
    numero_ot: 'OT-2026-0001',
    ot_id: 1,
    estado: 'pending',
    allowed_transitions: ['in_progress', 'cancelled'],
    ...overrides,
  } as WorkOrder;
}

function setup(order: WorkOrder) {
  const fixture = TestBed.createComponent(OtStatusSelectComponent);
  fixture.componentRef.setInput('order', order);
  const requests: StatusChangeRequest[] = [];
  fixture.componentInstance.changeRequested.subscribe(r => requests.push(r));
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, requests };
}

describe('OtStatusSelectComponent', () => {
  it('ofrece solo el estado actual y los destinos permitidos', () => {
    const { el } = setup(makeOrder());
    const options = Array.from(el.querySelectorAll('option')).map(o => o.textContent?.trim());
    expect(options).toEqual(['Pendiente', '→ En curso', '→ Cancelada']);
  });

  it('muestra solo la etiqueta cuando no hay destinos (estado final o rol sin permiso)', () => {
    const { el } = setup(makeOrder({ estado: 'completed', allowed_transitions: [] }));
    expect(el.querySelector('select')).toBeNull();
    expect(el.textContent).toContain('Cerrada');
  });

  it('muestra solo la etiqueta si el backend no informa transiciones', () => {
    const { el } = setup(makeOrder({ allowed_transitions: undefined }));
    expect(el.querySelector('select')).toBeNull();
  });

  it('emite la solicitud de cambio y deja el selector en el estado vigente', () => {
    const order = makeOrder();
    const { el, requests } = setup(order);
    const select = el.querySelector('select') as HTMLSelectElement;

    select.value = 'in_progress';
    select.dispatchEvent(new Event('change'));

    expect(requests).toEqual([{ order, to: 'in_progress' }]);
    expect(select.value).toBe('pending');
  });
});
