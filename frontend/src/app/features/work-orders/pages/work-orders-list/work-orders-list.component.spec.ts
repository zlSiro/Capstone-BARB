import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { WorkOrder } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { OtRealtimeEvent, OtRealtimeService, OtRealtimeState } from '../../../../core/services/ot-realtime.service';
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

/** Canal en vivo falso: el spec lo maneja a mano (el real abriría un EventSource). */
class FakeRealtime {
  readonly connection = signal<OtRealtimeState>('connected');
  readonly subject = new Subject<OtRealtimeEvent>();
  readonly events = this.subject.asObservable();
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

const YO = 7; // usuario autenticado en el spec

function setup(canChange = true) {
  const realtime = new FakeRealtime();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PermissionsService, useValue: { canPerform: () => canChange } },
      { provide: TenantContextService, useValue: { isSuper: () => false } },
      { provide: AuthService, useValue: { user: () => ({ id: YO, role: 'supervisor', name: 'Yo' }) } },
      { provide: OtRealtimeService, useValue: realtime },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(WorkOrdersListComponent);
  fixture.detectChanges();
  http.expectOne(r => r.url.endsWith('/work-orders')).flush([ORDER]);
  fixture.detectChanges();
  return { fixture, http, el: fixture.nativeElement as HTMLElement, toast: TestBed.inject(ToastService), realtime };
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
    // Cancelar exige el motivo: sin comentario el botón de confirmar está deshabilitado.
    const confirmar = () =>
      Array.from(el.querySelectorAll('app-ot-status-change-dialog button')).find(b =>
        b.textContent?.includes('Confirmar'),
      ) as HTMLButtonElement;
    expect(confirmar().disabled).toBe(true);
    const comentario = el.querySelector('app-ot-status-change-dialog textarea') as HTMLTextAreaElement;
    comentario.value = 'Duplicada';
    comentario.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(confirmar().disabled).toBe(false);
    confirmar().click();

    http
      .expectOne(r => r.method === 'PATCH')
      .flush({ detail: 'Transición no permitida.' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(r => r.method === 'GET' && r.url.endsWith('/work-orders/OT-2026-0001')).flush({ ...ORDER, estado: 'completed', allowed_transitions: [] });
    fixture.detectChanges();

    expect(toast.toasts()[0]).toMatchObject({ type: 'error', message: 'Transición no permitida.' });
    expect(el.querySelector('app-ot-status-change-dialog')).toBeNull();
    expect(el.querySelector('tbody select')).toBeNull(); // ahora es final: solo etiqueta
  });

  it('arranca el canal en vivo real y no el simulador falso', () => {
    const { realtime, el } = setup();
    expect(realtime.start).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('En vivo');
    expect(el.textContent).not.toContain('(simulado)');
  });

  it('un cambio hecho por OTRO usuario recarga esa OT, resalta la fila y avisa con un toast', () => {
    const { fixture, http, el, toast, realtime } = setup();
    realtime.subject.next({
      type: 'status_changed', numero_ot: 'OT-2026-0001', estado_anterior: 'pending', estado_nuevo: 'in_progress', usuario_id: 99,
    });
    // El estado real se lee del backend (con las transiciones propias de este rol), no del evento.
    http
      .expectOne(r => r.method === 'GET' && r.url.endsWith('/work-orders/OT-2026-0001'))
      .flush({ ...ORDER, estado: 'in_progress', allowed_transitions: ['por_validar', 'cancelled'] });
    fixture.detectChanges();

    expect((el.querySelector('tbody select') as HTMLSelectElement).options[0].textContent).toContain('En curso');
    expect(toast.toasts()[0]).toMatchObject({ type: 'info', message: 'OT-2026-0001: Pendiente → En curso' });
    expect(el.querySelector('tbody tr')?.classList).toContain('bg-media-suave');
    http.verify();
  });

  it('un cambio hecho por este mismo usuario no repite el aviso ni vuelve a pedir la OT', () => {
    const { http, toast, realtime } = setup();
    realtime.subject.next({
      type: 'status_changed', numero_ot: 'OT-2026-0001', estado_anterior: 'pending', estado_nuevo: 'in_progress', usuario_id: YO,
    });
    http.verify();
    expect(toast.toasts()).toHaveLength(0);
  });

  it('un cambio sobre una OT que no está en la lista se ignora', () => {
    const { http, toast, realtime } = setup();
    realtime.subject.next({
      type: 'status_changed', numero_ot: 'OT-2026-9999', estado_anterior: 'pending', estado_nuevo: 'in_progress', usuario_id: 99,
    });
    http.verify();
    expect(toast.toasts()).toHaveLength(0);
  });

  it('una OT creada por otro usuario recarga la lista y avisa', () => {
    const { fixture, http, el, toast, realtime } = setup();
    realtime.subject.next({ type: 'created', numero_ot: 'OT-2026-0002', usuario_id: 99 });
    http
      .expectOne(r => r.method === 'GET' && r.url.endsWith('/work-orders'))
      .flush([ORDER, { ...ORDER, id: 'OT-2026-0002', numero_ot: 'OT-2026-0002', ot_id: 2 }]);
    fixture.detectChanges();

    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(toast.toasts()[0]).toMatchObject({ type: 'info', message: 'Nueva OT: OT-2026-0002' });
  });

  it('resync (reconexión) recarga la lista sin avisar', () => {
    const { fixture, http, el, toast, realtime } = setup();
    realtime.subject.next({ type: 'resync' });
    http
      .expectOne(r => r.method === 'GET' && r.url.endsWith('/work-orders'))
      .flush([{ ...ORDER, estado: 'in_progress', allowed_transitions: [] }]);
    fixture.detectChanges();

    expect(el.textContent).toContain('En curso');
    expect(toast.toasts()).toHaveLength(0);
  });

  it('una OT eliminada desaparece de la lista', () => {
    const { fixture, el, realtime } = setup();
    realtime.subject.next({ type: 'deleted', numero_ot: 'OT-2026-0001', usuario_id: 99 });
    fixture.detectChanges();
    expect(el.textContent).not.toContain('OT-2026-0001');
    expect(el.textContent).toContain('No hay órdenes registradas');
  });

  it('al salir de la vista cierra el canal en vivo', () => {
    const { fixture, realtime } = setup();
    fixture.destroy();
    expect(realtime.stop).toHaveBeenCalled();
  });

  it('sin permiso no hay selector, solo la etiqueta de estado', () => {
    const { http, fixture, el } = setup(false);
    http.verify();
    // El backend ya entrega allowed_transitions vacío para estos roles.
    expect(fixture.componentInstance).toBeTruthy();
    expect(el.textContent).toContain('Tu rol no permite modificar estados');
  });
});


describe('WorkOrdersListComponent — botón «+ Crear OT» por rol', () => {
  function montarConRol(role: string) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: () => ({ role, name: 'T' }) } },
        { provide: TenantContextService, useValue: { isSuper: () => false } },
        { provide: OtRealtimeService, useValue: new FakeRealtime() },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(WorkOrdersListComponent);
    fixture.detectChanges();
    http.expectOne(r => r.url.endsWith('/work-orders')).flush([ORDER]);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const botonCrear = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).find(b => /Crear OT/.test(b.textContent ?? ''));

  it('el supervisor, único con permiso para crear una OT sin aviso previo, ve el botón y abre el diálogo', () => {
    const el = montarConRol('supervisor');
    expect(botonCrear(el)).toBeDefined();
    botonCrear(el)!.click();
    TestBed.tick();
    expect(el.querySelector('app-create-ot-modal')).not.toBeNull();
  });

  it.each(['operador', 'tecnico', 'engineer', 'gerente', 'admin'])('%s no ve el botón «+ Crear OT»', rol => {
    const el = montarConRol(rol);
    expect(botonCrear(el)).toBeUndefined();
    expect(el.querySelector('app-create-ot-modal')).toBeNull();
  });
});
