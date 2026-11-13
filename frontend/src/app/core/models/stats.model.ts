/**
 * Modelos de la respuesta de `GET /api/stats/financial-impact`.
 *
 * Forma verificada contra la respuesta real del backend (CGBIDA-392). Antes de esta
 * correccion el modelo descartaba campos que el backend YA enviaba:
 *   - `impacto_anual` completo (el 6.o KPI del dashboard).
 *   - `financials.mtbf_visible`, necesario para el aviso de "historial insuficiente".
 *   - `ahorroGenerado`, `mttr` y `slaCompliance` de cada maquina.
 *
 * Un campo que no esta declarado no se puede consumir: los datos viajaban y se perdian.
 */

/** Los 5 indicadores del bloque `financials`. */
export interface Financials {
  /** Inactividad evitada por las OTs completadas, valorizada. Solo la recibe el gerente. */
  ahorro_generado?: number;
  /**
   * Disponibilidad de planta en % (CGBIDA-519): `(horas - downtime) / horas * 100`.
   *
   * Es la métrica que reemplaza al ahorro en la tarjeta del dashboard porque no depende
   * de una tarifa supuesta: no puede dar cero por falta de costo configurado.
   */
  disponibilidad_planta: number;
  /** Tiempo medio de reparacion de las OTs completadas, en minutos. */
  mttr: number;
  /**
   * Porcentaje de OTs completadas dentro del SLA.
   *
   * El campo se llama `efficiency` por compatibilidad con el contrato, pero lo que mide
   * es el Cumplimiento de SLA. Es deuda de nomenclatura documentada en CGBIDA-410.
   */
  efficiency: number;
  /** Suma del costo real, excluyendo las canceladas (CGBIDA-407). Solo la recibe el gerente. */
  costo_total_acumulado?: number;
  /** `null` cuando el rango pedido no alcanza el anio o hay menos de 2 fallas. */
  mtbfHours: number | null;
  /** Indica si el rango pedido justifica calcular un MTBF anual (CGBIDA-392). */
  mtbf_visible: boolean;
}

/** Un punto de la tendencia de 14 dias. */
export interface TrendData {
  /** Fecha ISO (YYYY-MM-DD). */
  date: string;
  /** OTs creadas ese dia. */
  abiertas: number;
  /** OTs cerradas ese dia. */
  cerradas: number;
}

/** Una maquina del ranking Top 5, ordenado por volumen de OTs. */
export interface MachineData {
  /** El backend lo serializa con `str(...)`, asi que llega como texto. */
  id: string;
  name: string;
  /** Volumen de OTs de la maquina, en el rango consultado. */
  total: number;
  /** Valorizacion de la inactividad evitada de esa maquina. Solo la recibe el gerente. */
  ahorroGenerado?: number;
  /** Tiempo medio de reparacion de esa maquina, en minutos. */
  mttr: number;
  /** Porcentaje de sus OTs completadas dentro del SLA. */
  slaCompliance: number;
  /**
   * Costo real acumulado de la maquina en el periodo, sin las OTs canceladas.
   *
   * Es una dimension distinta de `ahorroGenerado`: el ahorro valoriza la inactividad
   * evitada y el costo es lo que efectivamente se gasto en repuestos y servicios. Por eso
   * el ranking por costo no coincide con el ranking por volumen ni con el de ahorro.
   * Solo la recibe el gerente.
   */
  costo_total?: number;
}

/**
 * Supuestos del modelo de negocio que usa el calculo del impacto anual.
 *
 * Se devuelven SIEMPRE, incluso cuando `impacto_visible` es `false`, para que la
 * interfaz pueda explicar el modelo aunque no muestre cifras.
 */
export interface ImpactoSupuestos {
  minutos_sin_barb: number;
  costo_por_minuto: number;
  dias_periodo: number;
}

/** El 6.o KPI: comparativa de escenarios del modelo BARB. */
export interface ImpactoAnual {
  /** `null` cuando el KPI no es visible o no hubo incidentes en el periodo. */
  escenario_sin_barb: number | null;
  escenario_con_barb: number | null;
  /** No se recorta si es negativo: es informacion real (CGBIDA-406). */
  ahorro_proyectado: number | null;
  incidentes_anuales: number | null;
  /** `false` si el rango pedido no llega al umbral de 90 dias. */
  impacto_visible: boolean;
  supuestos: ImpactoSupuestos;
  /** `true` si se proyecto con el supuesto en vez de un tiempo medido. */
  supuestos_incompletos: boolean;
}

/** Un segmento de la dona: tipo de intervencion y su volumen (CGBIDA-395). */
export interface PorTipoData {
  /** Valor del enum `tipo_mantenimiento`: corrective, preventive, predictive, inspection. */
  tipo: string;
  /** Cantidad de ordenes de ese tipo en el periodo y la empresa consultados. */
  total: number;
}

/**
 * Ordenes estancadas para el banner de alerta (CGBIDA-396).
 *
 * `vencidas` y `demoradas` pueden solaparse (una OT vencida que ademas lleva dias en
 * curso cuenta en los dos), asi que su suma puede superar a `total`. El total es la
 * union, no la suma.
 */
export interface EstancadasData {
  /** Ordenes que estan vencidas, demoradas, o ambas. */
  total: number;
  /** Vencidas: `fecha_vencimiento` pasada y estado no final. */
  vencidas: number;
  /** Demoradas: `in_progress` hace mas de `umbral_dias` dias. */
  demoradas: number;
  /**
   * Dias de umbral que usa el backend. Viaja en la respuesta para que el frontend no
   * repita el numero: si manana pasa a configuracion, la UI no hay que tocarla.
   */
  umbral_dias: number;
}

/** Estados posibles del semáforo operacional (CGBIDA-520). */
export type EstadoSalud = 'verde' | 'amarillo' | 'rojo' | 'insuficiente';

/**
 * Semáforo operacional simplificado (CGBIDA-520).
 *
 * El backend lo redujo a dos señales: OTs estancadas/vencidas y cumplimiento de SLA.
 * `motivo` explica POR QUÉ está en ese color, que es lo que vuelve accionable al semáforo.
 */
export interface SaludOperacionalData {
  estado: EstadoSalud;
  /** Frase corta con la causa del estado (ej. "13 OT(s) vencida(s) sin cerrar."). */
  motivo: string;
  /** Cumplimiento de SLA del período, en % (el mismo que el KPI). */
  sla: number;
  /** OTs estancadas: unión de vencidas y demoradas, sin doble conteo. */
  estancadas: number;
  /** Subconjunto vencido: vencimiento pasado y estado no final. */
  vencidas: number;
}

/** Una fila del Top 5 con peor MTTR (CGBIDA-516). */
export interface TopMttrData {
  id: string;
  name: string;
  /** Tiempo medio de reparación, en minutos. */
  mttr: number;
  /** OTs completadas con tiempo medido: la base del promedio. */
  completadas: number;
}

/** Una fila del Top 5 con peor MTBF (CGBIDA-517): menos tiempo entre fallas. */
export interface TopMtbfData {
  id: string;
  name: string;
  /** Horas entre fallas en la ventana de 365 días. Menor = más propensa a fallar. */
  mtbf_hours: number;
  /** Fallas correctivas consideradas (mínimo 2). */
  fallas: number;
}

/** Un período de la serie histórica (CGBIDA-515). */
export interface PeriodoHistorico {
  /** Fecha ISO del inicio del período (YYYY-MM-DD). */
  periodo: string;
  /** Etiqueta corta para el eje X: `2026-03`, `2026-S1` o `2026`. */
  etiqueta: string;
  total_ots: number;
  completadas: number;
  /** Cumplimiento de SLA del período, en %. */
  sla: number;
  /** MTTR del período, en minutos. */
  mttr: number;
  /** MTBF del período en horas; `null` cuando hay menos de 2 fallas. */
  mtbf_hours: number | null;
  fallas: number;
  horas_periodo: number;
  /** Disponibilidad de planta del período, en %. */
  disponibilidad: number;
}

/** Respuesta de `GET /api/stats/historical`. */
export interface HistoricoRespuesta {
  granularity: 'month' | 'semester' | 'year';
  periods: PeriodoHistorico[];
}

/** Respuesta completa del endpoint. */
export interface FinancialStats {
  financials: Financials;
  /** Solo el gerente lo recibe (acción `ver_kpis_financieros`). */
  impacto_anual?: ImpactoAnual;
  /** `false` cuando el backend omitió los campos de costo para este rol; ausente = visibles. */
  financieros_visibles?: boolean;
  trend14Days: TrendData[];
  machines: MachineData[];
  /**
   * El top 5 por costo real, que NO coincide con `machines` (ordenado por volumen).
   *
   * Va como lista aparte para que el ranking pueda ofrecer la métrica «Costo» sin volver a
   * pedir datos. Opcional: si el backend no la manda, el ranking cae a `machines`.
   */
  machines_por_costo?: MachineData[];
  /** Distribucion por tipo de intervencion, para la dona. Ordenada por volumen. */
  por_tipo: PorTipoData[];
  /** Ordenes estancadas, para el banner de alerta. */
  estancadas: EstancadasData;
  /** Semaforo simplificado de salud operacional (CGBIDA-520). */
  salud_operacional: SaludOperacionalData;
  /**
   * Top 5 con PEOR MTTR (más minutos de reparación promedio) — CGBIDA-516.
   * Opcional: si el backend viejo no la manda, la UI simplemente no la pinta.
   */
  top_5_peor_mttr?: TopMttrData[];
  /** Top 5 con peor MTBF (menos tiempo entre fallas) — CGBIDA-517. */
  top_5_peor_mtbf?: TopMtbfData[];
}

// =============================================================================
// Filtros globales del Dashboard (CGBIDA-550)
// =============================================================================

/**
 * Ventana temporal del Dashboard.
 *
 * `'all'` = histórico completo. Los números son días.
 */
export type RangoTemporal = 7 | 30 | 90 | 'all';

/**
 * Filtros globales: todo lo que el panel de control manda junto.
 *
 * Los tres de topología son `null` cuando no acotan nada. `rango` y `moneda` no acotan
 * datos — son presentación — pero viajan en el mismo objeto porque salen de la misma barra
 * de mandos y se emiten de una sola vez (CGBIDA-550).
 */
export interface FiltrosDashboard {
  planta_id: number | null;
  disciplina_id: number | null;
  maquina_id: number | null;
  rango: RangoTemporal;
  moneda: 'CLP' | 'USD';
}

/** Estado inicial y al limpiar: toda la empresa, histórico completo, en pesos. */
export const SIN_FILTROS: FiltrosDashboard = {
  planta_id: null,
  disciplina_id: null,
  maquina_id: null,
  rango: 'all',
  moneda: 'CLP',
};

/** `true` si al menos un filtro de topología está activo. */
export function hayFiltrosTopologia(f: FiltrosDashboard): boolean {
  return f.planta_id !== null || f.disciplina_id !== null || f.maquina_id !== null;
}

/**
 * Cómo se pide el histórico para cada rango.
 *
 * Ojo con la granularidad: la serie se dibuja con un punto por período, así que un rango
 * de 30 días con granularidad mensual caería en un solo punto. Por eso 7 y 30 días van
 * día a día, 90 días por semana y el histórico completo por mes.
 */
export const GRANULARIDAD_POR_RANGO: Record<
  RangoTemporal,
  { granularity: 'day' | 'week' | 'month'; days?: number }
> = {
  7: { granularity: 'day', days: 7 },
  30: { granularity: 'day', days: 30 },
  90: { granularity: 'week', days: 90 },
  all: { granularity: 'month' },
};