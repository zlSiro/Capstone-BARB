import { FilaReporte, FinancialStats, HistoricoRespuesta, PeriodoHistorico, VistaReporte, WorkOrder } from '../../../core/models';
import { control, igual } from '../cuadratura/cuadratura';
import { filtrosSoloCliente } from '../filtros/filtros-url';
import { avisoCalidadDowntime, otsDelAlcance, vistaBase } from './comun';
import { fichas } from './fichas';
import { Contexto } from './tipos';

/** R1 «Resumen ejecutivo» y R2 «SLA y MTTR por periodo»: los números salen tal cual de `financial-impact` y `historical`. */

export interface EntradaR1 {
  stats: FinancialStats;
  historico: HistoricoRespuesta;
  ots: readonly WorkOrder[];
}

export interface EntradaR2 {
  stats: FinancialStats;
  historico: HistoricoRespuesta;
}

function filaPeriodo(p: PeriodoHistorico): FilaReporte {
  return {
    p_etiqueta: p.etiqueta,
    p_total_ots: p.total_ots,
    p_completadas: p.completadas,
    p_sla: p.sla,
    p_mttr: p.mttr,
    p_mtbf_hours: p.mtbf_hours,
    p_fallas: p.fallas,
    p_disponibilidad: p.disponibilidad,
  };
}

function lineas(h: HistoricoRespuesta, ctx: Contexto) {
  const { t } = ctx.fmt;
  return [
    {
      id: 'tendencia-sla',
      titulo: t('reportes.graf_sla_disp'),
      etiquetas: h.periods.map((p) => p.etiqueta),
      series: [
        { nombre: t('reportes.k_sla'), valores: h.periods.map((p) => p.sla), unidad: '%' },
        { nombre: t('reportes.k_disponibilidad'), valores: h.periods.map((p) => p.disponibilidad), unidad: '%' },
      ],
    },
  ];
}

export function construirR1(e: EntradaR1, ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const { stats } = e;
  const fin = stats.financials;
  const salud = stats.salud_operacional;
  const d = salud.desglose;
  const v = vistaBase('r1', ctx.puedeFinanzas);

  v.tarjetas = [
    { id: 'sla', etiqueta: t('reportes.k_sla'), valor: `${numero(fin.efficiency, 1)} %` },
    {
      id: 'disponibilidad',
      etiqueta: t('reportes.k_disponibilidad'),
      valor: `${numero(fin.disponibilidad_planta, 1)} %`,
      // Con «histórico» el backend usa una ventana fija de 365 días en el denominador: se rotula tal cual.
      aviso: ctx.f.dias === null ? t('reportes.aviso_disp_historico') : undefined,
    },
    { id: 'mttr', etiqueta: t('reportes.k_mttr'), valor: `${numero(fin.mttr, 0)} min` },
    {
      id: 'mtbf',
      etiqueta: t('reportes.k_mtbf'),
      valor: fin.mtbf_visible && fin.mtbfHours !== null ? ctx.fmt.mtbf(fin.mtbfHours) : '—',
      aviso: !fin.mtbf_visible ? t('reportes.aviso_mtbf_365') : fin.mtbfHours === null ? t('reportes.aviso_mtbf_fallas') : t('reportes.aviso_mtbf_ventana'),
    },
    { id: 'salud', etiqueta: t('reportes.k_salud'), valor: t(`reportes.salud_${salud.estado}`), detalle: salud.motivo },
  ];
  if (d) {
    v.tarjetas.push(
      { id: 'd_completadas', etiqueta: t('reportes.k_completadas'), valor: numero(d.completadas, 0) },
      { id: 'd_en_curso', etiqueta: t('reportes.k_en_curso'), valor: numero(d.en_curso, 0) },
      { id: 'd_pendientes', etiqueta: t('reportes.k_pendientes'), valor: numero(d.pendientes, 0) },
      { id: 'd_por_validar', etiqueta: t('reportes.k_por_validar'), valor: numero(d.por_validar ?? 0, 0) },
      { id: 'd_canceladas', etiqueta: t('reportes.k_canceladas'), valor: numero(d.canceladas ?? 0, 0) },
      { id: 'd_total', etiqueta: t('reportes.k_total_ot'), valor: numero(d.total ?? 0, 0) },
    );
  }
  if (ctx.puedeFinanzas && stats.financieros_visibles !== false && fin.costo_total_acumulado !== undefined) {
    v.tarjetas.push({ id: 'costo', etiqueta: t('reportes.k_costo_directo'), valor: ctx.fmt.moneda(fin.costo_total_acumulado) });
  }

  v.lineas = lineas(e.historico, ctx);
  v.filas = e.historico.periods.map(filaPeriodo);
  v.totalSinFiltrar = v.filas.length;

  const enAlcance = otsDelAlcance(e.ots, ctx);
  const calidad = avisoCalidadDowntime(enAlcance, ctx);
  if (calidad) v.avisos.push(calidad);
  v.noCambiaCon = filtrosSoloCliente(ctx.f, 'r1');

  const sumaTipos = stats.por_tipo.reduce((a, x) => a + x.total, 0);
  const totalDesglose = d?.total ?? -1;
  v.controles = [
    control('tipos', igual(sumaTipos, totalDesglose), t('reportes.ctl_tipos', { v0: sumaTipos, v1: totalDesglose })),
    control('listado', igual(enAlcance.length, totalDesglose), t('reportes.ctl_listado', { v0: enAlcance.length, v1: totalDesglose })),
  ];

  v.ficha = fichas(['sla', 'disponibilidad', 'mttr', 'mtbf', 'salud', 'periodo'], ctx.fmt);
  v.resumen = t('reportes.res_r1', {
    v0: numero(fin.efficiency, 1),
    v1: numero(fin.disponibilidad_planta, 1),
    v2: numero(fin.mttr, 0),
    v3: t(`reportes.salud_${salud.estado}`),
    v4: d?.total ?? 0,
  });
  return v;
}

export function construirR2(e: EntradaR2, ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const d = e.stats.salud_operacional.desglose;
  const v = vistaBase('r2', ctx.puedeFinanzas);
  const periodos = e.historico.periods;
  v.tarjetas = [
    { id: 'sla', etiqueta: t('reportes.k_sla'), valor: `${numero(e.stats.financials.efficiency, 1)} %` },
    { id: 'mttr', etiqueta: t('reportes.k_mttr'), valor: `${numero(e.stats.financials.mttr, 0)} min` },
    { id: 'periodos', etiqueta: t('reportes.k_periodos'), valor: numero(periodos.length, 0) },
  ];
  v.lineas = [
    {
      id: 'tendencia-sla-mttr',
      titulo: t('reportes.graf_sla_mttr'),
      etiquetas: periodos.map((p) => p.etiqueta),
      series: [
        { nombre: t('reportes.k_sla'), valores: periodos.map((p) => p.sla), unidad: '%' },
        { nombre: t('reportes.k_mttr'), valores: periodos.map((p) => p.mttr), unidad: 'min' },
      ],
    },
  ];
  v.filas = periodos.map(filaPeriodo);
  v.totalSinFiltrar = v.filas.length;
  const sumaOts = periodos.reduce((a, p) => a + p.total_ots, 0);
  const sumaCompletadas = periodos.reduce((a, p) => a + p.completadas, 0);
  v.controles = [
    control('total', igual(sumaOts, d?.total ?? -1), t('reportes.ctl_periodos_total', { v0: sumaOts, v1: d?.total ?? -1 })),
    control('completadas', igual(sumaCompletadas, d?.completadas ?? -1), t('reportes.ctl_periodos_completadas', { v0: sumaCompletadas, v1: d?.completadas ?? -1 })),
  ];
  v.noCambiaCon = filtrosSoloCliente(ctx.f, 'r2');
  v.ficha = fichas(['sla', 'mttr', 'periodo'], ctx.fmt);
  v.resumen = t('reportes.res_r2', { v0: periodos.length, v1: numero(e.stats.financials.efficiency, 1), v2: numero(e.stats.financials.mttr, 0) });
  return v;
}
