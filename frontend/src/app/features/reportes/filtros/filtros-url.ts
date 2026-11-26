import {
  CampoFaltante,
  Discipline,
  FILTROS_VACIOS,
  FiltrosReporte,
  GranularidadReporte,
  Machine,
  Plant,
  ReporteId,
  Technician,
  TramoAntiguedad,
} from '../../../core/models';
import { reportePorId } from '../reportes-catalogo';

/**
 * Filtros de los reportes: valores permitidos, qué filtros usa cada reporte, y ida y vuelta con la URL.
 *
 * Todo es puro (sin Angular): el componente de filtros y la página solo llaman a estas funciones. Los parámetros de la URL
 * que no sean válidos, que no existan en la empresa o que contradigan la cascada se descartan y se informan.
 */

export const PERIODOS: readonly (number | null)[] = [7, 30, 90, 365, null];
export const DIAS_POR_DEFECTO = 30;

export const ESTADOS_OT_ABIERTOS = ['pending', 'assigned', 'overdue', 'in_progress', 'por_validar'] as const;
export const ESTADOS_OT = [...ESTADOS_OT_ABIERTOS, 'completed', 'cancelled'] as const;
export const ESTADOS_AVISO = ['pendiente', 'con_ot', 'descartado'] as const;
export const TIPOS = ['corrective', 'preventive', 'predictive', 'inspection'] as const;
export const PRIORIDADES = ['low', 'medium', 'high', 'urgent'] as const;
export const SEVERIDADES = ['low', 'medium', 'high', 'critical'] as const;
export const GRANULARIDADES: readonly GranularidadReporte[] = ['day', 'week', 'month', 'semester', 'year', '5year'];
export const TRAMOS: readonly TramoAntiguedad[] = ['0-2', '3-7', '8-30', '30+'];
export const CAMPOS_FALTANTES: readonly CampoFaltante[] = ['downtime', 'costo_real', 'tecnico'];

export type ClaveFiltro = keyof FiltrosReporte;

/** Filtros que cada reporte ofrece (los demás no aparecen ni se leen de la URL). */
export const FILTROS_POR_REPORTE: Record<ReporteId, readonly ClaveFiltro[]> = {
  r1: ['dias', 'planta', 'disciplina', 'maquina', 'granularidad'],
  r2: ['dias', 'planta', 'disciplina', 'maquina', 'granularidad'],
  r3: ['planta', 'disciplina', 'maquina', 'estados', 'prioridad', 'tipo', 'tecnico', 'tramo', 'soloDemoradas'],
  r4: ['dias', 'planta', 'disciplina', 'maquina'],
  r5: ['dias', 'planta', 'disciplina', 'maquina'],
  r6: ['dias', 'planta', 'disciplina', 'maquina', 'tipo', 'estados', 'soloDesviacion'],
  r7: ['dias', 'planta', 'disciplina', 'maquina', 'estados', 'severidad', 'perfil'],
  r8: ['dias', 'estados', 'estadoOt'],
  r9: ['numeroOt'],
  r10: ['dias', 'planta', 'disciplina', 'maquina', 'tipo', 'campoFaltante'],
};

/** Lo único que el backend entiende en los KPIs (`financial-impact` / `historical`): periodo y topología. */
export const CLAVES_BACKEND: readonly ClaveFiltro[] = ['dias', 'planta', 'disciplina', 'maquina'];

/** Estados válidos del filtro `estados` según el reporte. */
export function estadosPermitidos(id: ReporteId): readonly string[] {
  if (id === 'r3') return ESTADOS_OT_ABIERTOS;
  if (id === 'r7' || id === 'r8') return ESTADOS_AVISO;
  return ESTADOS_OT; // r6
}

export interface Catalogos {
  plantas: Plant[];
  disciplinas: Discipline[];
  maquinas: Machine[];
  tecnicos: Technician[];
}

export const CATALOGOS_VACIOS: Catalogos = { plantas: [], disciplinas: [], maquinas: [], tecnicos: [] };

/** Filtros por defecto de un reporte: periodo de 30 días si su dato depende del periodo, y nada más. */
export function filtrosPorDefecto(id: ReporteId): FiltrosReporte {
  const def = reportePorId(id);
  const dias = def?.usaPeriodo ? DIAS_POR_DEFECTO : null;
  return { ...FILTROS_VACIOS, dias, estados: [], cols: [] };
}

/** Granularidad con que se pide el histórico cuando el usuario no elige una: un punto razonable por periodo. */
export function granularidadPorDefecto(dias: number | null): GranularidadReporte {
  if (dias === null) return 'month';
  if (dias <= 31) return 'day';
  if (dias <= 120) return 'week';
  return 'month';
}

// ----------------------------------------------------------------------------------------------- cascada

/** Máquinas que cumplen planta y disciplina (la cascada: al elegir planta o disciplina, la máquina se acota). */
export function maquinasVisibles(cat: Catalogos, f: Pick<FiltrosReporte, 'planta' | 'disciplina'>): Machine[] {
  return cat.maquinas.filter(
    (m) => (f.planta === null || m.plant_id === f.planta) && (f.disciplina === null || m.discipline_id === f.disciplina),
  );
}

/**
 * Conjunto de `machine_id` que cumplen la topología elegida, o `null` si no hay ninguna restricción.
 *
 * Es el mismo criterio que usa el backend (`maquina.planta_id` / `maquina.disciplina_id`): nunca se filtra por el nombre ni por
 * el `plant_id` de la OT (que el payload rellena con 1 cuando falta).
 */
export function idsMaquina(cat: Catalogos, f: Pick<FiltrosReporte, 'planta' | 'disciplina' | 'maquina'>): Set<number> | null {
  if (f.planta === null && f.disciplina === null && f.maquina === null) return null;
  const ids = new Set(maquinasVisibles(cat, f).map((m) => m.id));
  if (f.maquina !== null) return new Set([...ids].filter((id) => id === f.maquina));
  return ids;
}

/** Quita de la cascada lo que ya no corresponde (p. ej. la máquina que no es de la planta elegida). */
export function limpiarCascada(f: FiltrosReporte, cat: Catalogos): { filtros: FiltrosReporte; limpiados: ClaveFiltro[] } {
  const limpiados: ClaveFiltro[] = [];
  let filtros = f;
  if (f.maquina !== null) {
    const m = cat.maquinas.find((x) => x.id === f.maquina);
    const coherente = m && (f.planta === null || m.plant_id === f.planta) && (f.disciplina === null || m.discipline_id === f.disciplina);
    if (!coherente) {
      filtros = { ...filtros, maquina: null };
      limpiados.push('maquina');
    }
  }
  return { filtros, limpiados };
}

// -------------------------------------------------------------------------------------------- activo / chips

/** ¿El filtro tiene un valor distinto del de por defecto? */
export function estaActivo(clave: ClaveFiltro, f: FiltrosReporte, id: ReporteId): boolean {
  const base = filtrosPorDefecto(id);
  const a = f[clave];
  const b = base[clave];
  if (Array.isArray(a)) return a.length > 0;
  return a !== b && !(a === '' && b === '');
}

/** Filtros activos del reporte (los que se muestran como chips). `cols` no es un filtro de filas. */
export function filtrosActivos(f: FiltrosReporte, id: ReporteId): ClaveFiltro[] {
  return FILTROS_POR_REPORTE[id].filter((c) => estaActivo(c, f, id));
}

/**
 * Filtros activos que solo existen en el cliente. Las tarjetas que vienen del backend NO cambian con ellos, y se rotulan
 * «No cambia con: …» en vez de mezclarse con conteos filtrados de otra forma.
 */
export function filtrosSoloCliente(f: FiltrosReporte, id: ReporteId): ClaveFiltro[] {
  // La granularidad solo cambia el agrupado del histórico (se la pasa al backend); no es un filtro de filas.
  return filtrosActivos(f, id).filter((c) => !CLAVES_BACKEND.includes(c) && c !== 'granularidad');
}

// ---------------------------------------------------------------------------------------------------- URL

export type MotivoDescarte = 'invalido' | 'ajeno' | 'cascada';
export interface Descarte {
  param: string;
  motivo: MotivoDescarte;
}

export type QueryReporte = Record<string, string | null | undefined>;

const entero = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

const lista = (v: string | null | undefined): string[] => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

/** Convierte los filtros en parámetros de URL (solo los que difieren del valor por defecto). */
export function aQuery(id: ReporteId, f: FiltrosReporte): Record<string, string> {
  const q: Record<string, string> = {};
  const usa = new Set(FILTROS_POR_REPORTE[id]);
  const base = filtrosPorDefecto(id);
  if (usa.has('dias') && f.dias !== base.dias) q['dias'] = f.dias === null ? 'hist' : String(f.dias);
  if (usa.has('planta') && f.planta !== null) q['planta'] = String(f.planta);
  if (usa.has('disciplina') && f.disciplina !== null) q['disciplina'] = String(f.disciplina);
  if (usa.has('maquina') && f.maquina !== null) q['maquina'] = String(f.maquina);
  if (usa.has('granularidad') && f.granularidad !== null) q['gran'] = f.granularidad;
  if (usa.has('estados') && f.estados.length) q['estado'] = f.estados.join(',');
  if (usa.has('prioridad') && f.prioridad) q['prioridad'] = f.prioridad;
  if (usa.has('tipo') && f.tipo) q['tipo'] = f.tipo;
  if (usa.has('tecnico') && f.tecnico !== null) q['tecnico'] = String(f.tecnico);
  if (usa.has('tramo') && f.tramo) q['tramo'] = f.tramo;
  if (usa.has('soloDemoradas') && f.soloDemoradas) q['demoradas'] = '1';
  if (usa.has('severidad') && f.severidad) q['severidad'] = f.severidad;
  if (usa.has('perfil') && f.perfil) q['perfil'] = f.perfil;
  if (usa.has('estadoOt') && f.estadoOt) q['estadoOt'] = f.estadoOt;
  if (usa.has('soloDesviacion') && f.soloDesviacion) q['desviacion'] = '1';
  if (usa.has('campoFaltante') && f.campoFaltante) q['falta'] = f.campoFaltante;
  if (usa.has('numeroOt') && f.numeroOt) q['ot'] = f.numeroOt;
  if (f.cols.length) q['cols'] = f.cols.join(',');
  return q;
}

/**
 * Lee los filtros de la URL. Lo inválido, lo que no es de la empresa y lo que contradice la cascada se descarta y se
 * devuelve en `descartes` para avisar al usuario (y corregir la URL).
 */
export function parsearFiltros(
  id: ReporteId,
  query: QueryReporte,
  cat: Catalogos,
  columnasValidas: readonly string[],
): { filtros: FiltrosReporte; descartes: Descarte[] } {
  const usa = new Set(FILTROS_POR_REPORTE[id]);
  const f: FiltrosReporte = { ...filtrosPorDefecto(id) };
  const descartes: Descarte[] = [];
  const malo = (param: string, motivo: MotivoDescarte = 'invalido') => descartes.push({ param, motivo });
  const presente = (p: string) => query[p] !== undefined && query[p] !== null && query[p] !== '';

  if (usa.has('dias') && presente('dias')) {
    const v = query['dias']!;
    if (v === 'hist') f.dias = null;
    else if (PERIODOS.includes(entero(v))) f.dias = entero(v);
    else malo('dias');
  }
  const idDeCatalogo = (param: string, existe: (n: number) => boolean): number | null => {
    if (!presente(param)) return null;
    const n = entero(query[param]);
    if (n === null) {
      malo(param);
      return null;
    }
    if (!existe(n)) {
      malo(param, 'ajeno');
      return null;
    }
    return n;
  };
  if (usa.has('planta')) f.planta = idDeCatalogo('planta', (n) => cat.plantas.some((p) => p.id === n));
  if (usa.has('disciplina')) f.disciplina = idDeCatalogo('disciplina', (n) => cat.disciplinas.some((d) => d.id === n));
  if (usa.has('maquina')) f.maquina = idDeCatalogo('maquina', (n) => cat.maquinas.some((m) => m.id === n));
  if (usa.has('tecnico')) f.tecnico = idDeCatalogo('tecnico', (n) => cat.tecnicos.some((t) => t.id === n));

  const enumerado = <T extends string>(param: string, permitidos: readonly T[]): T | null => {
    if (!presente(param)) return null;
    const v = query[param] as T;
    if (permitidos.includes(v)) return v;
    malo(param);
    return null;
  };
  if (usa.has('granularidad')) f.granularidad = enumerado('gran', GRANULARIDADES);
  if (usa.has('prioridad')) f.prioridad = enumerado('prioridad', PRIORIDADES);
  if (usa.has('tipo')) f.tipo = enumerado('tipo', TIPOS);
  if (usa.has('tramo')) f.tramo = enumerado('tramo', TRAMOS);
  if (usa.has('severidad')) f.severidad = enumerado('severidad', SEVERIDADES);
  if (usa.has('estadoOt')) f.estadoOt = enumerado('estadoOt', ESTADOS_OT);
  if (usa.has('campoFaltante')) f.campoFaltante = enumerado('falta', CAMPOS_FALTANTES);
  if (usa.has('perfil') && presente('perfil')) f.perfil = query['perfil']!.slice(0, 40);
  if (usa.has('soloDemoradas')) f.soloDemoradas = query['demoradas'] === '1';
  if (usa.has('soloDesviacion')) f.soloDesviacion = query['desviacion'] === '1';
  if (usa.has('numeroOt') && presente('ot')) f.numeroOt = query['ot']!.trim().slice(0, 40);
  if (usa.has('estados') && presente('estado')) {
    const permitidos = estadosPermitidos(id);
    const pedidos = lista(query['estado']);
    f.estados = pedidos.filter((e) => permitidos.includes(e));
    if (f.estados.length !== pedidos.length) malo('estado');
  }
  if (presente('cols')) {
    const pedidas = lista(query['cols']);
    f.cols = pedidas.filter((c) => columnasValidas.includes(c));
    if (f.cols.length !== pedidas.length) malo('cols');
  }

  // Cascada: la máquina debe ser coherente con la planta y la disciplina de la misma URL.
  const { filtros, limpiados } = limpiarCascada(f, cat);
  for (const c of limpiados) malo(c === 'maquina' ? 'maquina' : String(c), 'cascada');
  return { filtros, descartes };
}
