import { EstadoAviso, WorkOrderPriority, WorkOrderSeverity } from '../../core/models';

/** Presentación de los avisos de falla: estados, gravedad y la prioridad que se sugiere al atenderlos. */

export interface EstadoMeta {
  label: string;
  /** Colores con contraste AA sobre fondo claro. */
  badge: string;
  /** Qué significa para quien reportó. */
  detalle: string;
}

export const ESTADO_META: Record<EstadoAviso, EstadoMeta> = {
  pendiente: { label: 'Pendiente', badge: 'bg-amber-100 text-amber-900', detalle: 'Esperando la decisión del supervisor.' },
  con_ot: { label: 'Con OT', badge: 'bg-green-100 text-green-900', detalle: 'El supervisor generó una orden de trabajo.' },
  descartado: { label: 'Descartado', badge: 'bg-gray-200 text-gray-800', detalle: 'El supervisor decidió que no requiere una OT.' },
};

export const GRAVEDAD_META: Record<WorkOrderSeverity, { label: string; badge: string }> = {
  low: { label: 'Baja', badge: 'bg-gray-100 text-gray-800' },
  medium: { label: 'Media', badge: 'bg-amber-100 text-amber-900' },
  high: { label: 'Alta', badge: 'bg-orange-100 text-orange-900' },
  critical: { label: 'Crítica', badge: 'bg-red-100 text-red-900' },
};

export const GRAVEDADES: { value: WorkOrderSeverity; label: string }[] = [
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
  { value: 'critical', label: 'Crítica' },
];

export const PRIORIDADES: { value: WorkOrderPriority; label: string }[] = [
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

/** Prioridad con la que se propone la OT según la gravedad que percibió quien reportó (el supervisor la ajusta). */
export function prioridadSugerida(gravedad: WorkOrderSeverity | null): WorkOrderPriority {
  switch (gravedad) {
    case 'critical':
      return 'urgent';
    case 'high':
      return 'high';
    case 'low':
      return 'low';
    default:
      return 'medium';
  }
}

export const estadoMeta = (e: EstadoAviso): EstadoMeta => ESTADO_META[e] ?? ESTADO_META.pendiente;
export const gravedadMeta = (g: WorkOrderSeverity | null) => GRAVEDAD_META[g ?? 'medium'] ?? GRAVEDAD_META.medium;
