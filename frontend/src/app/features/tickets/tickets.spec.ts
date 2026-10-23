import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { Tickets } from './tickets';
import { Ticket, TicketDetail, TicketListResponse } from '../../core/models';

const TICKET: Ticket = {
  ticket_id: 12,
  titulo: 'Vibración anormal en prensa B3',
  estado: 'open',
  session_id: 'bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd',
  creado_por: 'Operador Molino',
  created_at: '2026-10-22T18:30:00Z',
  updated_at: '2026-10-22T18:30:00Z',
  resolved_at: null,
  // Dueño operador (D2): puede avanzar, no cancelar.
  allowed_transitions: ['in_progress'],
};

const PAGINA: TicketListResponse = { tickets: [TICKET], total: 21 };

const DETALLE: TicketDetail = {
  ...TICKET,
  messages: [
    { role: 'user', content: '¿cómo calibro la prensa?', timestamp: 1 },
    { role: 'assistant', content: 'Según el manual, a 85 Nm.', timestamp: 2 },
  ],
};

describe('Tickets', () => {
  let http: HttpTestingController;

  const listados = () => http.match((r) => r.method === 'GET' && r.url.endsWith('/tickets'));
  const ultimo = (reqs: ReturnType<typeof listados>) => reqs[reqs.length - 1];

  function setup(queryParams: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(queryParams)) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Tickets);
    fixture.detectChanges();
    listados().forEach((r) => r.flush(PAGINA));
    fixture.detectChanges();
    return fixture;
  }

  function cargarDetalle(fixture: ReturnType<typeof setup>, detalle: TicketDetail = DETALLE) {
    const fila = fixture.nativeElement.querySelector('tbody tr') as HTMLTableRowElement;
    fila.click();
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith(`/tickets/${detalle.ticket_id}`)).flush(detalle);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('carga el listado por defecto y muestra el ticket con su rango', () => {
    const fixture = setup();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Vibración anormal en prensa B3');
    expect(text).toContain('Operador Molino');
    expect(text).toContain('1–20 de 21');
  });

  it('filtra por estado y resetea el offset', () => {
    const fixture = setup();
    const select = fixture.nativeElement.querySelector('#tk-estado') as HTMLSelectElement;
    select.value = 'in_progress';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const req = ultimo(listados());
    expect(req.request.params.get('estado')).toBe('in_progress');
    req.flush({ tickets: [], total: 0 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Todavía no hay tickets');
  });

  it('pagina con next y envía offset 20', () => {
    const fixture = setup();
    const next = fixture.nativeElement.querySelector('#tk-next') as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    next.click();
    fixture.detectChanges();
    const req = ultimo(listados());
    expect(req.request.params.get('offset')).toBe('20');
    req.flush(PAGINA);
  });

  it('abre el detalle con los mensajes en vivo de la conversación', () => {
    const fixture = setup();
    cargarDetalle(fixture);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('¿cómo calibro la prensa?');
    expect(text).toContain('Según el manual, a 85 Nm.');
    expect(text).toContain('Pasar a');
  });

  it('?ticket_id abre el detalle directo (navegación desde el DocChat)', () => {
    const fixture = setup({ ticket_id: '12' });
    http.expectOne((r) => r.url.endsWith('/tickets/12')).flush(DETALLE);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('¿cómo calibro la prensa?');
  });

  it('transiciona el estado desde allowed_transitions y refresca detalle y fila', () => {
    const fixture = setup();
    cargarDetalle(fixture);

    // Botón "En Progreso" (única transición del dueño operador).
    const btn = fixture.nativeElement.querySelector('aside button') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('En Progreso');
    btn.click();
    fixture.detectChanges();

    const patch = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/tickets/12/estado'));
    expect(patch.request.body).toEqual({ estado: 'in_progress' });
    const avanzado: Ticket = {
      ...TICKET,
      estado: 'in_progress',
      allowed_transitions: ['resolved'],
      updated_at: '2026-10-22T19:12:00Z',
    };
    patch.flush(avanzado);
    // El detalle se refresca para traer los nuevos allowed_transitions.
    http.expectOne((r) => r.url.endsWith('/tickets/12')).flush({ ...DETALLE, ...avanzado });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('En Progreso');
    // La fila del listado quedó actualizada: su badge pasó de 'Abierta' a 'En Progreso'.
    const badge = fixture.nativeElement.querySelector('tbody .rounded-full') as HTMLElement;
    expect(badge.textContent).toContain('En Progreso');
    expect(badge.textContent).not.toContain('Abierta');
  });
});
