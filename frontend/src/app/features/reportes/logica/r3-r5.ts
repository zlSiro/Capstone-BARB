import { DetalleMaquina, FilaReporte, FinancialStats, VistaReporte, WorkOrder } from '../../../core/models';
import { control, igual, igualDecimal } from '../cuadratura/cuadratura';
import { TIPOS, TRAMOS, filtrosSoloCliente, idsMaquina } from '../filtros/filtros-url';
import { antiguedadDias, avisoCalidadDowntime, contarPor, creadaEnPeriodo, esAbierta, esDemorada, filaOt, otsDelAlcance, pct, promedio, tramoDe, vistaBase } from './comun';
import { fichas } from './fichas';
import { Contexto } from './tipos';

/**
 * R3 «Backlog y OT atrasadas», R4 «Máquinas con peor confiabilidad» y R5 «Mezcla de mantenimiento».
 * Las cifras de KPI (top 5, tipos, estancadas) son las del backend; aquí solo hay conteos y sumas sobre filas que el backend ya entregó.
 */

// ------------------------------------------------------------------------------------------------------------- R3
export interface EntradaR3 {
  /** Listado de OT del perfil. */
  ots: readonly WorkOrder[];
  /** `financial-impact` SIN `days` y con la misma topología: el backlog es una foto del momento. */
  statsAhora: FinancialStats;
}

export function construirR3(e: EntradaR3, ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const { f } = ctx;
  const umbral = e.statsAhora.estancadas.umbral_dias;
  const ids = idsMaquina(ctx.cat, f);
  // Base: OT abiertas de la topología elegida. Las tarjetas y los controles usan SIEMPRE esta base (no los filtros de cliente).
  const base = e.ots.filter((o) => esAbierta(o.estado) && (ids === null || ids.has(o.machine_id)));
  const demoradasBase = base.filter((o) => esDemorada(o, ctx.ahora, umbral));

  const sinTramo = base.filter(
    (o) =>
      (f.estados.length === 0 || f.estados.includes(o.estado)) &&
      (!f.prioridad || o.priority === f.prioridad) &&
      (!f.tipo || o.tipo === f.tipo) &&
      (f.tecnico === null || o.tecnico_id === f.tecnico) &&
      (!f.soloDemoradas || esDemorada(o, ctx.ahora, umbral)),
  );
  const filtradas = sinTramo.filter((o) => !f.tramo || tramoDe(antiguedadDias(o.created_at, ctx.ahora)) === f.tramo);

  const v = vistaBase('r3', ctx.puedeFinanzas);
  const d = e.statsAhora.salud_operacional.desglose;
  v.tarjetas = [
    { id: 'abiertas', etiqueta: t('reportes.k_abiertas'), valor: numero(base.length, 0) },
    { id: 'demoradas', etiqueta: t('reportes.k_demoradas'), valor: numero(demoradasBase.length, 0), detalle: t('reportes.det_demoradas', { v0: umbral }) },
    {
      id: 'vencidas',
      etiqueta: t('reportes.k_vencidas'),
      valor: numero(e.statsAhora.estancadas.vencidas, 0),
      aviso: t('reportes.aviso_vencidas_total'),
    },
  ];
  const porTramo = contarPor(sinTramo, (o) => tramoDe(antiguedadDias(o.created_at, ctx.ahora)), TRAMOS);
  v.barras = [
    {
      id: 'tramos',
      titulo: t('reportes.graf_tramos'),
      items: TRAMOS.map((tr) => ({ etiqueta: t(`reportes.v_tramo_${tr}`), valor: porTramo[tr] ?? 0, texto: numero(porTramo[tr] ?? 0, 0) })),
    },
  ];
  v.filas = filtradas
    .map((o) => filaOt(o, ctx, umbral))
    .sort((a, b) => Number(b['antiguedad_dias']) - Number(a['antiguedad_dias']));
  v.totalSinFiltrar = base.length;
  v.noCambiaCon = filtrosSoloCliente(f, 'r3');

  const esperadasAbiertas = d ? d.en_curso + d.pendientes + (d.por_validar ?? 0) : -1;
  v.controles = [
    control('abiertas', igual(base.length, esperadasAbiertas), t('reportes.ctl_abiertas', { v0: base.length, v1: esperadasAbiertas })),
    control('demoradas', igual(demoradasBase.length, e.statsAhora.estancadas.demoradas), t('reportes.ctl_demoradas', { v0: demoradasBase.length, v1: e.statsAhora.estancadas.demoradas })),
  ];
  v.ficha = fichas(['backlog', 'estancadas'], ctx.fmt);
  v.resumen = t('reportes.res_r3', { v0: base.length, v1: demoradasBase.length, v2: umbral, v3: e.statsAhora.estancadas.vencidas });
  return v;
}

// ------------------------------------------------------------------------------------------------------------- R4
export interface EntradaR4 {
  stats: FinancialStats;
  ots: readonly WorkOrder[];
}

export function construirR4(e: EntradaR4, ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const { stats } = e;
  const v = vistaBase('r4', ctx.puedeFinanzas);
  const topMttr = stats.top_5_peor_mttr ?? [];
  const topMtbf = stats.top_5_peor_mtbf ?? [];
  const porMaquina = new Map<string, FilaReporte>();
  for (const m of topMttr) porMaquina.set(m.id, { m_maquina: m.name, m_mttr: m.mttr, m_completadas: m.completadas, m_mtbf_hours: null, m_fallas: null });
  for (const m of topMtbf) {
    const previa = porMaquina.get(m.id) ?? { m_maquina: m.name, m_mttr: null, m_completadas: null, m_mtbf_hours: null, m_fallas: null };
    porMaquina.set(m.id, { ...previa, m_mtbf_hours: m.mtbf_hours, m_fallas: m.fallas });
  }
  v.filas = [...porMaquina.values()];
  v.totalSinFiltrar = v.filas.length;

  v.tarjetas = [
    { id: 'n_mttr', etiqueta: t('reportes.k_top_mttr'), valor: numero(topMttr.length, 0) },
    {
      id: 'n_mtbf',
      etiqueta: t('reportes.k_top_mtbf'),
      valor: stats.financials.mtbf_visible ? numero(topMtbf.length, 0) : '—',
      aviso: stats.financials.mtbf_visible ? t('reportes.aviso_mtbf_ventana') : t('reportes.aviso_mtbf_365'),
    },
  ];
  v.barras = [
    { id: 'peor-mttr', titulo: t('reportes.graf_peor_mttr'), items: topMttr.map((m) => ({ etiqueta: m.name, valor: m.mttr, texto: `${numero(m.mttr, 0)} min` })) },
    ...(stats.financials.mtbf_visible
      ? [{ id: 'peor-mtbf', titulo: t('reportes.graf_peor_mtbf'), items: topMtbf.map((m) => ({ etiqueta: m.name, valor: m.mtbf_hours, texto: ctx.fmt.mtbf(m.mtbf_hours) })) }]
      : []),
  ];

  // Detalle por máquina: las OT que explican cada valor, y los controles que lo comprueban.
  const enPeriodo = e.ots.filter((o) => creadaEnPeriodo(o.created_at, ctx.f.dias, ctx.ahora));
  const ventanaMtbf = e.ots.filter((o) => creadaEnPeriodo(o.created_at, 365, ctx.ahora));
  const detalle: DetalleMaquina[] = [];
  const controles = v.controles;
  for (const [id, fila] of porMaquina) {
    const maquinaId = Number(id);
    const completadas = enPeriodo.filter((o) => o.machine_id === maquinaId && o.estado === 'completed');
    const conTiempo = completadas.filter((o) => o.age_minutes > 0);
    const fallas = ventanaMtbf.filter((o) => o.machine_id === maquinaId && o.tipo === 'corrective' && o.estado !== 'cancelled');
    detalle.push({
      id: maquinaId,
      nombre: String(fila['m_maquina']),
      filasMttr: conTiempo.map((o) => filaOt(o, ctx)),
      filasMtbf: fallas.map((o) => filaOt(o, ctx)),
    });

    if (fila['m_completadas'] !== null) {
      const esperadas = Number(fila['m_completadas']);
      const prom = promedio(conTiempo.map((o) => o.age_minutes));
      const exacto = conTiempo.length === esperadas && prom !== null && igualDecimal(prom, Number(fila['m_mttr']));
      // El payload entrega 0 cuando el tiempo es NULL: no distingue «sin dato» de «0 minutos». Si el backend contó más OT que las
      // que traen tiempo > 0, la diferencia se explica por OT con tiempo 0 (y se dice).
      const explicado = !exacto && conTiempo.length <= esperadas && esperadas <= completadas.length;
      controles.push(
        control(
          `mttr-${id}`,
          exacto || explicado,
          exacto
            ? t('reportes.ctl_mttr_ok', { v0: fila['m_maquina'], v1: conTiempo.length })
            : explicado
              ? t('reportes.ctl_mttr_explicado', { v0: fila['m_maquina'], v1: conTiempo.length, v2: esperadas })
              : t('reportes.ctl_mttr_falla', { v0: fila['m_maquina'], v1: conTiempo.length, v2: esperadas }),
        ),
      );
    }
    if (fila['m_fallas'] !== null) {
      const esperadas = Number(fila['m_fallas']);
      controles.push(control(`mtbf-${id}`, igual(fallas.length, esperadas), t('reportes.ctl_fallas', { v0: fila['m_maquina'], v1: fallas.length, v2: esperadas })));
    }
  }
  v.detalleMaquinas = detalle;

  const calidad = avisoCalidadDowntime(otsDelAlcance(e.ots, ctx), ctx);
  if (calidad) v.avisos.push(calidad);
  v.noCambiaCon = filtrosSoloCliente(ctx.f, 'r4');
  v.ficha = fichas(['mttr', 'mtbf', 'calidad'], ctx.fmt);
  v.resumen = t('reportes.res_r4', {
    v0: topMttr[0]?.name ?? '—',
    v1: topMttr[0] ? numero(topMttr[0].mttr, 0) : '—',
    v2: stats.financials.mtbf_visible ? (topMtbf[0]?.name ?? '—') : '—',
  });
  return v;
}

// ------------------------------------------------------------------------------------------------------------- R5
export interface EntradaR5 {
  stats: FinancialStats;
  ots: readonly WorkOrder[];
}

export function construirR5(e: EntradaR5, ctx: Contexto): VistaReporte {
  const { t, numero } = ctx.fmt;
  const v = vistaBase('r5', ctx.puedeFinanzas);
  const porTipo = Object.fromEntries(TIPOS.map((tp) => [tp, e.stats.por_tipo.find((x) => x.tipo === tp)?.total ?? 0]));
  const total = Object.values(porTipo).reduce((a, b) => a + b, 0);
  v.filas = TIPOS.map((tp) => ({ t_tipo: tp, t_total: porTipo[tp] ?? 0, t_porcentaje: pct(porTipo[tp] ?? 0, total) }));
  v.totalSinFiltrar = v.filas.length;
  v.tarjetas = [
    { id: 'total', etiqueta: t('reportes.k_total_ot'), valor: numero(total, 0) },
    ...TIPOS.map((tp) => ({ id: tp, etiqueta: t(`reportes.v_tipo_${tp}`), valor: numero(porTipo[tp] ?? 0, 0), detalle: `${numero(pct(porTipo[tp] ?? 0, total), 1)} %` })),
  ];
  v.barras = [
    {
      id: 'mezcla',
      titulo: t('reportes.graf_mezcla'),
      items: TIPOS.map((tp) => ({ etiqueta: t(`reportes.v_tipo_${tp}`), valor: porTipo[tp] ?? 0, texto: `${numero(porTipo[tp] ?? 0, 0)} (${numero(pct(porTipo[tp] ?? 0, total), 1)} %)` })),
      nota: t('reportes.nota_pmp'),
    },
  ];
  const alcance = otsDelAlcance(e.ots, ctx);
  const desglose = e.stats.salud_operacional.desglose?.total ?? -1;
  const porTipoListado = contarPor(alcance, (o) => o.tipo, TIPOS);
  const difTipos = TIPOS.filter((tp) => (porTipoListado[tp] ?? 0) !== (porTipo[tp] ?? 0));
  v.controles = [
    control('suma', igual(total, desglose), t('reportes.ctl_tipos', { v0: total, v1: desglose })),
    control('listado', igual(alcance.length, total), t('reportes.ctl_listado', { v0: alcance.length, v1: total })),
    control('por-tipo', difTipos.length === 0, difTipos.length === 0 ? t('reportes.ctl_por_tipo_ok') : t('reportes.ctl_por_tipo_falla', { v0: difTipos.join(', ') })),
  ];
  v.noCambiaCon = filtrosSoloCliente(ctx.f, 'r5');
  v.ficha = fichas(['tipo'], ctx.fmt);
  const mayor = TIPOS.reduce((a, b) => ((porTipo[b] ?? 0) > (porTipo[a] ?? 0) ? b : a), TIPOS[0]);
  v.resumen = t('reportes.res_r5', { v0: total, v1: t(`reportes.v_tipo_${mayor}`), v2: numero(pct(porTipo[mayor] ?? 0, total), 1), v3: numero(pct(porTipo['preventive'] ?? 0, total), 1) });
  return v;
}

