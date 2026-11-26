import { describe, expect, it } from 'vitest';

import { Transaccion } from '../../../core/models';
import { AHORA, DIA, aviso, ctx, haceDias, ot, stats } from '../fixtures';
import { antiguedadDias, creadaEnPeriodo, esDemorada, filaOt, otsDelAlcance, tramoDe } from './comun';
import { construirR1, construirR2 } from './r1-r2';
import { construirR3, construirR4, construirR5 } from './r3-r5';
import { construirR10, construirR6, construirR7, construirR8, construirR9 } from './r6-r10';

const ctl = (v: { controles: { id: string; ok: boolean }[] }, id: string) => v.controles.find((c) => c.id === id)!;

describe('funciones comunes: bordes de periodo, demora y estados', () => {
  it('una OT justo en el corte del periodo entra; un milisegundo antes, no', () => {
    expect(creadaEnPeriodo(new Date(AHORA - 30 * DIA).toISOString(), 30, AHORA)).toBe(true);
    expect(creadaEnPeriodo(new Date(AHORA - 30 * DIA - 1).toISOString(), 30, AHORA)).toBe(false);
    expect(creadaEnPeriodo('2001-01-01T00:00:00Z', null, AHORA)).toBe(true); // histórico
  });
  it('demorada: en curso desde hace MÁS de 7 días (estricto), con fecha_inicio o, si falta, la de creación', () => {
    const justo = ot({ estado: 'in_progress', fecha_inicio: new Date(AHORA - 7 * DIA).toISOString() });
    const pasado = ot({ estado: 'in_progress', fecha_inicio: new Date(AHORA - 7 * DIA - 1).toISOString() });
    expect(esDemorada(justo, AHORA, 7)).toBe(false);
    expect(esDemorada(pasado, AHORA, 7)).toBe(true);
    expect(esDemorada(ot({ estado: 'in_progress', fecha_inicio: null, created_at: haceDias(10) }), AHORA, 7)).toBe(true);
    expect(esDemorada(ot({ estado: 'pending', created_at: haceDias(40) }), AHORA, 7)).toBe(false);
  });
  it('tramos de antigüedad', () => {
    expect([0, 2, 3, 7, 8, 30, 31].map(tramoDe)).toEqual(['0-2', '0-2', '3-7', '3-7', '8-30', '8-30', '30+']);
    expect(antiguedadDias(haceDias(5, 3), AHORA)).toBe(5);
  });
  it('la topología se aplica por el catálogo de máquinas, no por el nombre ni el plant_id de la OT', () => {
    const ots = [ot({ machine_id: 100, plant_id: 1 }), ot({ machine_id: 102, plant_id: 1 /* el payload cae a 1 cuando falta */ }), ot({ machine_id: 101 })];
    expect(otsDelAlcance(ots, ctx({ planta: 2 })).map((o) => o.machine_id)).toEqual([102]);
    expect(otsDelAlcance(ots, ctx({ planta: 1, disciplina: 10 })).map((o) => o.machine_id)).toEqual([100]);
    expect(otsDelAlcance(ots, ctx({})).length).toBe(3);
  });
  it('filaOt: costos 0, downtime nulo y sin columnas internas ni costos para quien no los ve', () => {
    const o = ot({ costo_real: 0, costo_estimado: 0, downtime_minutes: null, age_minutes: 0, estado: 'completed' });
    const sin = filaOt(o, ctx({}, { puedeFinanzas: false }));
    expect(Object.keys(sin)).not.toContain('costo_real');
    expect(Object.keys(sin)).not.toContain('ot_id');
    expect(Object.keys(sin)).not.toContain('tecnico_id');
    expect(sin['tiene_downtime']).toBe('no');
    expect(sin['tiene_costo']).toBe('no');
    expect(sin['tiempo_reparacion_min']).toBeNull();
    const con = filaOt(ot({ costo_real: 150, costo_estimado: 100 }), ctx({}, { puedeFinanzas: true }));
    expect(con['desviacion']).toBe(50);
  });
  it('los 7 estados y los 4 tipos se conservan tal cual (valor crudo, no el texto humanizado)', () => {
    for (const estado of ['pending', 'assigned', 'in_progress', 'por_validar', 'completed', 'cancelled', 'overdue']) {
      expect(filaOt(ot({ estado, status: 'Texto humanizado' }), ctx())['estado']).toBe(estado);
    }
    for (const tipo of ['corrective', 'preventive', 'predictive', 'inspection']) expect(filaOt(ot({ tipo }), ctx())['tipo']).toBe(tipo);
  });
});

describe('R1 / R2', () => {
  const periodos = [
    { periodo: '2026-10-01', etiqueta: '2026-10', total_ots: 3, completadas: 2, sla: 50, mttr: 100, mtbf_hours: null, fallas: 1, horas_periodo: 744, disponibilidad: 99 },
    { periodo: '2026-11-01', etiqueta: '2026-11', total_ots: 2, completadas: 1, sla: 100, mttr: 60, mtbf_hours: 200, fallas: 2, horas_periodo: 720, disponibilidad: 98 },
  ];
  const desglose = { completadas: 3, en_curso: 1, pendientes: 1, por_validar: 0, canceladas: 0, total: 5 };
  const s = stats({ por_tipo: [{ tipo: 'corrective', total: 4 }, { tipo: 'preventive', total: 1 }], salud_operacional: { ...stats().salud_operacional, desglose } });

  it('R1 cuadra: Σ por_tipo y el listado coinciden con el desglose', () => {
    const ots = Array.from({ length: 5 }, () => ot({ created_at: haceDias(3) }));
    const v = construirR1({ stats: s, historico: { granularity: 'month', periods: periodos }, ots }, ctx({ dias: 30 }));
    expect(ctl(v, 'tipos').ok).toBe(true);
    expect(ctl(v, 'listado').ok).toBe(true);
    expect(v.filas).toHaveLength(2);
  });
  it('R1 detecta un listado que no cuadra (p. ej. el [] silencioso del backend)', () => {
    const v = construirR1({ stats: s, historico: { granularity: 'month', periods: periodos }, ots: [] }, ctx({ dias: 30 }));
    expect(ctl(v, 'listado').ok).toBe(false);
  });
  it('R1: sin MTBF visible se rotula el motivo y con histórico se avisa la ventana de 365 días', () => {
    const v = construirR1({ stats: stats({ financials: { ...stats().financials, mtbf_visible: false, mtbfHours: null } }), historico: { granularity: 'month', periods: [] }, ots: [] }, ctx({ dias: null }));
    expect(v.tarjetas.find((t) => t.id === 'mtbf')!.valor).toBe('—');
    expect(v.tarjetas.find((t) => t.id === 'mtbf')!.aviso).toBe('reportes.aviso_mtbf_365');
    expect(v.tarjetas.find((t) => t.id === 'disponibilidad')!.aviso).toBe('reportes.aviso_disp_historico');
  });
  it('R1: advierte calidad de datos si más de la mitad de las cerradas no tiene downtime; no muestra costo a quien no lo ve', () => {
    const ots = [ot({ estado: 'completed', created_at: haceDias(2) }), ot({ estado: 'completed', created_at: haceDias(2) }), ot({ estado: 'completed', downtime_minutes: 5, created_at: haceDias(2) })];
    const v = construirR1({ stats: stats({ financials: { ...stats().financials, costo_total_acumulado: 999 } }), historico: { granularity: 'month', periods: [] }, ots }, ctx({ dias: 30 }));
    expect(v.avisos.join(' ')).toContain('aviso_calidad_downtime');
    expect(v.tarjetas.find((t) => t.id === 'costo')).toBeUndefined();
  });
  it('R2 cuadra Σ de periodos con el desglose', () => {
    const v = construirR2({ stats: s, historico: { granularity: 'month', periods: periodos } }, ctx({ dias: 90 }));
    expect(ctl(v, 'total').ok).toBe(true);
    expect(ctl(v, 'completadas').ok).toBe(true);
    const mal = construirR2({ stats: s, historico: { granularity: 'month', periods: [periodos[0]] } }, ctx({ dias: 90 }));
    expect(ctl(mal, 'total').ok).toBe(false);
  });
});

describe('R3 backlog', () => {
  const s = stats({
    estancadas: { total: 2, vencidas: 3, demoradas: 1, umbral_dias: 7 },
    salud_operacional: { ...stats().salud_operacional, desglose: { completadas: 9, en_curso: 2, pendientes: 1, por_validar: 1, canceladas: 0, total: 13 } },
  });
  const ots = [
    ot({ estado: 'in_progress', fecha_inicio: haceDias(10), tecnico_id: 7, priority: 'high' }), // demorada
    ot({ estado: 'in_progress', fecha_inicio: haceDias(1), tecnico_id: 8 }),
    ot({ estado: 'pending', created_at: haceDias(40) }),
    ot({ estado: 'por_validar', created_at: haceDias(5) }),
    ot({ estado: 'completed' }),
  ];
  it('cuenta las abiertas y las demoradas, y cuadra contra el backend sin periodo', () => {
    const v = construirR3({ ots, statsAhora: s }, ctx({}));
    expect(v.tarjetas.find((t) => t.id === 'abiertas')!.valor).toBe('4');
    expect(ctl(v, 'abiertas').ok).toBe(true);
    expect(ctl(v, 'demoradas').ok).toBe(true);
    // las vencidas son solo el total del backend, rotulado como tal
    expect(v.tarjetas.find((t) => t.id === 'vencidas')!.valor).toBe('3');
    expect(v.tarjetas.find((t) => t.id === 'vencidas')!.aviso).toBe('reportes.aviso_vencidas_total');
  });
  it('los filtros de cliente cambian la tabla pero no las tarjetas, y se rotulan «no cambia con»', () => {
    const v = construirR3({ ots, statsAhora: s }, ctx({ prioridad: 'high', tecnico: 7 }));
    expect(v.filas).toHaveLength(1);
    expect(v.totalSinFiltrar).toBe(4);
    expect(v.tarjetas.find((t) => t.id === 'abiertas')!.valor).toBe('4');
    expect(v.noCambiaCon.sort()).toEqual(['prioridad', 'tecnico']);
    expect(ctl(v, 'abiertas').ok).toBe(true);
  });
  it('tramo y «solo demoradas» filtran la tabla; la tabla sale de más antigua a más reciente', () => {
    expect(construirR3({ ots, statsAhora: s }, ctx({ soloDemoradas: true })).filas).toHaveLength(1);
    const t30 = construirR3({ ots, statsAhora: s }, ctx({ tramo: '30+' }));
    expect(t30.filas.map((f) => f['estado'])).toEqual(['pending']);
    const todas = construirR3({ ots, statsAhora: s }, ctx({}));
    const ant = todas.filas.map((f) => Number(f['antiguedad_dias']));
    expect(ant).toEqual([...ant].sort((a, b) => b - a));
  });
  it('un filtro sin filas no es un error: tabla vacía', () => {
    expect(construirR3({ ots, statsAhora: s }, ctx({ planta: 2 })).filas).toEqual([]);
  });
  it('si el listado no cuadra con el backend, el control falla', () => {
    const v = construirR3({ ots: ots.slice(0, 2), statsAhora: s }, ctx({}));
    expect(ctl(v, 'abiertas').ok).toBe(false);
  });
});

describe('R4 confiabilidad', () => {
  const s = stats({
    top_5_peor_mttr: [{ id: '100', name: 'Bomba', mttr: 100, completadas: 2 }],
    top_5_peor_mtbf: [{ id: '100', name: 'Bomba', mtbf_hours: 4000, fallas: 2 }],
  });
  const buenas = [
    ot({ estado: 'completed', tipo: 'preventive', age_minutes: 90, created_at: haceDias(10) }),
    ot({ estado: 'completed', tipo: 'preventive', age_minutes: 110, created_at: haceDias(20) }),
    ot({ estado: 'completed', tipo: 'preventive', age_minutes: 0, created_at: haceDias(500) }),
  ];
  it('cuadra el MTTR (completadas y promedio) y las fallas del MTBF', () => {
    const fallas = [ot({ tipo: 'corrective', created_at: haceDias(30) }), ot({ tipo: 'corrective', created_at: haceDias(60) }), ot({ tipo: 'corrective', estado: 'cancelled', created_at: haceDias(5) })];
    const v = construirR4({ stats: s, ots: [...buenas, ...fallas] }, ctx({ dias: null }));
    expect(ctl(v, 'mttr-100').ok).toBe(true);
    expect(ctl(v, 'mtbf-100').ok).toBe(true); // la cancelada no cuenta como falla
    expect(v.detalleMaquinas![0].filasMttr).toHaveLength(2);
  });
  it('si el backend contó OT con tiempo 0, el panel lo explica en vez de marcar error', () => {
    const s2 = stats({ top_5_peor_mttr: [{ id: '100', name: 'Bomba', mttr: 60, completadas: 3 }] });
    const v = construirR4({ stats: s2, ots: buenas }, ctx({ dias: null }));
    expect(ctl(v, 'mttr-100').ok).toBe(true);
    expect(v.controles.find((c) => c.id === 'mttr-100')!.detalle).toContain('ctl_mttr_explicado');
  });
  it('si hay más completadas con tiempo que las del backend, falla', () => {
    const s2 = stats({ top_5_peor_mttr: [{ id: '100', name: 'Bomba', mttr: 100, completadas: 1 }] });
    expect(ctl(construirR4({ stats: s2, ots: buenas }, ctx({ dias: null })), 'mttr-100').ok).toBe(false);
  });
  it('con menos de 365 días no hay MTBF y se rotula el motivo', () => {
    const v = construirR4({ stats: stats({ financials: { ...stats().financials, mtbf_visible: false } }), ots: [] }, ctx({ dias: 30 }));
    expect(v.tarjetas.find((t) => t.id === 'n_mtbf')!.aviso).toBe('reportes.aviso_mtbf_365');
    expect(v.barras.some((b) => b.id === 'peor-mtbf')).toBe(false);
  });
});

describe('R5 mezcla', () => {
  it('siempre muestra los 4 tipos y cuadra con el desglose y con el listado, tipo por tipo', () => {
    const ots = [ot({ tipo: 'corrective' }), ot({ tipo: 'corrective' }), ot({ tipo: 'preventive' })];
    const s = stats({ por_tipo: [{ tipo: 'corrective', total: 2 }, { tipo: 'preventive', total: 1 }], salud_operacional: { ...stats().salud_operacional, desglose: { completadas: 0, en_curso: 0, pendientes: 3, por_validar: 0, canceladas: 0, total: 3 } } });
    const v = construirR5({ stats: s, ots }, ctx({ dias: 30 }));
    expect(v.filas.map((f) => f['t_tipo'])).toEqual(['corrective', 'preventive', 'predictive', 'inspection']);
    expect(v.controles.every((c) => c.ok)).toBe(true);
    const mal = construirR5({ stats: s, ots: [ot({ tipo: 'inspection' }), ot({ tipo: 'corrective' }), ot({ tipo: 'corrective' })] }, ctx({ dias: 30 }));
    expect(ctl(mal, 'por-tipo').ok).toBe(false);
  });
});

describe('R6 costos', () => {
  const s = stats({ financials: { ...stats().financials, costo_total_acumulado: 250 } });
  it('sin ver_kpis_financieros no hay filas ni costos', () => {
    const v = construirR6({ stats: s, ots: [ot({ costo_real: 100 })] }, ctx({}, { puedeFinanzas: false }));
    expect(v.filas).toEqual([]);
    expect(v.tarjetas).toEqual([]);
  });
  it('Σ costo_real (sin canceladas) cuadra con el costo directo del backend; las canceladas no suman', () => {
    const ots = [ot({ costo_real: 100, costo_estimado: 80 }), ot({ costo_real: 150, costo_estimado: 150 }), ot({ costo_real: 999, estado: 'cancelled' })];
    const v = construirR6({ stats: s, ots }, ctx({ dias: null }, { puedeFinanzas: true }));
    expect(ctl(v, 'costo').ok).toBe(true);
    expect(v.filas).toHaveLength(2); // por defecto sin canceladas
    expect(construirR6({ stats: s, ots }, ctx({ dias: null, soloDesviacion: true }, { puedeFinanzas: true })).filas).toHaveLength(1);
    expect(construirR6({ stats: s, ots }, ctx({ dias: null, estados: ['cancelled'] }, { puedeFinanzas: true })).filas).toHaveLength(1);
  });
  it('si la suma no cuadra, el control falla', () => {
    expect(ctl(construirR6({ stats: s, ots: [ot({ costo_real: 10 })] }, ctx({ dias: null }, { puedeFinanzas: true })), 'costo').ok).toBe(false);
  });
});

describe('R7 / R8 avisos', () => {
  const resuelto = (h: number) => new Date(Date.parse(haceDias(2)) + h * 3_600_000).toISOString();
  const avisos = [
    aviso({ estado: 'con_ot', resuelto_en: resuelto(4), numero_ot: 'OT-1', severidad: 'high' }),
    aviso({ estado: 'descartado', resuelto_en: resuelto(2), motivo_descarte: 'falsa alarma', severidad: 'low' }),
    aviso({ estado: 'pendiente', severidad: 'high', reportado_por: { id: 4, nombre: 'Téc', rol: 'tecnico' } }),
  ];
  it('R7: % descartado y horas promedio de decisión salen de las filas filtradas', () => {
    const v = construirR7(avisos, ctx({ dias: 30 }));
    expect(v.tarjetas.find((t) => t.id === 'pct_descartado')!.valor).toBe('33,3 %');
    expect(v.tarjetas.find((t) => t.id === 'horas')!.valor).toBe('3,0 h');
    expect(v.controles.every((c) => c.ok)).toBe(true);
    expect(construirR7(avisos, ctx({ dias: 30, severidad: 'high' })).filas).toHaveLength(2);
    expect(construirR7(avisos, ctx({ dias: 30, perfil: 'tecnico' })).filas).toHaveLength(1);
    expect(construirR7(avisos, ctx({ dias: 30, estados: ['descartado'] })).totalSinFiltrar).toBe(3);
  });
  it('R8: solo lo mío; si llegara algo ajeno, el control falla', () => {
    const mios = [aviso({ reportado_por: { id: 9, nombre: 'Yo', rol: 'operador' }, estado: 'con_ot', numero_ot: 'OT-5' })];
    const ots = [ot({ numero_ot: 'OT-5', estado: 'in_progress' })];
    const ok = construirR8({ avisos: mios, ots }, ctx({ dias: 30 }, { usuarioId: 9 }));
    expect(ctl(ok, 'mios').ok).toBe(true);
    expect(ok.filas[0]['a_estado_ot']).toBe('in_progress');
    expect(construirR8({ avisos: mios, ots }, ctx({ dias: 30, estadoOt: 'completed' }, { usuarioId: 9 })).filas).toEqual([]);
    expect(ctl(construirR8({ avisos: [...mios, ...avisos], ots }, ctx({ dias: 30 }, { usuarioId: 9 })), 'mios').ok).toBe(false);
  });
});

describe('R9 trazabilidad', () => {
  const hist = [
    { id: 3, from_status: 'por_validar', to_status: 'completed', comment: null, user_id: 1, user_name: 'Sup', user_role: 'supervisor', changed_at: '2026-10-05T10:00:00Z' },
    { id: 2, from_status: 'in_progress', to_status: 'por_validar', comment: 'listo', user_id: 2, user_name: 'Téc', user_role: 'tecnico', changed_at: '2026-10-04T10:00:00Z' },
    { id: 1, from_status: 'pending', to_status: 'in_progress', comment: null, user_id: 2, user_name: 'Téc', user_role: 'tecnico', changed_at: '2026-10-03T10:00:00Z' },
  ];
  it('sin búsqueda pide el número; una OT no disponible no revela si existe', () => {
    expect(construirR9({ ot: null, buscada: false, bitacora: null }, ctx()).avisos).toEqual(['reportes.aviso_ingresa_ot']);
    expect(construirR9({ ot: null, buscada: true, bitacora: null }, ctx()).avisos).toEqual(['reportes.aviso_ot_no_disponible']);
  });
  it('ordena el historial cronológicamente y cuadra el último estado con el actual', () => {
    const v = construirR9({ ot: ot({ numero_ot: 'OT-9', estado: 'completed', status_history: hist }), buscada: true, bitacora: null }, ctx());
    expect(v.filas.map((f) => f['h_hasta'])).toEqual(['in_progress', 'por_validar', 'completed']);
    expect(v.controles.every((c) => c.ok)).toBe(true);
    const mal = construirR9({ ot: ot({ estado: 'pending', status_history: hist }), buscada: true, bitacora: null }, ctx());
    expect(ctl(mal, 'ultimo').ok).toBe(false);
  });
  it('el gerente suma los movimientos de la bitácora de esa OT', () => {
    const tx = { transaccion_id: 1, fecha: '2026-10-03T10:00:01Z', usuario_id: 2, usuario_nombre: 'Téc', usuario_email: '', empresa_id: 1, empresa_nombre: null, perfil: 'tecnico', accion: 'UPDATE orden_trabajo', operacion: 'UPDATE', tabla: 'orden_trabajo', registro_id: '1', detalle: { tabla: 'orden_trabajo', operacion: 'UPDATE', registro_id: '1', cambios: { estado: { antes: 'pending', despues: 'in_progress' } } } } as Transaccion;
    const v = construirR9({ ot: ot({ estado: 'completed', status_history: hist }), buscada: true, bitacora: [tx] }, ctx());
    expect(v.filas).toHaveLength(4);
    expect(v.filas.filter((f) => f['h_fuente'] === 'bitacora')).toHaveLength(1);
  });
});

describe('R10 calidad de datos', () => {
  const ots = [
    ot({ estado: 'completed', downtime_minutes: 10, costo_real: 50, tecnico_id: 7 }),
    ot({ estado: 'completed', downtime_minutes: null, costo_real: 0, tecnico_id: 7 }),
    ot({ estado: 'completed', downtime_minutes: 5, costo_real: 20, tecnico_id: null }),
    ot({ estado: 'pending' }),
  ];
  it('porcentajes sobre las cerradas y lista de incompletas según el campo faltante', () => {
    const v = construirR10({ ots, stats: null }, ctx({ dias: null }));
    expect(v.tarjetas.find((t) => t.id === 'cerradas')!.valor).toBe('3');
    expect(v.tarjetas.find((t) => t.id === 'downtime')!.valor).toBe('66,7 %');
    expect(v.filas).toHaveLength(2);
    expect(construirR10({ ots, stats: null }, ctx({ dias: null, campoFaltante: 'tecnico' })).filas).toHaveLength(1);
    expect(construirR10({ ots, stats: null }, ctx({ dias: null, campoFaltante: 'downtime' })).filas).toHaveLength(1);
  });
  it('cuadra las cerradas con el desglose cuando el perfil tiene dashboard', () => {
    const s = stats({ salud_operacional: { ...stats().salud_operacional, desglose: { completadas: 3, en_curso: 0, pendientes: 1, por_validar: 0, canceladas: 0, total: 4 } } });
    expect(ctl(construirR10({ ots, stats: s }, ctx({ dias: null })), 'cerradas').ok).toBe(true);
    const s2 = stats({ salud_operacional: { ...stats().salud_operacional, desglose: { completadas: 5, en_curso: 0, pendientes: 1, por_validar: 0, canceladas: 0, total: 6 } } });
    expect(ctl(construirR10({ ots, stats: s2 }, ctx({ dias: null })), 'cerradas').ok).toBe(false);
  });
  it('sin cerradas no hay división por cero', () => {
    const v = construirR10({ ots: [ot({ estado: 'pending' })], stats: null }, ctx({ dias: null }));
    expect(v.tarjetas.find((t) => t.id === 'downtime')!.valor).toBe('0,0 %');
    expect(v.filas).toEqual([]);
  });
});
