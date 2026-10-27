import { Service, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { WorkOrder, WorkOrderStatus } from '../models';

export type LiveConnectionState = 'connected' | 'reconnecting';

/** Espejo reducido de TRANSICIONES del backend (work_order_states.py), solo para la demo. */
const SIMULATABLE: WorkOrderStatus[] = ['pending', 'assigned', 'overdue', 'in_progress'];

/** Estados a los que el rol puede mover la OT desde cada estado (para recalcular `allowed_transitions`). */
const FOLLOWING: Partial<Record<WorkOrderStatus, WorkOrderStatus[]>> = {
  in_progress: ['completed', 'cancelled'],
};

const CANCEL_PROBABILITY = 0.1;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  overdue: 'Overdue',
};

const CHANGE_INTERVAL_MS: [number, number] = [8_000, 15_000];
const DROPOUT_EVERY_MS = 60_000;
const DROPOUT_DURATION_MS: [number, number] = [3_000, 5_000];

/**
 * Simulador de monitoreo en vivo (HU-10, demo): genera cambios de estado falsos sobre las OT ya
 * cargadas y alterna conectado/reconectando. No toca el backend; el SSE real vive en `routers/realtime.py`.
 */
@Service()
export class OtLiveSimulatorService {
  readonly connection = signal<LiveConnectionState>('connected');

  private readonly subject = new Subject<WorkOrder>();
  readonly changes: Observable<WorkOrder> = this.subject.asObservable();

  private source: () => WorkOrder[] = () => [];
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private dropoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private readonly onVisibility = (): void => {
    if (!this.running) return;
    if (document.hidden) this.clearTimers();
    else this.schedule();
  };

  start(source: () => WorkOrder[]): void {
    this.stop();
    this.source = source;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    if (!document.hidden) this.schedule();
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearTimers();
    this.connection.set('connected');
  }

  /** Aleatoriedad inyectable para tests deterministas. */
  protected random(): number {
    return Math.random();
  }

  private between([min, max]: [number, number]): number {
    return min + this.random() * (max - min);
  }

  private schedule(): void {
    this.clearTimers();
    this.changeTimer = setTimeout(() => this.tickChange(), this.between(CHANGE_INTERVAL_MS));
    this.dropoutTimer = setTimeout(() => this.tickDropout(), DROPOUT_EVERY_MS);
  }

  private clearTimers(): void {
    for (const timer of [this.changeTimer, this.dropoutTimer, this.reconnectTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    this.changeTimer = this.dropoutTimer = this.reconnectTimer = null;
    this.connection.set('connected');
  }

  private tickChange(): void {
    if (this.connection() === 'connected') this.emitChange();
    this.changeTimer = setTimeout(() => this.tickChange(), this.between(CHANGE_INTERVAL_MS));
  }

  private tickDropout(): void {
    this.connection.set('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.connection.set('connected');
      this.reconnectTimer = null;
    }, this.between(DROPOUT_DURATION_MS));
    this.dropoutTimer = setTimeout(() => this.tickDropout(), DROPOUT_EVERY_MS);
  }

  private emitChange(): void {
    const candidates = this.source().filter(ot => SIMULATABLE.includes(ot.estado));
    if (!candidates.length) return;

    const ot = candidates[Math.floor(this.random() * candidates.length) % candidates.length];
    let estado: WorkOrderStatus = 'in_progress';
    if (ot.estado === 'in_progress') estado = this.random() < CANCEL_PROBABILITY ? 'cancelled' : 'completed';
    const now = new Date().toISOString();

    this.subject.next({
      ...ot,
      estado,
      status: STATUS_LABEL[estado] ?? estado,
      fecha_inicio: estado === 'in_progress' ? now : ot.fecha_inicio,
      fecha_cierre: estado === 'completed' || estado === 'cancelled' ? now : ot.fecha_cierre,
      allowed_transitions: FOLLOWING[estado] ?? [],
    });
  }
}
