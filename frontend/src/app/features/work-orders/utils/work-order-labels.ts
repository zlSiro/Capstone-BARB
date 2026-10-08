import { WorkOrderStatus } from '../../../core/models';

/** Presentación de cada estado de OT: etiqueta en español, colores (AA sobre fondo claro) y qué implica. */
export interface StatusMeta {
  label: string;
  badge: string;
  dot: string;
  /** Qué ocurre al pasar a este estado (se muestra en el diálogo de confirmación). */
  effect: string;
  /** Estados finales: no admiten más cambios. */
  final: boolean;
}

const STATUS_META: Record<string, StatusMeta> = {
  pending: {
    label: 'Pendiente',
    badge: 'bg-amber-100 text-amber-900',
    dot: 'bg-amber-600',
    effect: 'La OT queda a la espera de iniciarse.',
    final: false,
  },
  assigned: {
    label: 'Asignada',
    badge: 'bg-indigo-100 text-indigo-900',
    dot: 'bg-indigo-600',
    effect: 'La OT queda asignada a un técnico.',
    final: false,
  },
  in_progress: {
    label: 'En curso',
    badge: 'bg-blue-100 text-blue-900',
    dot: 'bg-blue-600',
    effect: 'Se registrará la fecha de inicio de los trabajos.',
    final: false,
  },
  completed: {
    label: 'Cerrada',
    badge: 'bg-green-100 text-green-900',
    dot: 'bg-green-600',
    effect: 'Se registrará la fecha de cierre. Es un estado final: la OT no podrá volver a modificarse.',
    final: true,
  },
  cancelled: {
    label: 'Cancelada',
    badge: 'bg-gray-200 text-gray-800',
    dot: 'bg-gray-500',
    effect: 'Es un estado final: la OT no podrá volver a modificarse.',
    final: true,
  },
  overdue: {
    label: 'Vencida',
    badge: 'bg-red-100 text-red-900',
    dot: 'bg-red-600',
    effect: 'La OT superó su fecha de vencimiento.',
    final: false,
  },
};

const FALLBACK: StatusMeta = {
  label: 'Desconocido',
  badge: 'bg-gray-100 text-gray-800',
  dot: 'bg-gray-400',
  effect: '',
  final: false,
};

export function statusMeta(estado: WorkOrderStatus | null | undefined): StatusMeta {
  return (estado && STATUS_META[estado]) || FALLBACK;
}

/** Orden en que se muestran los estados en filtros: sigue el ciclo de vida de la OT. */
export const STATUS_FILTER_ORDER: WorkOrderStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];

/** Agrupa estados heredados bajo «pendiente» para los filtros y conteos (asignada y vencida aún no inician). */
export function filterGroup(estado: WorkOrderStatus): WorkOrderStatus {
  return estado === 'assigned' || estado === 'overdue' ? 'pending' : estado;
}

const PRIORITY_META: Record<string, { label: string; badge: string }> = {
  low: { label: 'Baja', badge: 'bg-gray-100 text-gray-800' },
  medium: { label: 'Media', badge: 'bg-sky-100 text-sky-900' },
  high: { label: 'Alta', badge: 'bg-orange-100 text-orange-900' },
  urgent: { label: 'Urgente', badge: 'bg-red-100 text-red-900' },
};

export function priorityMeta(priority: string | null | undefined) {
  return (priority && PRIORITY_META[priority]) || { label: priority || '—', badge: 'bg-gray-100 text-gray-800' };
}

const TIPO_LABEL: Record<string, string> = {
  corrective: 'Correctivo',
  preventive: 'Preventivo',
  predictive: 'Predictivo',
  inspection: 'Inspección',
};

export function tipoLabel(tipo: string | null | undefined): string {
  return (tipo && TIPO_LABEL[tipo]) || tipo || '—';
}

const ROLE_LABEL: Record<string, string> = {
  operador: 'Operador',
  tecnico: 'Técnico',
  supervisor: 'Supervisor',
  engineer: 'Ingeniero',
  gerente: 'Gerente',
  admin: 'Administrador',
  visitante: 'Visitante',
  super_usuario: 'Super usuario',
};

export function roleLabel(role: string | null | undefined): string {
  return (role && ROLE_LABEL[role]) || role || '';
}
