import { describe, expect, it } from 'vitest';

import { translations } from '../../core/i18n/translations';
import { columnasDisponibles } from './columnas';
import { CATALOGOS_VACIOS, ESTADOS_AVISO, ESTADOS_OT, GRANULARIDADES, PRIORIDADES, SEVERIDADES, TIPOS, TRAMOS, FILTROS_POR_REPORTE } from './filtros/filtros-url';
import { AHORA, CAT, aviso, haceDias, ot, stats } from './fixtures';
import { FILTROS_VACIOS, ReporteId } from '../../core/models';
import { Contexto, Formato } from './logica/tipos';
import { construirR1, construirR2 } from './logica/r1-r2';
import { construirR3, construirR4, construirR5 } from './logica/r3-r5';
import { construirR10, construirR6, construirR7, construirR8, construirR9 } from './logica/r6-r10';
import { REPORTES } from './reportes-catalogo';
import { Transaccion } from '../../core/models';

const ES = translations.es.reportes as Record<string, string>;
const EN = translations.en.reportes as Record<string, string>;
const IDS: ReporteId[] = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10'];

/** Un `t` que anota cada clave que los reportes piden: así se comprueba que ninguna falta en español ni en inglés. */
function grabador() {
  const claves = new Set<string>();
  const fmt: Formato = {
    idioma: 'es',
    t: (clave) => {
      claves.add(clave);
      return clave;
    },
    numero: (v, d = 0) => v.toFixed(d),
    moneda: (v) => `$${v}`,
    convertir: (v) => v,
    monedaCodigo: 'CLP',
    mtbf: (h) => `${h} h`,
    fecha: (iso) => iso ?? '',
  };
  const ctx = (f: Partial<typeof FILTROS_VACIOS> = {}, extra: Partial<Contexto> = {}): Contexto => ({ f: { ...FILTROS_VACIOS, ...f }, cat: CAT, fmt, ahora: AHORA, puedeFinanzas: true, usuarioId: 9, ...extra });
  return { claves, ctx };
}

describe('textos de Reportes: ES y EN completos', () => {
  it('toda clave que usan los reportes existe en español e inglés', () => {
    const { claves, ctx } = grabador();
    const s = stats({
      financials: { disponibilidad_planta: 98, mttr: 90, efficiency: 70, mtbfHours: 300, mtbf_visible: true, costo_total_acumulado: 100 },
      financieros_visibles: true,
      por_tipo: [{ tipo: 'corrective', total: 3 }],
      estancadas: { total: 1, vencidas: 1, demoradas: 1, umbral_dias: 7 },
      machines_por_costo: [{ id: '100', name: 'Bomba', total: 1, mttr: 1, slaCompliance: 1, costo_total: 50 }],
      top_5_peor_mttr: [{ id: '100', name: 'Bomba', mttr: 90, completadas: 2 }],
      top_5_peor_mtbf: [{ id: '100', name: 'Bomba', mtbf_hours: 300, fallas: 2 }],
      salud_operacional: { ...stats().salud_operacional, desglose: { completadas: 1, en_curso: 1, pendientes: 1, por_validar: 1, canceladas: 1, total: 5 } },
    });
    const periodos = [{ periodo: '2026-10-01', etiqueta: '2026-10', total_ots: 1, completadas: 1, sla: 1, mttr: 1, mtbf_hours: null, fallas: 0, horas_periodo: 1, disponibilidad: 1 }];
    const ots = [ot({ estado: 'completed', costo_real: 10, created_at: haceDias(2) }), ot({ estado: 'in_progress', fecha_inicio: haceDias(20) })];
    const avisos = [aviso({ estado: 'con_ot', resuelto_en: haceDias(1), numero_ot: ots[0].numero_ot })];
    const tx = { transaccion_id: 1, fecha: haceDias(1), usuario_id: 1, usuario_nombre: 'A', usuario_email: '', empresa_id: 1, empresa_nombre: null, perfil: 'x', accion: 'UPDATE', operacion: 'UPDATE', tabla: 'orden_trabajo', registro_id: '1', detalle: { tabla: 'orden_trabajo', operacion: 'UPDATE', cambios: { estado: { antes: 'a', despues: 'b' } } } } as Transaccion;
    const c = ctx({ dias: 30 });
    construirR1({ stats: s, historico: { granularity: 'month', periods: periodos }, ots }, c);
    construirR1({ stats: stats({ financials: { ...s.financials, mtbf_visible: false, mtbfHours: null } }), historico: { granularity: 'month', periods: [] }, ots: [] }, ctx({ dias: null }));
    construirR2({ stats: s, historico: { granularity: 'month', periods: periodos } }, c);
    construirR3({ ots, statsAhora: s }, ctx({}));
    construirR4({ stats: s, ots }, ctx({ dias: null }));
    construirR5({ stats: s, ots }, c);
    construirR6({ stats: s, ots }, c);
    construirR6({ stats: s, ots }, ctx({ dias: 30 }, { puedeFinanzas: false }));
    construirR7(avisos, c);
    construirR8({ avisos, ots }, c);
    construirR9({ ot: ot({ status_history: [{ id: 1, from_status: null, to_status: 'pending', user_id: 1, user_name: 'A', changed_at: haceDias(1) }] }), buscada: true, bitacora: [tx] }, c);
    construirR9({ ot: null, buscada: false, bitacora: null }, c);
    construirR9({ ot: null, buscada: true, bitacora: null }, c);
    construirR10({ ots, stats: s }, c);

    // valores, columnas, fichas, filtros y títulos
    for (const e of ESTADOS_OT) claves.add(`reportes.v_estado_${e}`);
    for (const e of ESTADOS_AVISO) claves.add(`reportes.v_aviso_${e}`);
    for (const e of TIPOS) claves.add(`reportes.v_tipo_${e}`);
    for (const e of PRIORIDADES) claves.add(`reportes.v_prioridad_${e}`);
    for (const e of SEVERIDADES) claves.add(`reportes.v_severidad_${e}`);
    for (const e of TRAMOS) claves.add(`reportes.v_tramo_${e}`);
    for (const e of GRANULARIDADES) claves.add(`reportes.v_gran_${e}`);
    for (const e of ['si', 'no']) claves.add(`reportes.v_si_no_${e}`);
    for (const e of ['historial', 'bitacora']) claves.add(`reportes.v_fuente_${e}`);
    for (const e of ['operador', 'tecnico', 'supervisor', 'engineer', 'gerente']) claves.add(`reportes.v_rol_${e}`);
    for (const e of ['downtime', 'costo_real', 'tecnico']) claves.add(`reportes.v_falta_${e}`);
    for (const e of ['verde', 'amarillo', 'rojo', 'insuficiente']) claves.add(`reportes.salud_${e}`);
    for (const id of IDS) {
      claves.add(`reportes.${id}_titulo`);
      claves.add(`reportes.${id}_desc`);
      for (const col of columnasDisponibles(id, true)) {
        claves.add(col.clave);
        if (col.tipo === 'enum') expect(col.enumPrefijo, col.id).toBeTruthy();
      }
      for (const f of FILTROS_POR_REPORTE[id]) claves.add(`reportes.fn_${f}`);
    }
    for (const g of ['desempeno', 'operacion', 'confiabilidad']) claves.add(`reportes.grupo_${g}`);

    const faltan = [...claves].filter((k) => !k.startsWith('reportes.') || !(k.slice('reportes.'.length) in ES));
    expect(faltan, `faltan en español: ${faltan.join(', ')}`).toEqual([]);
    const faltanEn = [...claves].filter((k) => !(k.slice('reportes.'.length) in EN));
    expect(faltanEn, `faltan en inglés: ${faltanEn.join(', ')}`).toEqual([]);
  });

  it('ES y EN tienen exactamente las mismas claves y ningún texto vacío', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ES).sort());
    for (const [k, v] of Object.entries(ES)) expect(v.trim(), `ES ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(EN)) expect(v.trim(), `EN ${k}`).not.toBe('');
  });

  it('los parámetros {vN} de cada texto en inglés son los mismos que en español', () => {
    const params = (s: string) => [...s.matchAll(/\{(v\d)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(ES)) expect(params(EN[k]), k).toEqual(params(ES[k]));
  });

  it('las fichas «Cómo se calcula» existen para todos los indicadores', () => {
    for (const id of ['sla', 'mttr', 'mtbf', 'disponibilidad', 'salud', 'estancadas', 'costo', 'tipo', 'aviso', 'calidad', 'backlog', 'periodo', 'traza']) {
      for (const campo of ['indicador', 'formula', 'unidad', 'ventana']) expect(ES[`ficha_${id}_${campo}`], `${id}_${campo}`).toBeTruthy();
    }
    expect(REPORTES.length).toBe(10);
    expect(CATALOGOS_VACIOS.plantas).toEqual([]);
  });
});
