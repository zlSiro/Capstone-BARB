import { Aviso, ColumnaDef, FilaReporte, TramoAntiguedad, VistaReporte, WorkOrder } from '../../../core/models';
import { columnasDisponibles } from '../columnas';
import { ESTADOS_OT_ABIERTOS, idsMaquina } from '../filtros/filtros-url';
import { Contexto } from './tipos';

/** Funciones puras compartidas por los reportes: periodo, topología, antigüedad y filas de OT y avisos. */

export const DIA_MS = 86_400_000;
export const HORA_MS = 3_600_000;

export const esAbierta = (estado: string): boolean => (ESTADOS_OT_ABIERTOS as readonly string[]).includes(estado);

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** ¿Se creó dentro de los últimos `dias` días? Sin `dias` (histórico) siempre es cierto. Mismo criterio que `fecha_creacion >= NOW() - days`. */
export function creadaEnPeriodo(creada: string, dias: number | null, ahora: number): boolean {
  if (dias === null) return true;
  const t = ms(creada);
  return t !== null && t >= ahora - dias * DIA_MS;
}

/** OT dentro del periodo y la topología del filtro (periodo sobre `created_at`; topología por `machine_id` del catálogo). */
export function otsDelAlcance(ots: readonly WorkOrder[], ctx: Contexto): WorkOrder[] {
  const ids = idsMaquina(ctx.cat, ctx.f);
  return ots.filter((o) => creadaEnPeriodo(o.created_at, ctx.f.dias, ctx.ahora) && (ids === null || ids.has(o.machine_id)));
}

export function antiguedadDias(creada: string, ahora: number): number {
  const t = ms(creada);
  return t === null ? 0 : Math.max(0, Math.floor((ahora - t) / DIA_MS));
}

export function tramoDe(dias: number): TramoAntiguedad {
  if (dias <= 2) return '0-2';
  if (dias <= 7) return '3-7';
  if (dias <= 30) return '8-30';
  return '30+';
}

/**
 * Demorada = en curso desde hace más de `umbral` días (`COALESCE(fecha_inicio, fecha_creacion) < NOW() - umbral`). Es la misma regla
 * del backend; el umbral viaja en `estancadas.umbral_dias`.
 */
export function esDemorada(o: Pick<WorkOrder, 'estado' | 'fecha_inicio' | 'created_at'>, ahora: number, umbralDias: number): boolean {
  if (o.estado !== 'in_progress') return false;
  const desde = ms(o.fecha_inicio) ?? ms(o.created_at);
  return desde !== null && desde < ahora - umbralDias * DIA_MS;
}

/** Desviación de costo: real − estimado. Ojo: el payload entrega 0 cuando en la BD el costo es NULL (no distingue «sin dato»). */
export const desviacion = (o: Pick<WorkOrder, 'costo_real' | 'costo_estimado'>): number => Math.round((o.costo_real - o.costo_estimado) * 100) / 100;

export const conDesviacion = (o: Pick<WorkOrder, 'costo_real' | 'costo_estimado'>): boolean => o.costo_real !== o.costo_estimado;

/** Fila exportable de una OT. Solo campos visibles; las columnas de costo existen solo para quien ve KPIs financieros. */
export function filaOt(o: WorkOrder, ctx: Contexto, umbralDias = 7): FilaReporte {
  const antig = antiguedadDias(o.created_at, ctx.ahora);
  const fila: FilaReporte = {
    numero_ot: o.numero_ot,
    estado: o.estado,
    tipo: o.tipo,
    prioridad: o.priority,
    severidad: o.severity ?? null,
    maquina: o.machine_name,
    planta: o.plant_name,
    disciplina: o.discipline_name,
    tecnico: o.tecnico_nombre || null,
    creada: o.created_at,
    inicio: o.fecha_inicio ?? null,
    cierre: o.fecha_cierre ?? null,
    antiguedad_dias: antig,
    tramo: tramoDe(antig),
    demorada: esDemorada(o, ctx.ahora, umbralDias) ? 'si' : 'no',
    tiempo_reparacion_min: o.age_minutes > 0 ? o.age_minutes : null,
    downtime_min: o.downtime_minutes ?? null,
    numero_aviso: o.numero_aviso ?? null,
    tiene_downtime: o.downtime_minutes !== null && o.downtime_minutes !== undefined ? 'si' : 'no',
    tiene_costo: o.costo_real > 0 ? 'si' : 'no',
    tiene_tecnico: o.tecnico_id !== null && o.tecnico_id !== undefined ? 'si' : 'no',
  };
  if (ctx.puedeFinanzas) {
    fila['costo_estimado'] = o.costo_estimado;
    fila['costo_real'] = o.costo_real;
    fila['desviacion'] = desviacion(o);
  }
  return fila;
}

/** Fila exportable de un aviso (con la decisión: OT generada o motivo del descarte). */
export function filaAviso(a: Aviso, ctx: Contexto, estadoOt: string | null = null): FilaReporte {
  const creado = ms(a.created_at);
  const resuelto = ms(a.resuelto_en);
  return {
    a_numero_aviso: a.numero_aviso,
    a_estado: a.estado,
    a_severidad: a.severidad,
    a_maquina: a.machine_name,
    a_planta: a.plant_name,
    a_reportado_por: a.reportado_por.nombre,
    a_perfil: a.reportado_por.rol,
    a_creado: a.created_at,
    a_resuelto: a.resuelto_en,
    a_resuelto_por: a.resuelto_por,
    a_motivo_descarte: a.motivo_descarte,
    a_numero_ot: a.numero_ot,
    a_horas_decision: creado !== null && resuelto !== null ? Math.round(((resuelto - creado) / HORA_MS) * 10) / 10 : null,
    a_estado_ot: estadoOt,
  };
}

/** Aviso dentro del periodo (sobre `created_at`, en el cliente) y la topología (por `maquina_id`). */
export function avisosDelAlcance(avisos: readonly Aviso[], ctx: Contexto): Aviso[] {
  const ids = idsMaquina(ctx.cat, ctx.f);
  return avisos.filter((a) => creadaEnPeriodo(a.created_at, ctx.f.dias, ctx.ahora) && (ids === null || ids.has(a.maquina_id)));
}

/** Cuenta por clave, en el orden dado (los valores que no aparecen quedan en 0). */
export function contarPor<T>(items: readonly T[], clave: (x: T) => string, orden: readonly string[]): Record<string, number> {
  const r: Record<string, number> = Object.fromEntries(orden.map((k) => [k, 0]));
  for (const i of items) {
    const k = clave(i);
    r[k] = (r[k] ?? 0) + 1;
  }
  return r;
}

export const pct = (parte: number, total: number): number => (total > 0 ? Math.round((1000 * parte) / total) / 10 : 0);

/** Promedio de una lista (null si está vacía), redondeado a 1 decimal. */
export function promedio(valores: readonly number[]): number | null {
  if (!valores.length) return null;
  return Math.round((10 * valores.reduce((a, b) => a + b, 0)) / valores.length) / 10;
}

/** Vista vacía: el punto de partida de cada reporte. */
export function vistaBase(id: VistaReporte['id'], puedeFinanzas: boolean, columnasId: VistaReporte['id'] = id): VistaReporte {
  const columnas: ColumnaDef[] = columnasDisponibles(columnasId, puedeFinanzas);
  return {
    id,
    tarjetas: [],
    barras: [],
    lineas: [],
    columnas,
    filas: [],
    totalSinFiltrar: 0,
    controles: [],
    avisos: [],
    resumen: '',
    ficha: [],
    noCambiaCon: [],
  };
}

/**
 * Advertencia de calidad de datos: si más de la mitad de las OT cerradas del alcance no tiene downtime registrado, el MTBF y la
 * disponibilidad que dependen de él no son confiables. Devuelve el texto (ya traducido) o `null` si no corresponde.
 */
export function avisoCalidadDowntime(otsAlcance: readonly WorkOrder[], ctx: Contexto): string | null {
  const cerradas = otsAlcance.filter((o) => o.estado === 'completed');
  const sin = cerradas.filter((o) => o.downtime_minutes === null || o.downtime_minutes === undefined).length;
  if (cerradas.length === 0 || sin * 2 <= cerradas.length) return null;
  return ctx.fmt.t('reportes.aviso_calidad_downtime', { v0: sin, v1: cerradas.length });
}
