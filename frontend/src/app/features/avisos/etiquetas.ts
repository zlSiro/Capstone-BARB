import { EstadoAviso, WorkOrderPriority, WorkOrderSeverity } from '../../core/models';
import { IconName } from '../../shared/components/ui/icon/icon';

/**
 * Presentación de los avisos de falla: estados, gravedad y la prioridad que se sugiere al atenderlos.
 * Ni el estado ni la gravedad dependen del color: cada uno lleva texto y, además, un ícono (estado) o un
 * medidor de barras (gravedad). El color solo refuerza.
 */

export interface EstadoMeta {
  label: string;
  /** Clases del chip (colores con contraste AA en ambos temas). */
  chip: string;
  icono: IconName;
  /** Qué significa para quien reportó. */
  detalle: string;
}

export const ESTADO_META: Record<EstadoAviso, EstadoMeta> = {
  pendiente: { label: 'Pendiente', chip: 'chip chip-media', icono: 'reloj', detalle: 'Esperando la decisión del supervisor.' },
  con_ot: { label: 'Con OT', chip: 'chip chip-ok', icono: 'orden-ok', detalle: 'El supervisor generó una orden de trabajo.' },
  descartado: {
    label: 'Descartado',
    chip: 'chip chip-neutro',
    icono: 'circulo-tachado',
    detalle: 'El supervisor decidió que no requiere una OT.',
  },
};

export interface GravedadMeta {
  label: string;
  /** Cuántas de las 4 barras del medidor van llenas. */
  nivel: 1 | 2 | 3 | 4;
  /** Color de las barras llenas. */
  texto: string;
  /** Color del marco de la tarjeta-etiqueta (variable CSS del tema). */
  marco: string;
}

export const GRAVEDAD_META: Record<WorkOrderSeverity, GravedadMeta> = {
  low: { label: 'Baja', nivel: 1, texto: 'text-neutro', marco: 'var(--neutro)' },
  medium: { label: 'Media', nivel: 2, texto: 'text-media', marco: 'var(--media)' },
  high: { label: 'Alta', nivel: 3, texto: 'text-alerta', marco: 'var(--alerta)' },
  critical: { label: 'Crítica', nivel: 4, texto: 'text-peligro', marco: 'var(--peligro)' },
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
export const gravedadMeta = (g: WorkOrderSeverity | null): GravedadMeta => GRAVEDAD_META[g ?? 'medium'] ?? GRAVEDAD_META.medium;

/** Motivos de descarte frecuentes: se tocan en vez de escribir. */
export const MOTIVOS_DESCARTE = ['Duplicado', 'Falsa alarma', 'Ya tiene una OT', 'No es una falla'];

/** Síntomas frecuentes al reportar una falla: se tocan para empezar el texto sin escribir (con guantes cuesta). */
export const SINTOMAS = ['Ruido anormal', 'Fuga', 'Vibración', 'Se calienta', 'No arranca', 'Se detuvo'];
