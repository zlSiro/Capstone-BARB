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
  /** Inactividad evitada por las OTs completadas, valorizada. */
  ahorro_generado: number;
  /** Tiempo medio de reparacion de las OTs completadas, en minutos. */
  mttr: number;
  /**
   * Porcentaje de OTs completadas dentro del SLA.
   *
   * El campo se llama `efficiency` por compatibilidad con el contrato, pero lo que mide
   * es el Cumplimiento de SLA. Es deuda de nomenclatura documentada en CGBIDA-410.
   */
  efficiency: number;
  /** Suma del costo real, excluyendo las canceladas (CGBIDA-407). */
  costo_total_acumulado: number;
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
  /** Valorizacion de la inactividad evitada de esa maquina. */
  ahorroGenerado: number;
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
   */
  costo_total: number;
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

/** Estados posibles de un componente del semáforo (CGBIDA-438). */
export type EstadoSalud = 'verde' | 'amarillo' | 'rojo' | 'insuficiente';

/** Un componente del Índice de Salud Operacional. */
export interface ComponenteSalud {
  /** Valor medido. `null` cuando no se puede calcular (por ejemplo MTBF sin historial). */
  valor: number | null;
  estado: EstadoSalud;
  /** Puntaje 0-100 con el que entra al índice. `null` si no se pudo medir. */
  score: number | null;
}

/**
 * Índice de Salud Operacional (CGBIDA-438).
 *
 * Combina SLA, MTBF y semanas de backlog. Si falta cualquier componente, `indice` es
 * `null` y el estado es `insuficiente`: el backend no pinta verde lo que no puede medir.
 */
export interface SaludOperacionalData {
  /** 0-100. Es la media de los tres scores. */
  indice: number | null;
  estado: EstadoSalud;
  componentes: {
    sla: ComponenteSalud;
    mtbf: ComponenteSalud;
    backlog: ComponenteSalud;
  };
}

/** Respuesta completa del endpoint. */
export interface FinancialStats {
  financials: Financials;
  impacto_anual: ImpactoAnual;
  trend14Days: TrendData[];
  machines: MachineData[];
  /** Distribucion por tipo de intervencion, para la dona. Ordenada por volumen. */
  por_tipo: PorTipoData[];
  /** Ordenes estancadas, para el banner de alerta. */
  estancadas: EstancadasData;
  /** Semaforo compuesto de salud operacional. */
  salud_operacional: SaludOperacionalData;
}
