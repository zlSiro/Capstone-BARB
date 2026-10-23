import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { TicketsApi } from '../../core/services/tickets-api';
import { apiErrorMessage } from '../../core/utils/http-error';
import { Ticket, TicketDetail, TicketEstado } from '../../core/models';

/** Presentación de cada estado: colores AA con contraste (badge + dot). La etiqueta llega por i18n (statuses.*). */
const ESTADO_STYLE: Record<TicketEstado, { badge: string; dot: string }> = {
  open: { badge: 'bg-amber-100 text-amber-900', dot: 'bg-amber-600' },
  in_progress: { badge: 'bg-blue-100 text-blue-900', dot: 'bg-blue-600' },
  resolved: { badge: 'bg-green-100 text-green-900', dot: 'bg-green-600' },
  cancelled: { badge: 'bg-gray-100 text-gray-600', dot: 'bg-gray-500' },
};

const ESTADOS: TicketEstado[] = ['open', 'in_progress', 'resolved', 'cancelled'];
const PAGE_SIZE = 20;

/**
 * Tickets conversacionales (HU-06): listado visible para el usuario (dueño o
 * permiso `history`) + detalle con la conversación en vivo que originó el ticket.
 */
@Component({
  selector: 'app-tickets',
  imports: [DatePipe, RouterLink, TranslatePipe],
  templateUrl: './tickets.html',
})
export class Tickets {
  private readonly api = inject(TicketsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);

  protected readonly estados = ESTADOS;
  protected readonly estadoStyle = (e: TicketEstado) => ESTADO_STYLE[e];

  // ── Listado ──
  protected readonly items = signal<Ticket[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly filtroEstado = signal<TicketEstado | ''>('');

  // ── Detalle ──
  protected readonly detalle = signal<TicketDetail | null>(null);
  protected readonly loadingDetalle = signal(false);
  protected readonly guardandoEstado = signal(false);

  protected readonly desdeN = computed(() => (this.total() ? this.offset() + 1 : 0));
  protected readonly hastaN = computed(() => Math.min(this.offset() + PAGE_SIZE, this.total()));
  protected readonly hayPrev = computed(() => this.offset() > 0);
  protected readonly hayNext = computed(() => this.offset() + PAGE_SIZE < this.total());

  constructor() {
    this.load();

    // ?ticket_id= llega al navegar desde el DocChat (creación o 409 del 1:1).
    this.route.queryParamMap.subscribe((params) => {
      const tid = params.get('ticket_id');
      if (tid) this.verDetalle(Number(tid));
    });
  }

  protected onFiltroEstado(value: string): void {
    this.filtroEstado.set(value === '' ? '' : (value as TicketEstado));
    this.offset.set(0);
    this.load();
  }

  protected paginar(direccion: 1 | -1): void {
    this.offset.update((o) => Math.max(0, o + direccion * PAGE_SIZE));
    this.load();
  }

  protected seleccionar(t: Ticket): void {
    this.verDetalle(t.ticket_id);
  }

  protected verDetalle(ticketId: number): void {
    this.loadingDetalle.set(true);
    this.api.get(ticketId).subscribe({
      next: (d) => {
        this.detalle.set(d);
        this.loadingDetalle.set(false);
      },
      error: (err) => {
        this.loadingDetalle.set(false);
        this.toast.error(apiErrorMessage(err, this.i18n.t('tickets').loadDetailError));
      },
    });
  }

  /**
   * PATCH de transición de estado (CGBIDA-291). Los botones nacen de
   * `allowed_transitions` (máquina de estados del backend filtrada por rol y
   * dueñez): el frontend no duplica esas reglas (patrón OT).
   */
  protected cambiarEstado(destino: TicketEstado): void {
    const d = this.detalle();
    if (!d || this.guardandoEstado()) return;
    this.guardandoEstado.set(true);

    this.api.updateEstado(d.ticket_id, destino).subscribe({
      next: (t) => {
        this.guardandoEstado.set(false);
        // Refresca el detalle (allowed_transitions y resolved_at nuevos) y la fila del listado.
        this.verDetalle(t.ticket_id);
        this.items.update((list) => list.map((x) => (x.ticket_id === t.ticket_id ? t : x)));
        this.toast.success(this.i18n.t('tickets').estadoChanged);
      },
      error: (err) => {
        this.guardandoEstado.set(false);
        this.toast.error(apiErrorMessage(err, this.i18n.t('tickets').estadoError));
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .getAll({ estado: this.filtroEstado() || null, limit: PAGE_SIZE, offset: this.offset() })
      .subscribe({
        next: (page) => {
          this.items.set(page.tickets);
          this.total.set(page.total);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(apiErrorMessage(err, this.i18n.t('tickets').loadError));
          this.loading.set(false);
        },
      });
  }
}
