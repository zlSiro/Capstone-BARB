/**
 * Modelos del módulo «Reportes» (HU-26).
 *
 * Todo lo que un reporte muestra o exporta pasa por estos tipos: las funciones de cada reporte son puras (reciben datos ya
 * entregados por el backend y devuelven una `VistaReporte`), y un único componente la dibuja, la exporta y la imprime.
 */

export type ReporteId = 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r8' | 'r9' | 'r10';

export type GrupoReporte = 'desempeno' | 'operacion' | 'confiabilidad';

/** Granularidades que acepta `GET /api/stats/historical`. */
export type GranularidadReporte = 'day' | 'week' | 'month' | 'semester' | 'year' | '5year';

/** Tramos de antigüedad de las OT abiertas (R3): en días desde `created_at`. */
export type TramoAntiguedad = '0-2' | '3-7' | '8-30' | '30+';

export type CampoFaltante = 'downtime' | 'costo_real' | 'tecnico';

/**
 * Filtros de un reporte. `null` / lista vacía = sin restricción.
 *
 * `dias` es el periodo (`null` = histórico). Los tres de topología viajan al backend cuando el endpoint los acepta; si no,
 * se aplican en el cliente con el conjunto de `machine_id` del catálogo.
 */
export interface FiltrosReporte {
  dias: number | null;
  planta: number | null;
  disciplina: number | null;
  maquina: number | null;
  granularidad: GranularidadReporte | null;
  estados: string[];
  prioridad: string | null;
  tipo: string | null;
  tecnico: number | null;
  tramo: TramoAntiguedad | null;
  soloDemoradas: boolean;
  severidad: string | null;
  perfil: string | null;
  estadoOt: string | null;
  soloDesviacion: boolean;
  campoFaltante: CampoFaltante | null;
  numeroOt: string;
  /** Columnas elegidas para la tabla y el CSV (vacío = las de por defecto). */
  cols: string[];
}

export const FILTROS_VACIOS: FiltrosReporte = {
  dias: null,
  planta: null,
  disciplina: null,
  maquina: null,
  granularidad: null,
  estados: [],
  prioridad: null,
  tipo: null,
  tecnico: null,
  tramo: null,
  soloDemoradas: false,
  severidad: null,
  perfil: null,
  estadoOt: null,
  soloDesviacion: false,
  campoFaltante: null,
  numeroOt: '',
  cols: [],
};

/** Valor crudo de una celda de la tabla; el formato (idioma, moneda) se aplica al mostrar o exportar. */
export type Celda = string | number | null;

export type TipoColumna = 'texto' | 'numero' | 'entero' | 'fecha' | 'moneda' | 'minutos' | 'porcentaje' | 'enum';

export interface ColumnaDef {
  id: string;
  /** Clave i18n del encabezado (`reportes.col_…`). */
  clave: string;
  tipo: TipoColumna;
  /** Solo existe para quien tiene `ver_kpis_financieros`: no aparece en el selector ni en el CSV de los demás. */
  soloFinanzas?: boolean;
  porDefecto?: boolean;
  /** Solo para `tipo: 'enum'`: prefijo de la clave i18n del valor (`reportes.v_<prefijo>_<valor>`). */
  enumPrefijo?: string;
}

export type FilaReporte = Record<string, Celda>;

export interface Tarjeta {
  id: string;
  etiqueta: string;
  valor: string;
  detalle?: string;
  /** Aviso corto bajo la tarjeta (p. ej. «No cambia con: estado»). */
  aviso?: string;
}

export interface ItemBarra {
  etiqueta: string;
  valor: number;
  texto: string;
}

export interface GraficoBarras {
  id: string;
  titulo: string;
  items: ItemBarra[];
  nota?: string;
}

export interface SerieLinea {
  nombre: string;
  valores: (number | null)[];
  unidad: string;
}

export interface GraficoLinea {
  id: string;
  titulo: string;
  etiquetas: string[];
  series: SerieLinea[];
}

/** Un control de cuadratura: ✓ si la cifra del reporte coincide con la otra fuente. */
export interface Control {
  id: string;
  ok: boolean;
  /** Texto ya traducido: qué se compara y con qué resultado. */
  detalle: string;
}

export interface FichaCalculo {
  id: string;
  indicador: string;
  formula: string;
  unidad: string;
  ventana: string;
  advertencia?: string;
}

/** Lo que el componente genérico dibuja, exporta e imprime. */
export interface VistaReporte {
  id: ReporteId;
  tarjetas: Tarjeta[];
  barras: GraficoBarras[];
  lineas: GraficoLinea[];
  columnas: ColumnaDef[];
  filas: FilaReporte[];
  /** Filas antes de los filtros del cliente («Mostrando X de Y»). */
  totalSinFiltrar: number;
  controles: Control[];
  avisos: string[];
  resumen: string;
  ficha: FichaCalculo[];
  /** Filtros que cambian la tabla pero NO las tarjetas que vienen del backend (se rotula «No cambia con: …»). */
  noCambiaCon: string[];
  /** Solo para R4: máquinas cuyo detalle se puede abrir. */
  detalleMaquinas?: DetalleMaquina[];
}

export interface DetalleMaquina {
  id: number;
  nombre: string;
  /** OT que explican el valor del MTTR (completadas en el periodo con tiempo registrado). */
  filasMttr: FilaReporte[];
  /** Correctivas no canceladas de los últimos 365 días que explican el MTBF. */
  filasMtbf: FilaReporte[];
}
