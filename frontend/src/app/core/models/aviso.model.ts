// =============================================================================
// AVISOS DE FALLA — contrato de /api/avisos
// =============================================================================
//
// Quienes trabajan en planta reportan una falla; el aviso llega al repositorio del supervisor,
// que decide si genera una OT o lo descarta (con motivo).

import { WorkOrder, WorkOrderPriority, WorkOrderSeverity } from './work-order.model';

export type EstadoAviso = 'pendiente' | 'con_ot' | 'descartado';

export interface Aviso {
  aviso_id: number;
  /** Número visible, p. ej. `AV-2026-0007`. */
  numero_aviso: string;
  maquina_id: number;
  machine_name: string;
  plant_name: string;
  empresa_id: number | null;
  descripcion: string;
  severidad: WorkOrderSeverity | null;
  estado: EstadoAviso;
  /** Etiqueta legible del estado (Pendiente, Con OT, Descartado). */
  status: string;
  reportado_por: { id: number; nombre: string; rol: string };
  created_at: string;
  /** Solo cuando ya se decidió. */
  resuelto_en: string | null;
  resuelto_por: string | null;
  /** Presente cuando el aviso se descartó. */
  motivo_descarte: string | null;
  /** Presente cuando el aviso generó una OT. */
  numero_ot: string | null;
  /** Foto que adjuntó quien reportó (se descarga por `GET /api/avisos/{id}/foto`); null si no adjuntó. */
  foto: { original_name: string; content_type: string } | null;
}

export interface AvisoCreatePayload {
  maquina_id: number;
  descripcion: string;
  severidad: WorkOrderSeverity;
}

export interface AvisoGenerarOtPayload {
  tecnico_id: number;
  priority: WorkOrderPriority;
  /** ISO 8601; vacío = el backend calcula el vencimiento según el SLA. */
  fecha_vencimiento?: string;
}

export interface AvisoGenerarOtResponse {
  aviso: Aviso;
  ot: WorkOrder;
}
