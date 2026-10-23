import { Service, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Ticket, TicketDetail, TicketEstado, TicketListResponse } from '../models';
import { environment } from '../../../environments/environment';

/**
 * Tickets conversacionales (HU-06): una conversación del DocChat promovida a
 * unidad de seguimiento. Contrato: docs/contrato_api_tickets.md.
 */
@Service()
export class TicketsApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/tickets`;

  /**
   * POST /api/tickets — promueve una conversación propia a ticket (1:1: una
   * sesión ya con ticket responde 409 con `{detail: {message, ticket_id}}`;
   * el componente lo maneja desde el `error` del observable).
   */
  create(sessionId: string, titulo?: string): Observable<Ticket> {
    return this.http.post<Ticket>(this.url, {
      session_id: sessionId,
      ...(titulo ? { titulo } : {}),
    });
  }

  /** GET /api/tickets — visibilidad del listado: dueño o permiso `history` (el backend decide). */
  getAll(f: { estado?: TicketEstado | null; limit?: number; offset?: number } = {}): Observable<TicketListResponse> {
    let params = new HttpParams().set('limit', String(f.limit ?? 20)).set('offset', String(f.offset ?? 0));
    if (f.estado) params = params.set('estado', f.estado);
    return this.http.get<TicketListResponse>(this.url, { params });
  }

  /** GET /api/tickets/{id} — detalle con los mensajes en vivo de la conversación (D4). */
  get(ticketId: number): Observable<TicketDetail> {
    return this.http.get<TicketDetail>(`${this.url}/${ticketId}`);
  }

  /** PATCH /api/tickets/{id}/estado — transición; la máquina (409) y el rol/dueñez (403) valida el backend. */
  updateEstado(ticketId: number, estado: TicketEstado): Observable<Ticket> {
    return this.http.patch<Ticket>(`${this.url}/${ticketId}/estado`, { estado });
  }
}
