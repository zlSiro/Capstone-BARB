// frontend/src/app/core/models/ticket.model.ts
// --- Tickets conversacionales (HU-06, CGBIDA-124): docs/contrato_api_tickets.md ---

import { SessionMessage } from './chat.model';

/** Estados del ticket (máquina de estados estilo OT — docs/TICKETS_ARCHITECTURE.md, D2). */
export type TicketEstado = 'open' | 'in_progress' | 'resolved' | 'cancelled';

/** Ticket como lo devuelven POST, GET (listado) y PATCH. */
export interface Ticket {
  ticket_id: number;
  titulo: string;
  estado: TicketEstado;
  session_id: string;
  creado_por?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  /**
   * Destinos válidos para ESTE usuario (rol + dueñez), ya filtrados por el
   * backend — el frontend no duplica la máquina de estados (patrón OT).
   */
  allowed_transitions: TicketEstado[];
}

export interface TicketListResponse {
  tickets: Ticket[];
  /** Total que cumple el filtro, independiente de la paginación (para paginar). */
  total: number;
}

/** GET /api/tickets/{id}: el ticket + los mensajes en vivo de la conversación (D4: sin snapshot). */
export interface TicketDetail extends Ticket {
  messages: SessionMessage[];
}
