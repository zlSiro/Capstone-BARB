import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OtRealtimeEvent, OtRealtimeService } from './ot-realtime.service';

/** `EventSource` falso: jsdom no lo trae, y el spec necesita disparar eventos a mano. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((e: Event) => void)[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close(): void {
    this.closed = true;
  }

  /** Evento SSE con datos (llega como `MessageEvent`). */
  emit(type: string, data?: unknown): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  /** Error nativo de red (no es un `MessageEvent`). */
  networkError(): void {
    for (const fn of this.listeners.get('error') ?? []) fn(new Event('error'));
  }
}

const TICKET_URL = (r: { url: string }) => r.url.endsWith('/work-orders/stream/ticket');

function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const service = TestBed.inject(OtRealtimeService);
  const http = TestBed.inject(HttpTestingController);
  const events: OtRealtimeEvent[] = [];
  service.events.subscribe(e => events.push(e));
  const ultimo = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];
  /** start() → ticket → EventSource abierto. */
  const conectar = (ticket = 'T1') => {
    http.expectOne(TICKET_URL).flush({ ticket });
    return ultimo();
  };
  return { service, http, events, conectar, ultimo };
}

describe('OtRealtimeService', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pide un ticket y abre el stream con él (EventSource no envía headers)', () => {
    const { service, conectar } = setup();
    service.start();
    expect(service.connection()).toBe('reconnecting');
    const source = conectar('abc 123');
    expect(source.url).toMatch(/\/work-orders\/stream\?ticket=abc%20123$/);
    // Recién `hello` confirma la conexión.
    expect(service.connection()).toBe('reconnecting');
    source.emit('hello', { connected: true });
    expect(service.connection()).toBe('connected');
    service.stop();
  });

  it('start() repetido no abre una segunda conexión', () => {
    const { service, http, conectar } = setup();
    service.start();
    service.start();
    conectar();
    http.expectNone(TICKET_URL);
    expect(FakeEventSource.instances).toHaveLength(1);
    service.stop();
  });

  it('traduce los eventos del backend a eventos tipados', () => {
    const { service, events, conectar } = setup();
    service.start();
    const source = conectar();
    source.emit('hello', { connected: true });

    source.emit('ot.status_changed', { numero_ot: 'OT-1', estado_anterior: 'pending', estado_nuevo: 'in_progress', usuario_id: 5 });
    source.emit('ot.created', { numero_ot: 'OT-2', usuario_id: 6 });
    source.emit('ot.deleted', { numero_ot: 'OT-3' });
    source.emit('resync', { reason: 'overflow' });

    expect(events).toEqual([
      { type: 'status_changed', numero_ot: 'OT-1', estado_anterior: 'pending', estado_nuevo: 'in_progress', usuario_id: 5 },
      { type: 'created', numero_ot: 'OT-2', usuario_id: 6 },
      { type: 'deleted', numero_ot: 'OT-3', usuario_id: null },
      { type: 'resync' },
    ]);
    service.stop();
  });

  it('ignora eventos con datos ilegibles o sin número de OT', () => {
    const { service, events, conectar } = setup();
    service.start();
    const source = conectar();
    for (const fn of source.listeners.get('ot.status_changed') ?? []) fn(new MessageEvent('ot.status_changed', { data: '{no es json' }));
    source.emit('ot.created', { sin_numero: true });
    expect(events).toEqual([]);
    service.stop();
  });

  it('ante un error de red cierra, espera y vuelve con un TICKET NUEVO; al reconectar pide resync', () => {
    const { service, http, events, conectar } = setup();
    service.start();
    const primera = conectar('T1');
    primera.emit('hello', { connected: true });
    expect(events).toEqual([]); // la primera conexión no necesita resync

    primera.networkError();
    expect(primera.closed).toBe(true);
    expect(service.connection()).toBe('reconnecting');
    http.expectNone(TICKET_URL); // todavía no: espera 3 s

    vi.advanceTimersByTime(3_000);
    const segunda = conectar('T2');
    expect(segunda).not.toBe(primera);
    expect(segunda.url).toContain('ticket=T2');

    segunda.emit('hello', { connected: true });
    expect(service.connection()).toBe('connected');
    expect(events).toEqual([{ type: 'resync' }]); // pudo perderse algún cambio mientras no hubo conexión
    service.stop();
  });

  it('la espera entre reintentos crece (3 s, 6 s…) y se reinicia al reconectar', () => {
    const { service, http, conectar } = setup();
    service.start();
    conectar('T1').networkError();

    vi.advanceTimersByTime(2_999);
    http.expectNone(TICKET_URL);
    vi.advanceTimersByTime(1);
    conectar('T2').networkError();

    vi.advanceTimersByTime(5_999);
    http.expectNone(TICKET_URL);
    vi.advanceTimersByTime(1);
    const tercera = conectar('T3');
    tercera.emit('hello', { connected: true });

    // Conectó: el próximo fallo vuelve a esperar 3 s.
    tercera.networkError();
    vi.advanceTimersByTime(3_000);
    conectar('T4');
    service.stop();
  });

  it('si el servidor avisa que la sesión expiró deja de intentar', () => {
    const { service, http, conectar } = setup();
    service.start();
    const source = conectar();
    source.emit('hello', { connected: true });

    source.emit('error', { code: 'session_expired' }); // evento SSE (MessageEvent), no un error de red
    expect(source.closed).toBe(true);
    expect(service.connection()).toBe('disconnected');
    vi.advanceTimersByTime(120_000);
    http.expectNone(TICKET_URL);
  });

  it.each([401, 403])('si el ticket responde %s no reintenta (sin permiso o sin sesión)', status => {
    const { service, http } = setup();
    service.start();
    http.expectOne(TICKET_URL).flush({ detail: 'no' }, { status, statusText: 'x' });
    expect(service.connection()).toBe('disconnected');
    vi.advanceTimersByTime(120_000);
    http.expectNone(TICKET_URL);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('si el ticket falla por un error del servidor reintenta', () => {
    const { service, http, conectar } = setup();
    service.start();
    http.expectOne(TICKET_URL).flush({ detail: 'boom' }, { status: 500, statusText: 'Server Error' });
    expect(service.connection()).toBe('reconnecting');
    vi.advanceTimersByTime(3_000);
    conectar('T2');
    expect(FakeEventSource.instances).toHaveLength(1);
    service.stop();
  });

  it('stop() cierra el stream y cancela un reintento pendiente', () => {
    const { service, http, conectar } = setup();
    service.start();
    const source = conectar();
    source.emit('hello', { connected: true });
    source.networkError();

    service.stop();
    vi.advanceTimersByTime(120_000);
    http.expectNone(TICKET_URL);
    expect(source.closed).toBe(true);
  });

  it('con la pestaña oculta cierra la conexión y al volver pide un ticket nuevo', () => {
    const { service, http, conectar } = setup();
    service.start();
    const source = conectar();
    source.emit('hello', { connected: true });

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(source.closed).toBe(true);
    http.expectNone(TICKET_URL);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(conectar('T2').url).toContain('ticket=T2');
    service.stop();
  });

  it('sin EventSource en el navegador no hace nada', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('EventSource', undefined);
    const { service, http } = setup();
    service.start();
    http.expectNone(TICKET_URL);
  });
});
