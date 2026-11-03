import { EstadoAviso, WorkOrderPriority, WorkOrderSeverity } from '../../core/models';
import { IconName } from '../../shared/components/ui/icon/icon';
import { textoActual } from '../../core/i18n/i18n.service';

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

// Los textos van con `get`: se calculan al leerlos, así siguen el idioma elegido (la lectura es reactiva).
export const ESTADO_META: Record<EstadoAviso, EstadoMeta> = {
  pendiente: {
    get label() { return textoActual('avisos.pendiente'); },
    chip: 'chip chip-media',
    icono: 'reloj',
    get detalle() { return textoActual('avisos.esperando_la_decision_del'); },
  },
  con_ot: {
    get label() { return textoActual('avisos.con_ot'); },
    chip: 'chip chip-ok',
    icono: 'orden-ok',
    get detalle() { return textoActual('avisos.el_supervisor_genero_una'); },
  },
  descartado: {
    get label() { return textoActual('avisos.descartado'); },
    chip: 'chip chip-neutro',
    icono: 'circulo-tachado',
    get detalle() { return textoActual('avisos.el_supervisor_decidio_que'); },
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
  low: { get label() { return textoActual('avisos.baja'); }, nivel: 1, texto: 'text-neutro', marco: 'var(--neutro)' },
  medium: { get label() { return textoActual('avisos.media'); }, nivel: 2, texto: 'text-media', marco: 'var(--media)' },
  high: { get label() { return textoActual('avisos.alta'); }, nivel: 3, texto: 'text-alerta', marco: 'var(--alerta)' },
  critical: { get label() { return textoActual('avisos.critica'); }, nivel: 4, texto: 'text-peligro', marco: 'var(--peligro)' },
};

export const GRAVEDADES: { value: WorkOrderSeverity; label: string }[] = [
  { value: 'low', get label() { return textoActual('avisos.baja'); } },
  { value: 'medium', get label() { return textoActual('avisos.media'); } },
  { value: 'high', get label() { return textoActual('avisos.alta'); } },
  { value: 'critical', get label() { return textoActual('avisos.critica'); } },
];

export const PRIORIDADES: { value: WorkOrderPriority; label: string }[] = [
  { value: 'low', get label() { return textoActual('avisos.baja'); } },
  { value: 'medium', get label() { return textoActual('avisos.media'); } },
  { value: 'high', get label() { return textoActual('avisos.alta'); } },
  { value: 'urgent', get label() { return textoActual('avisos.urgente'); } },
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
export const motivosDescarte = (): string[] => [textoActual('avisos.duplicado'), textoActual('avisos.falsa_alarma'), textoActual('avisos.ya_tiene_una_ot'), textoActual('avisos.no_es_una_falla')];

/** Síntomas frecuentes al reportar una falla: se tocan para empezar el texto sin escribir (con guantes cuesta). */
export const sintomasFrecuentes = (): string[] => [textoActual('avisos.ruido_anormal'), textoActual('avisos.fuga'), textoActual('avisos.vibracion'), textoActual('avisos.se_calienta'), textoActual('avisos.no_arranca'), textoActual('avisos.se_detuvo')];
