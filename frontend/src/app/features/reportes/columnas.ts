import { ColumnaDef, ReporteId } from '../../core/models';

/**
 * Columnas de cada reporte. El selector de columnas, la tabla y el CSV usan exactamente estas definiciones.
 *
 * Nunca hay columnas internas (`ot_id`, `empresa_id`, `tecnico_id`, `photos`, `allowed_transitions`, `reporte_id`,
 * `diagnostico_id`): el identificador visible es `numero_ot` o `numero_aviso`. Las columnas de costo llevan
 * `soloFinanzas` y no existen para quien no tiene `ver_kpis_financieros`.
 */
export const COLUMNAS_PROHIBIDAS: readonly string[] = ['ot_id', 'empresa_id', 'tecnico_id', 'photos', 'allowed_transitions', 'reporte_id', 'diagnostico_id'];

const c = (id: string, tipo: ColumnaDef['tipo'], porDefecto = false, extra: Partial<ColumnaDef> = {}): ColumnaDef => ({
  id,
  clave: `reportes.col_${id}`,
  tipo,
  porDefecto,
  ...extra,
});

const COL_OT: Record<string, ColumnaDef> = {
  numero_ot: c('numero_ot', 'texto', true),
  estado: c('estado', 'enum', true, { enumPrefijo: 'estado' }),
  tipo: c('tipo', 'enum', true, { enumPrefijo: 'tipo' }),
  prioridad: c('prioridad', 'enum', false, { enumPrefijo: 'prioridad' }),
  severidad: c('severidad', 'enum', false, { enumPrefijo: 'severidad' }),
  maquina: c('maquina', 'texto', true),
  planta: c('planta', 'texto'),
  disciplina: c('disciplina', 'texto'),
  tecnico: c('tecnico', 'texto'),
  creada: c('creada', 'fecha'),
  inicio: c('inicio', 'fecha'),
  cierre: c('cierre', 'fecha'),
  antiguedad_dias: c('antiguedad_dias', 'entero'),
  tramo: c('tramo', 'texto'),
  demorada: c('demorada', 'enum', false, { enumPrefijo: 'si_no' }),
  tiempo_reparacion_min: c('tiempo_reparacion_min', 'minutos'),
  downtime_min: c('downtime_min', 'minutos'),
  costo_estimado: c('costo_estimado', 'moneda', false, { soloFinanzas: true }),
  costo_real: c('costo_real', 'moneda', false, { soloFinanzas: true }),
  desviacion: c('desviacion', 'moneda', false, { soloFinanzas: true }),
  numero_aviso: c('numero_aviso', 'texto'),
  tiene_downtime: c('tiene_downtime', 'enum', false, { enumPrefijo: 'si_no' }),
  tiene_costo: c('tiene_costo', 'enum', false, { enumPrefijo: 'si_no' }),
  tiene_tecnico: c('tiene_tecnico', 'enum', false, { enumPrefijo: 'si_no' }),
};

const pick = (cols: Record<string, ColumnaDef>, defs: [string, boolean?][]): ColumnaDef[] =>
  defs.map(([id, def]) => ({ ...cols[id], porDefecto: def ?? false }));

const COLUMNAS: Record<ReporteId, ColumnaDef[]> = {
  r1: [
    c('p_etiqueta', 'texto', true), c('p_total_ots', 'entero', true), c('p_completadas', 'entero', true), c('p_sla', 'porcentaje', true),
    c('p_mttr', 'minutos', true), c('p_mtbf_hours', 'numero'), c('p_fallas', 'entero'), c('p_disponibilidad', 'porcentaje', true),
  ],
  r2: [
    c('p_etiqueta', 'texto', true), c('p_total_ots', 'entero', true), c('p_completadas', 'entero', true), c('p_sla', 'porcentaje', true),
    c('p_mttr', 'minutos', true), c('p_mtbf_hours', 'numero'), c('p_fallas', 'entero'), c('p_disponibilidad', 'porcentaje'),
  ],
  r3: pick(COL_OT, [
    ['numero_ot', true], ['estado', true], ['prioridad', true], ['tipo', true], ['maquina', true], ['tecnico', true], ['creada', true],
    ['antiguedad_dias', true], ['demorada', true], ['planta'], ['disciplina'], ['severidad'], ['inicio'], ['tramo'],
  ]),
  r4: [c('m_maquina', 'texto', true), c('m_mttr', 'minutos', true), c('m_completadas', 'entero', true), c('m_mtbf_hours', 'numero', true), c('m_fallas', 'entero', true)],
  r5: [c('t_tipo', 'enum', true, { enumPrefijo: 'tipo' }), c('t_total', 'entero', true), c('t_porcentaje', 'porcentaje', true)],
  r6: pick(COL_OT, [
    ['numero_ot', true], ['tipo', true], ['estado', true], ['maquina', true], ['costo_estimado', true], ['costo_real', true], ['desviacion', true],
    ['planta'], ['disciplina'], ['cierre'],
  ]),
  r7: [
    c('a_numero_aviso', 'texto', true), c('a_estado', 'enum', true, { enumPrefijo: 'aviso' }), c('a_severidad', 'enum', true, { enumPrefijo: 'severidad' }),
    c('a_maquina', 'texto', true), c('a_planta', 'texto'), c('a_reportado_por', 'texto', true), c('a_perfil', 'texto'), c('a_creado', 'fecha', true),
    c('a_resuelto', 'fecha'), c('a_resuelto_por', 'texto'), c('a_motivo_descarte', 'texto'), c('a_numero_ot', 'texto'), c('a_horas_decision', 'numero'),
  ],
  r8: [
    c('a_numero_aviso', 'texto', true), c('a_estado', 'enum', true, { enumPrefijo: 'aviso' }), c('a_severidad', 'enum', true, { enumPrefijo: 'severidad' }),
    c('a_maquina', 'texto', true), c('a_creado', 'fecha', true), c('a_numero_ot', 'texto', true), c('a_estado_ot', 'enum', true, { enumPrefijo: 'estado' }),
    c('a_motivo_descarte', 'texto', true),
  ],
  r9: [c('h_fecha', 'fecha', true), c('h_fuente', 'enum', true, { enumPrefijo: 'fuente' }), c('h_desde', 'enum', true, { enumPrefijo: 'estado' }),
    c('h_hasta', 'enum', true, { enumPrefijo: 'estado' }), c('h_usuario', 'texto', true), c('h_perfil', 'texto', true), c('h_comentario', 'texto', true)],
  r10: pick(COL_OT, [
    ['numero_ot', true], ['tipo', true], ['estado', true], ['maquina', true], ['tecnico', true], ['tiene_downtime', true], ['tiene_costo', true],
    ['tiene_tecnico', true], ['cierre'], ['planta'], ['disciplina'],
  ]),
};

/** Columnas que el perfil puede ver en ese reporte (sin las de costo si no tiene `ver_kpis_financieros`). */
export function columnasDisponibles(id: ReporteId, puedeFinanzas: boolean): ColumnaDef[] {
  return COLUMNAS[id].filter((col) => (puedeFinanzas || !col.soloFinanzas) && !COLUMNAS_PROHIBIDAS.includes(col.id));
}

/** Las columnas elegidas (en el orden del catálogo); si no eligió ninguna, las de por defecto. Solo existen las disponibles. */
export function columnasElegidas(id: ReporteId, cols: readonly string[], puedeFinanzas: boolean): ColumnaDef[] {
  const disponibles = columnasDisponibles(id, puedeFinanzas);
  const elegidas = disponibles.filter((col) => cols.includes(col.id));
  return elegidas.length ? elegidas : disponibles.filter((col) => col.porDefecto);
}
