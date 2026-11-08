import { WorkOrderStatus } from '../../../core/models';
import { textoActual } from '../../../core/i18n/i18n.service';

/**
 * Presentación de cada estado de OT: etiqueta, colores (AA sobre fondo claro) y qué implica.
 * Los textos salen de `textoActual()` (reactiva al idioma), por eso estas funciones se evalúan en cada llamada.
 */
export interface StatusMeta {
  label: string;
  badge: string;
  dot: string;
  /** Qué ocurre al pasar a este estado (se muestra en el diálogo de confirmación). */
  effect: string;
  /** Estados finales: no admiten más cambios. */
  final: boolean;
}

const STATUS_META: Record<string, () => StatusMeta> = {
  pending: () => ({
    label: textoActual('ot.pendiente'),
    badge: 'bg-media-suave text-media',
    dot: 'bg-media',
    effect: textoActual('ot.la_ot_queda_a'),
    final: false,
  }),
  assigned: () => ({
    label: textoActual('ot.asignada'),
    badge: 'bg-accion-suave text-accion',
    dot: 'bg-accion',
    effect: textoActual('ot.la_ot_queda_asignada'),
    final: false,
  }),
  in_progress: () => ({
    label: textoActual('ot.en_curso'),
    badge: 'bg-accion-suave text-accion',
    dot: 'bg-accion',
    effect: textoActual('ot.se_registrara_la_fecha'),
    final: false,
  }),
  por_validar: () => ({
    label: textoActual('ot.por_validar'),
    badge: 'bg-alerta-suave text-alerta',
    dot: 'bg-alerta',
    effect: textoActual('ot.la_ot_espera_validacion'),
    final: false,
  }),
  completed: () => ({
    label: textoActual('ot.cerrada'),
    badge: 'bg-ok-suave text-ok',
    dot: 'bg-ok',
    effect: textoActual('ot.se_registrara_la_fecha_2'),
    final: true,
  }),
  cancelled: () => ({
    label: textoActual('ot.cancelada'),
    badge: 'bg-borde text-tinta',
    dot: 'bg-neutro',
    effect: textoActual('ot.es_un_estado_final'),
    final: true,
  }),
  overdue: () => ({
    label: textoActual('ot.vencida'),
    badge: 'bg-peligro-suave text-peligro',
    dot: 'bg-peligro',
    effect: textoActual('ot.la_ot_supero_su'),
    final: false,
  }),
};

export function statusMeta(estado: WorkOrderStatus | null | undefined): StatusMeta {
  const meta = estado ? STATUS_META[estado] : undefined;
  return meta ? meta() : { label: textoActual('ot.desconocido'), badge: 'bg-superficie-2 text-tinta', dot: 'bg-neutro', effect: '', final: false };
}

/** Orden en que se muestran los estados en filtros: sigue el ciclo de vida de la OT. */
export const STATUS_FILTER_ORDER: WorkOrderStatus[] = ['pending', 'in_progress', 'por_validar', 'completed', 'cancelled'];

/** Agrupa estados heredados bajo «pendiente» para los filtros y conteos (asignada y vencida aún no inician). */
export function filterGroup(estado: WorkOrderStatus): WorkOrderStatus {
  return estado === 'assigned' || estado === 'overdue' ? 'pending' : estado;
}

const PRIORITY_META: Record<string, { clave: string; badge: string }> = {
  low: { clave: 'ot.baja', badge: 'bg-superficie-2 text-tinta' },
  medium: { clave: 'ot.media', badge: 'bg-accion-suave text-accion' },
  high: { clave: 'ot.alta', badge: 'bg-alerta-suave text-alerta' },
  urgent: { clave: 'ot.urgente', badge: 'bg-peligro-suave text-peligro' },
};

export function priorityMeta(priority: string | null | undefined) {
  const meta = priority ? PRIORITY_META[priority] : undefined;
  return meta ? { label: textoActual(meta.clave), badge: meta.badge } : { label: priority || '—', badge: 'bg-superficie-2 text-tinta' };
}

const TIPO_CLAVE: Record<string, string> = {
  corrective: 'ot.correctivo',
  preventive: 'ot.preventivo',
  predictive: 'ot.predictivo',
  inspection: 'ot.inspeccion',
};

export function tipoLabel(tipo: string | null | undefined): string {
  return (tipo && TIPO_CLAVE[tipo] && textoActual(TIPO_CLAVE[tipo])) || tipo || '—';
}

const ROLE_CLAVE: Record<string, string> = {
  operador: 'ot.operador',
  tecnico: 'ot.tecnico',
  supervisor: 'ot.supervisor',
  engineer: 'ot.ingeniero',
  gerente: 'ot.gerente',
  admin: 'ot.administrador',
  super_usuario: 'ot.super_usuario',
};

export function roleLabel(role: string | null | undefined): string {
  return (role && ROLE_CLAVE[role] && textoActual(ROLE_CLAVE[role])) || role || '';
}
