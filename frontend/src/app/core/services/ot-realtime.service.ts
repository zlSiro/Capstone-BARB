import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject, signal } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';

import { environment } from '../../../environments/environment';

/** Estado de la conexión en vivo. `disconnected`: no se reintenta (sin permiso o sesión vencida). */
export type OtRealtimeState = 'connected' | 'reconnecting' | 'disconnected';

/** Eventos del canal SSE de OT (`GET /api/work-orders/stream`), ya tipados. Contrato: `backend/.../routers/realtime.py`. */
export type OtRealtimeEvent =
  | { type: 'status_changed'; numero_ot: string; estado_anterior: string; estado_nuevo: string; usuario_id: number | null }
  | { type: 'created'; numero_ot: string; usuario_id: number | null }
  | { type: 'deleted'; numero_ot: string; usuario_id: number | null }
  /** Hay que volver a pedir la lista: se reconectó, o el servidor perdió eventos. */
  | { type: 'resync' };

const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 30_000;

/**
 * Monitoreo de OT en tiempo real contra el backend (HU-10).
 *
 * `EventSource` no envía headers, así que se pide primero un ticket de un solo uso (`POST …/stream/ticket`, ya con el
 * Bearer del interceptor) y se abre `…/stream?ticket=`. Como el ticket se consume al conectar, el reintento automático
 * del navegador no sirve: cada reconexión pide un ticket nuevo, con espera creciente.
 *
 * Al volver a conectar (o si el servidor avisa `resync`) emite `{ type: 'resync' }` para que la vista recargue la lista,
 * porque `EventSource` no puede mandar `Last-Event-ID` con un ticket nuevo y pudo perderse algún cambio.
 * Con la pestaña oculta se cierra la conexión y se retoma al volver.
 */
@Service()
export class OtRealtimeService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly connection = signal<OtRealtimeState>('reconnecting');

  private readonly subject = new Subject<OtRealtimeEvent>();
  readonly events: Observable<OtRealtimeEvent> = this.subject.asObservable();

  private source: EventSource | null = null;
  private ticketRequest: Subscription | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private running = false;
  private hasConnectedBefore = false;

  private readonly onVisibility = (): void => {
    if (!this.running) return;
    if (document.hidden) this.close();
    else this.open();
  };

  start(): void {
    if (this.running || typeof EventSource === 'undefined') return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    if (!document.hidden) this.open();
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.close();
    this.hasConnectedBefore = false;
    this.attempts = 0;
  }

  private open(): void {
    if (!this.running || this.source || this.ticketRequest) return;
    this.connection.set('reconnecting');
    this.ticketRequest = this.http.post<{ ticket: string }>(`${this.apiUrl}/work-orders/stream/ticket`, {}).subscribe({
      next: ({ ticket }) => {
        this.ticketRequest = null;
        this.connect(ticket);
      },
      error: (err: unknown) => {
        this.ticketRequest = null;
        // 403: el rol no tiene OT (super_usuario). 401: el interceptor cierra la sesión. En ambos casos no se reintenta.
        if (err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403)) {
          this.giveUp();
        } else {
          this.scheduleRetry();
        }
      },
    });
  }

  private connect(ticket: string): void {
    const source = new EventSource(`${this.apiUrl}/work-orders/stream?ticket=${encodeURIComponent(ticket)}`);
    this.source = source;

    source.addEventListener('hello', () => {
      this.attempts = 0;
      this.connection.set('connected');
      // Reconexión: pudo perderse algún cambio mientras no hubo conexión.
      if (this.hasConnectedBefore) this.subject.next({ type: 'resync' });
      this.hasConnectedBefore = true;
    });
    source.addEventListener('resync', () => this.subject.next({ type: 'resync' }));
    source.addEventListener('ot.status_changed', e => {
      const d = this.parse(e);
      if (d && typeof d['numero_ot'] === 'string') {
        this.subject.next({
          type: 'status_changed',
          numero_ot: d['numero_ot'],
          estado_anterior: String(d['estado_anterior'] ?? ''),
          estado_nuevo: String(d['estado_nuevo'] ?? ''),
          usuario_id: this.userId(d),
        });
      }
    });
    source.addEventListener('ot.created', e => this.emitSimple('created', e));
    source.addEventListener('ot.deleted', e => this.emitSimple('deleted', e));
    // `error` es a la vez el evento nativo de red y un evento SSE del servidor (`session_expired`): se distinguen por tipo.
    source.addEventListener('error', e => {
      if (e instanceof MessageEvent) {
        this.giveUp();
        return;
      }
      this.close();
      this.scheduleRetry();
    });
  }

  private emitSimple(type: 'created' | 'deleted', e: Event): void {
    const d = this.parse(e);
    if (d && typeof d['numero_ot'] === 'string') this.subject.next({ type, numero_ot: d['numero_ot'], usuario_id: this.userId(d) });
  }

  private parse(e: Event): Record<string, unknown> | null {
    try {
      const data: unknown = JSON.parse((e as MessageEvent<string>).data);
      return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private userId(d: Record<string, unknown>): number | null {
    return typeof d['usuario_id'] === 'number' ? d['usuario_id'] : null;
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer !== null || document.hidden) return;
    this.connection.set('reconnecting');
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempts);
    this.attempts++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  /** Sin permiso o sesión vencida: se deja de intentar (volver a entrar lo reinicia). */
  private giveUp(): void {
    this.close();
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.connection.set('disconnected');
  }

  private close(): void {
    this.source?.close();
    this.source = null;
    this.ticketRequest?.unsubscribe();
    this.ticketRequest = null;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.connection() === 'connected') this.connection.set('reconnecting');
  }
}
