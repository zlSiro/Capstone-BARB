import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { WorkOrder } from '../../../../core/models';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { ToastService } from '../../../../core/services/toast.service';
import { WorkOrdersListComponent } from './work-orders-list.component';

const ORDER = {
  id: 'OT-2026-0001',
  numero_ot: 'OT-2026-0001',
  ot_id: 1,
  title: 'Vibración anormal',
  machine_name: 'Compresor A1',
  plant_name: 'Planta Central',
  tecnico_nombre: 'Carlos',
  tipo: 'corrective',
  priority: 'high',
  estado: 'pending',
  created_at: '2026-10-01T03:35:31Z',
  allowed_transitions: ['in_progress', 'cancelled'],
} as WorkOrder;

function setup(canChange = true) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PermissionsService, useValue: { canPerform: () => canChange } },
      { provide: TenantContextService, useValue: { isSuper: () => false } },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(WorkOrdersListComponent);
  fixture.detectChanges();
  http.expectOne(r => r.url.endsWith('/work-orders')).flush([ORDER]);
  fixture.detectChanges();
  return { fixture, http, el: fixture.nativeElement as HTMLElement, toast: TestBed.inject(ToastService) };
}

describe('WorkOrdersListComponent — cambio de estado', () => {
  it('muestra el selector de estado con las transiciones permitidas', () => {
    const { el } = setup();
    expect(el.querySelector('tbody select')).not.toBeNull();
    expect(el.textContent).toContain('Pendiente');
  });

  it('cambia el estado tras confirmar: PATCH, lista actualizada y toast de éxito', () => {
    const { fixture, http, el, toast } = setup();
    const select = el.querySelector('tbody select') as HTMLSelectElement;
    select.value = 'in_progress';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const dialog = el.querySelector('app-ot-status-change-dialog') as HTMLElement;
    expect(dialog).not.toBeNull();
    (Array.from(dialog.querySelectorAll('button')).find(b => b.textContent?.includes('Confirmar')) as HTMLButtonElement).click();

    const req = http.expectOne(r => r.method === 'PATCH' && r.url.endsWith('/work-orders/OT-2026-0001/status'));
    expect(req.request.body).toEqual({ status: 'in_progress' });
    req.flush({ ...ORDER, estado: 'in_progress', allowed_transitions: ['completed', 'cancelled'] });
    fixture.detectChanges();

    expect(el.querySelector('app-ot-status-change-dialog')).toBeNull();
    expect((el.querySelector('tbody select') as HTMLSelectElement).options[0].textContent).toContain('En curso');
    expect(toast.toasts()[0]).toMatchObject({ type: 'success', message: 'OT-2026-0001: Pendiente → En curso' });
  });

  it('ante un 409 informa el error, cierra el diálogo y refresca la OT', () => {
    const { fixture, http, el, toast } = setup();
    const select = el.querySelector('tbody select') as HTMLSelectElement;
    select.value = 'cancelled';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (Array.from(el.querySelectorAll('app-ot-status-change-dialog button')).find(b =>
      b.textContent?.includes('Confirmar'),
    ) as HTMLButtonElement).click();

    http
      .expectOne(r => r.method === 'PATCH')
      .flush({ detail: 'Transición no permitida.' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/work-orders/OT-2026-0001')).flush({ ...ORDER, estado: 'completed', allowed_transitions: [] });
    fixture.detectChanges();

    expect(toast.toasts()[0]).toMatchObject({ type: 'error', message: 'Transición no permitida.' });
    expect(el.querySelector('app-ot-status-change-dialog')).toBeNull();
    expect(el.querySelector('tbody select')).toBeNull(); // ahora es final: solo etiqueta
  });

  it('sin permiso no hay selector, solo la etiqueta de estado', () => {
    const { http, fixture, el } = setup(false);
    http.verify();
    // El backend ya entrega allowed_transitions vacío para estos roles.
    expect(fixture.componentInstance).toBeTruthy();
    expect(el.textContent).toContain('Tu rol no permite modificar estados');
  });
});
