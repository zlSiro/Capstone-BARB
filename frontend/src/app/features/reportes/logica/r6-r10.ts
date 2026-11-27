import { Aviso, FilaReporte, FinancialStats, Transaccion, VistaReporte, WorkOrder } from '../../../core/models';
import { control, igual, igualMonto, suma } from '../cuadratura/cuadratura';
import { ESTADOS_AVISO, ESTADOS_OT, SEVERIDADES, filtrosSoloCliente } from '../filtros/filtros-url';
import { avisosDelAlcance, conDesviacion, contarPor, creadaEnPeriodo, desviacion, filaAviso, filaOt, HORA_MS, otsDelAlcance, pct, promedio, vistaBase } from './comun';
import { fichas } from './fichas';
import { Contexto } from './tipos';

/** R6 costos, R7 avisos, R8 mi actividad, R9 trazabilidad y R10 calidad de datos. */

// ------------------------------------------------------------------------------------------------------------- R6
export interface EntradaR6 {
  stats: FinancialStats;
  ots: readonly WorkOrder[];
}

export function construirR6(e: EntradaR6, ctx: Contexto): VistaReporte {
  const { t } = ctx.fmt;
  const v = vistaBase('r6', ctx.puedeFinanzas);
  if (!ctx.puedeFinanzas) {
    v.avisos.push(t('reportes.aviso_sin_finanzas'));
    return v;
  }
  const { f } = ctx;
  const alcance = otsDelAlcance(e.ots, ctx);
  // El costo del backend excluye las canceladas; por defecto la tabla también.
  const baseCosto = alcance.filter((o) => o.estado !== 'cancelled');
  const estados = f.estados.length ? f.estados : ESTADOS_OT.filter((x) => x !== 'cancelled');
  const filtradas = alcance.filter((o) => estados.includes(o.estado) && (!f.tipo || o.tipo === f.tipo) && (!f.soloDesviacion || conDesviacion(o)));

  v.filas = filtradas.map((o) => filaOt(o, ctx));
  v.totalSinFiltrar = baseCosto.length;
  const sumaReal = suma(filtradas.map((o) => o.costo_real));
  const sumaEstimado = suma(filtradas.map((o) => o.costo_estimado));
  const costoBackend = e.stats.financials.costo_total_acumulado ?? 0;
  v.tarjetas = [
    { id: 'costo_backend', etiqueta: t('reportes.k_costo_directo'), valor: ctx.fmt.moneda(costoBackend), aviso: t('reportes.aviso_costo_backend') },
    { id: 'real', etiqueta: t('reportes.k_costo_real_filas'), valor: ctx.fmt.moneda(sumaReal) },
    { id: 'estimado', etiqueta: t('reportes.k_costo_estimado_filas'), valor: ctx.fmt.moneda(sumaEstimado) },
    { id: 'desviacion', etiqueta: t('reportes.k_desviacion'), valor: ctx.fmt.moneda(suma(filtradas.map(desviacion))) },
  ];
  v.barras = [
    {
      id: 'top-costo',
      titulo: t('reportes.graf_top_costo'),
      items: (e.stats.machines_por_costo ?? []).map((m) => ({ etiqueta: m.name, valor: m.costo_total ?? 0, texto: ctx.fmt.moneda(m.costo_total ?? 0) })),
    },
  ];
  v.avisos.push(t('reportes.aviso_costo_cero'));
  v.noCambiaCon = filtrosSoloCliente(f, 'r6');
  const sumaBase = suma(baseCosto.map((o) => o.costo_real));
  v.controles = [
    control('costo', igualMonto(sumaBase, costoBackend), t('reportes.ctl_costo', { v0: ctx.fmt.moneda(sumaBase), v1: ctx.fmt.moneda(costoBackend) })),
    control('tabla', igual(v.filas.length, filtradas.length), t('reportes.ctl_tabla', { v0: v.filas.length, v1: filtradas.length })),
  ];
  v.ficha = fichas(['costo'], ctx.fmt);
  v.resumen = t('reportes.res_r6', { v0: ctx.fmt.moneda(costoBackend), v1: ctx.fmt.moneda(sumaReal), v2: ctx.fmt.moneda(suma(filtradas.map(desviacion))), v3: filtradas.length });
  return v;
}

// ------------------------------------------------------------------------------------------------------------- R7
export function construirR7(avisos: readonly Aviso[], ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const { f } = ctx;
  const v = vistaBase('r7', ctx.puedeFinanzas);
  const alcance = avisosDelAlcance(avisos, ctx);
  const filtrados = alcance.filter(
    (a) => (f.estados.length === 0 || f.estados.includes(a.estado)) && (!f.severidad || a.severidad === f.severidad) && (!f.perfil || a.reportado_por.rol === f.perfil),
  );
  v.filas = filtrados.map((a) => filaAviso(a, ctx));
  v.totalSinFiltrar = alcance.length;
  const porEstado = contarPor(filtrados, (a) => a.estado, ESTADOS_AVISO);
  const porSeveridad = contarPor(filtrados, (a) => a.severidad ?? 'sin', [...SEVERIDADES]);
  const decididos = filtrados.filter((a) => a.resuelto_en);
  const horas = promedio(decididos.map((a) => (Date.parse(a.resuelto_en!) - Date.parse(a.created_at)) / HORA_MS));
  const descartados = porEstado['descartado'] ?? 0;
  v.tarjetas = [
    { id: 'total', etiqueta: t('reportes.k_avisos'), valor: numero(filtrados.length, 0) },
    { id: 'pendiente', etiqueta: t('reportes.v_aviso_pendiente'), valor: numero(porEstado['pendiente'] ?? 0, 0) },
    { id: 'con_ot', etiqueta: t('reportes.v_aviso_con_ot'), valor: numero(porEstado['con_ot'] ?? 0, 0) },
    { id: 'descartado', etiqueta: t('reportes.v_aviso_descartado'), valor: numero(descartados, 0) },
    { id: 'pct_descartado', etiqueta: t('reportes.k_pct_descartado'), valor: `${numero(pct(descartados, filtrados.length), 1)} %` },
    { id: 'horas', etiqueta: t('reportes.k_horas_decision'), valor: horas === null ? '—' : `${numero(horas, 1)} h`, detalle: t('reportes.det_horas_decision', { v0: decididos.length }) },
  ];
  v.barras = [
    { id: 'estados', titulo: t('reportes.graf_avisos_estado'), items: ESTADOS_AVISO.map((x) => ({ etiqueta: t(`reportes.v_aviso_${x}`), valor: porEstado[x] ?? 0, texto: numero(porEstado[x] ?? 0, 0) })) },
    { id: 'severidad', titulo: t('reportes.graf_avisos_severidad'), items: SEVERIDADES.map((x) => ({ etiqueta: t(`reportes.v_severidad_${x}`), valor: porSeveridad[x] ?? 0, texto: numero(porSeveridad[x] ?? 0, 0) })) },
  ];
  const sumaEstados = Object.values(porEstado).reduce((a, b) => a + b, 0);
  v.controles = [
    control('estados', igual(sumaEstados, filtrados.length), t('reportes.ctl_estados_aviso', { v0: sumaEstados, v1: filtrados.length })),
    control('tabla', igual(v.filas.length, filtrados.length), t('reportes.ctl_tabla', { v0: v.filas.length, v1: filtrados.length })),
  ];
  v.ficha = fichas(['aviso'], ctx.fmt);
  v.resumen = t('reportes.res_r7', { v0: filtrados.length, v1: numero(pct(descartados, filtrados.length), 1), v2: horas === null ? '—' : numero(horas, 1) });
  return v;
}

// ------------------------------------------------------------------------------------------------------------- R8
export interface EntradaR8 {
  avisos: readonly Aviso[];
  ots: readonly WorkOrder[];
}

export function construirR8(e: EntradaR8, ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const { f } = ctx;
  const v = vistaBase('r8', ctx.puedeFinanzas);
  const estadoOt = new Map(e.ots.map((o) => [o.numero_ot, o.estado]));
  const alcance = e.avisos.filter((a) => creadaEnPeriodo(a.created_at, f.dias, ctx.ahora));
  const filtrados = alcance.filter(
    (a) =>
      (f.estados.length === 0 || f.estados.includes(a.estado)) &&
      (!f.estadoOt || (a.numero_ot !== null && estadoOt.get(a.numero_ot) === f.estadoOt)),
  );
  v.filas = filtrados.map((a) => filaAviso(a, ctx, a.numero_ot ? (estadoOt.get(a.numero_ot) ?? null) : null));
  v.totalSinFiltrar = alcance.length;
  const porEstadoAviso = contarPor(filtrados, (a) => a.estado, ESTADOS_AVISO);
  const otsPeriodo = e.ots.filter((o) => creadaEnPeriodo(o.created_at, f.dias, ctx.ahora));
  const porEstadoOt = contarPor(otsPeriodo, (o) => o.estado, ESTADOS_OT);
  v.tarjetas = [
    { id: 'avisos', etiqueta: t('reportes.k_mis_avisos'), valor: numero(filtrados.length, 0) },
    { id: 'ots', etiqueta: t('reportes.k_mis_ots'), valor: numero(otsPeriodo.length, 0) },
  ];
  v.barras = [
    { id: 'avisos', titulo: t('reportes.graf_mis_avisos'), items: ESTADOS_AVISO.map((x) => ({ etiqueta: t(`reportes.v_aviso_${x}`), valor: porEstadoAviso[x] ?? 0, texto: numero(porEstadoAviso[x] ?? 0, 0) })) },
    { id: 'ots', titulo: t('reportes.graf_mis_ots'), items: ESTADOS_OT.map((x) => ({ etiqueta: t(`reportes.v_estado_${x}`), valor: porEstadoOt[x] ?? 0, texto: numero(porEstadoOt[x] ?? 0, 0) })) },
  ];
  const sumaOt = Object.values(porEstadoOt).reduce((a, b) => a + b, 0);
  const ajenos = e.avisos.filter((a) => ctx.usuarioId != null && a.reportado_por.id !== ctx.usuarioId).length;
  v.controles = [
    control('mios', ajenos === 0, ajenos === 0 ? t('reportes.ctl_mios_ok') : t('reportes.ctl_mios_falla', { v0: ajenos })),
    control('ots', igual(sumaOt, otsPeriodo.length), t('reportes.ctl_estados_ot', { v0: sumaOt, v1: otsPeriodo.length })),
    control('tabla', igual(v.filas.length, filtrados.length), t('reportes.ctl_tabla', { v0: v.filas.length, v1: filtrados.length })),
  ];
  v.ficha = fichas(['aviso'], ctx.fmt);
  v.resumen = t('reportes.res_r8', { v0: filtrados.length, v1: porEstadoAviso['con_ot'] ?? 0, v2: otsPeriodo.length });
  return v;
}

// ------------------------------------------------------------------------------------------------------------- R9
export interface EntradaR9 {
  /** `null` = no se buscó, o el backend respondió 404 (no se revela si existe). */
  ot: WorkOrder | null;
  buscada: boolean;
  /** Solo el gerente: movimientos de la bitácora de esa OT (ya filtrados por tabla y `registro_id`). */
  bitacora: readonly Transaccion[] | null;
}

function cambioEstado(tx: Transaccion): { desde: string | null; hasta: string | null } {
  const c = tx.detalle?.cambios?.['estado'];
  return { desde: c && typeof c.antes === 'string' ? c.antes : null, hasta: c && typeof c.despues === 'string' ? c.despues : null };
}

export function construirR9(e: EntradaR9, ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const v = vistaBase('r9', ctx.puedeFinanzas);
  v.ficha = fichas(['traza'], ctx.fmt);
  if (!e.buscada) {
    v.avisos.push(t('reportes.aviso_ingresa_ot'));
    return v;
  }
  if (!e.ot) {
    // El 404 del backend no distingue «no existe» de «no tienes permiso»: el mensaje tampoco.
    v.avisos.push(t('reportes.aviso_ot_no_disponible'));
    return v;
  }
  const historial = [...(e.ot.status_history ?? [])].reverse(); // el backend lo entrega del más reciente al más antiguo
  const filas: FilaReporte[] = historial.map((h) => ({
    h_fecha: h.changed_at,
    h_fuente: 'historial',
    h_desde: h.from_status ?? null,
    h_hasta: h.to_status,
    h_usuario: h.user_name,
    h_perfil: h.user_role ?? null,
    h_comentario: h.comment ?? null,
  }));
  for (const tx of e.bitacora ?? []) {
    const { desde, hasta } = cambioEstado(tx);
    const campos = Object.keys(tx.detalle?.cambios ?? {});
    filas.push({
      h_fecha: tx.fecha,
      h_fuente: 'bitacora',
      h_desde: desde,
      h_hasta: hasta,
      h_usuario: tx.usuario_nombre,
      h_perfil: tx.perfil,
      h_comentario: `${tx.detalle?.operacion ?? ''} ${tx.detalle?.tabla ?? ''}${campos.length ? `: ${campos.join(', ')}` : ''}`.trim(),
    });
  }
  filas.sort((a, b) => Date.parse(String(a['h_fecha'])) - Date.parse(String(b['h_fecha'])));
  v.filas = filas;
  v.totalSinFiltrar = filas.length;
  v.tarjetas = [
    { id: 'ot', etiqueta: t('reportes.col_numero_ot'), valor: e.ot.numero_ot },
    { id: 'estado', etiqueta: t('reportes.col_estado'), valor: t(`reportes.v_estado_${e.ot.estado}`) },
    { id: 'creada', etiqueta: t('reportes.col_creada'), valor: ctx.fmt.fecha(e.ot.created_at) },
    { id: 'cierre', etiqueta: t('reportes.col_cierre'), valor: ctx.fmt.fecha(e.ot.fecha_cierre) || '—' },
    { id: 'movimientos', etiqueta: t('reportes.k_movimientos'), valor: numero(historial.length, 0) },
  ];
  const ultimo = e.ot.status_history?.[0];
  v.controles = [
    control('historial', historial.length > 0, t('reportes.ctl_historial', { v0: historial.length })),
    control('ultimo', !!ultimo && ultimo.to_status === e.ot.estado, t('reportes.ctl_ultimo_estado', { v0: ultimo?.to_status ?? '—', v1: e.ot.estado })),
  ];
  v.resumen = t('reportes.res_r9', { v0: e.ot.numero_ot, v1: t(`reportes.v_estado_${e.ot.estado}`), v2: historial.length });
  return v;
}

// ------------------------------------------------------------------------------------------------------------ R10
export interface EntradaR10 {
  ots: readonly WorkOrder[];
  /** Solo si el perfil tiene dashboard: permite cuadrar las cerradas contra `desglose.completadas`. */
  stats: FinancialStats | null;
}

export function construirR10(e: EntradaR10, ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const { f } = ctx;
  const v = vistaBase('r10', ctx.puedeFinanzas);
  const alcance = otsDelAlcance(e.ots, ctx);
  const cerradasBase = alcance.filter((o) => o.estado === 'completed');
  const cerradas = cerradasBase.filter((o) => !f.tipo || o.tipo === f.tipo);
  const sinDowntime = (o: WorkOrder) => o.downtime_minutes === null || o.downtime_minutes === undefined;
  const sinCosto = (o: WorkOrder) => !(o.costo_real > 0); // el payload entrega 0 cuando el costo es NULL
  const sinTecnico = (o: WorkOrder) => o.tecnico_id === null || o.tecnico_id === undefined;
  const falta = (o: WorkOrder) => (f.campoFaltante === 'downtime' ? sinDowntime(o) : f.campoFaltante === 'costo_real' ? sinCosto(o) : f.campoFaltante === 'tecnico' ? sinTecnico(o) : sinDowntime(o) || sinCosto(o) || sinTecnico(o));
  const incompletas = cerradas.filter(falta);
  v.filas = incompletas.map((o) => filaOt(o, ctx));
  v.totalSinFiltrar = cerradas.length;
  const n = cerradas.length;
  v.tarjetas = [
    { id: 'cerradas', etiqueta: t('reportes.k_cerradas'), valor: numero(n, 0) },
    { id: 'downtime', etiqueta: t('reportes.k_pct_downtime'), valor: `${numero(pct(n - cerradas.filter(sinDowntime).length, n), 1)} %` },
    { id: 'costo', etiqueta: t('reportes.k_pct_costo'), valor: `${numero(pct(n - cerradas.filter(sinCosto).length, n), 1)} %`, aviso: t('reportes.aviso_costo_cero') },
    { id: 'tecnico', etiqueta: t('reportes.k_pct_tecnico'), valor: `${numero(pct(n - cerradas.filter(sinTecnico).length, n), 1)} %` },
    { id: 'incompletas', etiqueta: t('reportes.k_incompletas'), valor: numero(incompletas.length, 0) },
  ];
  v.noCambiaCon = [];
  const desglose = e.stats?.salud_operacional.desglose;
  v.controles = [
    control('cuenta', igual(cerradas.filter(sinDowntime).length + cerradas.filter((o) => !sinDowntime(o)).length, n), t('reportes.ctl_calidad_suma', { v0: n })),
  ];
  if (desglose) {
    v.controles.push(control('cerradas', igual(cerradasBase.length, desglose.completadas), t('reportes.ctl_cerradas', { v0: cerradasBase.length, v1: desglose.completadas })));
  }
  v.ficha = fichas(['calidad'], ctx.fmt);
  v.resumen = t('reportes.res_r10', { v0: n, v1: numero(pct(n - cerradas.filter(sinDowntime).length, n), 1), v2: incompletas.length });
  return v;
}

