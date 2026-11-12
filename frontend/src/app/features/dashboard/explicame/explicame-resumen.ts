import { EstadoSalud, FinancialStats, SaludOperacionalData } from '../../../core/models';

/** Rango de tiempo elegido en el dashboard (días, o `all` = histórico). */
export type RangoResumen = 7 | 30 | 90 | 'all';

export interface ResumenEntrada {
  /** La respuesta que el dashboard ya tiene (la misma que alimenta las tarjetas). */
  stats: FinancialStats;
  rango: RangoResumen;
  idioma: 'es' | 'en';
  /** Traductor de claves (`ayuda.exp_…`) con parámetros `{v0}`, `{v1}`…. */
  t: (clave: string, params?: Record<string, string | number>) => string;
  /** Formatea un monto con la moneda activa (el mismo formateo que usan las tarjetas). */
  moneda: (valorClp: number) => string;
  /** Formatea horas de MTBF con la unidad que eligió el usuario. */
  mtbf: (horas: number) => string;
  /** Formatea un número con los separadores del idioma activo (coma decimal en ES, punto en EN). */
  numero: (valor: number, decimales: number) => string;
  /** Texto que el dashboard ya usa cuando no hay MTBF («Requiere historial mín. 2 fallas»). */
  mtbfSinDatos: string;
}

export interface FraseResumen {
  id: 'salud' | 'sla' | 'disponibilidad' | 'mttr' | 'mtbf' | 'costo';
  titulo: string;
  texto: string;
  /** `costos`: la frase invita a abrir el desglose de costos por máquina que ya existe. */
  enlace?: 'costos';
}

/** Objetivo y piso de SLA: son las mismas constantes de `backend/src/barb/routers/stats.py` (SALUD_SLA_VERDE / SALUD_SLA_ROJO). */
export const SLA_OBJETIVO = 95;
export const SLA_PISO = 85;

/** Fracción exacta `k de n` (n entre 2 y 10) que corresponde al porcentaje, o `null` si no hay ninguna. 0 % y 100 % no cuentan. */
export function fraccionExacta(porcentaje: number): { n: number; k: number } | null {
  if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje >= 100) return null;
  for (let n = 2; n <= 10; n++) {
    const k = Math.round((porcentaje * n) / 100);
    if (k > 0 && k < n && Math.round((k / n) * 1000) / 10 === Math.round(porcentaje * 10) / 10) return { n, k };
  }
  return null;
}

/** Minutos → «5 h 12 min» (o «45 min» si no llega a una hora). */
export function duracion(minutos: number): string {
  const total = Math.max(0, Math.round(minutos));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/**
 * Reconstruye estado y motivo con los campos estructurados, siguiendo las MISMAS reglas que `_semaforo_operacional` del
 * backend: rojo si hay al menos una OT vencida o el SLA está bajo el piso; amarillo si hay OT demoradas o el SLA está bajo el
 * objetivo; verde si no. Solo sirve para el inglés: el texto en español lo redacta el backend y se copia tal cual.
 */
export function reconstruirSalud(s: SaludOperacionalData): { estado: EstadoSalud; clave: string } {
  if (s.vencidas >= 1) return { estado: 'rojo', clave: 'exp_motivo_vencidas' };
  if (s.sla < SLA_PISO) return { estado: 'rojo', clave: 'exp_motivo_piso' };
  if (s.estancadas >= 1) return { estado: 'amarillo', clave: 'exp_motivo_demoradas' };
  if (s.sla < SLA_OBJETIVO) return { estado: 'amarillo', clave: 'exp_motivo_objetivo' };
  return { estado: 'verde', clave: 'exp_motivo_ok' };
}

/** Parámetros de cada plantilla de motivo (las cifras vienen de los campos estructurados, ya formateadas). */
function parametrosMotivo(clave: string, s: SaludOperacionalData, numero: ResumenEntrada['numero']): Record<string, string | number> {
  switch (clave) {
    case 'exp_motivo_vencidas':
      return { v0: s.vencidas };
    case 'exp_motivo_piso':
      return { v0: numero(s.sla, 1), v1: SLA_PISO };
    case 'exp_motivo_demoradas':
      return { v0: s.estancadas };
    case 'exp_motivo_objetivo':
      return { v0: numero(s.sla, 1), v1: SLA_OBJETIVO };
    default:
      return {};
  }
}

function fraseSalud(e: ResumenEntrada): FraseResumen | null {
  const s = e.stats.salud_operacional;
  if (!s) return null;
  const estado = e.t(`ayuda.exp_estado_${s.estado}`);
  const titulo = e.t('ayuda.exp_t_salud');
  const sla = e.numero(s.sla, 1);

  // Español: el motivo lo redacta el backend (solo en español) y se muestra tal cual.
  if (e.idioma === 'es') {
    const motivo = (s.motivo ?? '').trim();
    return {
      id: 'salud',
      titulo,
      texto: motivo ? e.t('ayuda.exp_salud_con_motivo', { v0: estado, v1: motivo }) : e.t('ayuda.exp_salud_sin_motivo', { v0: estado, v1: sla, v2: s.vencidas }),
    };
  }

  // Inglés: nunca se traduce a mano el texto del backend. Se arma con los campos estructurados si las reglas reproducen
  // exactamente el estado que informó el backend; si no, se muestra el estado con las cifras, sin motivo.
  const reconstruido = s.estado === 'insuficiente' ? null : reconstruirSalud(s);
  if (reconstruido && reconstruido.estado === s.estado) {
    const motivo = e.t(`ayuda.${reconstruido.clave}`, parametrosMotivo(reconstruido.clave, s, e.numero));
    return { id: 'salud', titulo, texto: e.t('ayuda.exp_salud_con_motivo', { v0: estado, v1: motivo }) };
  }
  return { id: 'salud', titulo, texto: e.t('ayuda.exp_salud_sin_motivo', { v0: estado, v1: sla, v2: s.vencidas }) };
}

function fraseSla(e: ResumenEntrada): FraseResumen | null {
  const pct = e.stats.financials?.efficiency;
  if (pct === undefined || pct === null) return null;
  const partes: string[] = [];
  const fraccion = fraccionExacta(pct);
  if (fraccion) {
    partes.push(e.t(fraccion.k === 1 ? 'ayuda.exp_sla_fraccion_uno' : 'ayuda.exp_sla_fraccion', { v0: fraccion.n, v1: fraccion.k }));
  }
  if (pct >= SLA_OBJETIVO) partes.push(e.t('ayuda.exp_sla_cumple', { v0: SLA_OBJETIVO }));
  else if (pct >= SLA_PISO) partes.push(e.t('ayuda.exp_sla_entre', { v0: SLA_OBJETIVO, v1: SLA_PISO }));
  else partes.push(e.t('ayuda.exp_sla_bajo', { v0: SLA_PISO }));
  return { id: 'sla', titulo: e.t('ayuda.exp_t_sla', { v0: e.numero(pct, 1) }), texto: partes.join(' ') };
}

function fraseDisponibilidad(e: ResumenEntrada): FraseResumen | null {
  const d = e.stats.financials?.disponibilidad_planta;
  if (d === undefined || d === null) return null;
  const detenido = Math.round((100 - d) * 10) / 10;
  const titulo = e.t('ayuda.exp_t_disponibilidad', { v0: e.numero(d, 1) });
  if (e.rango === 'all') return { id: 'disponibilidad', titulo, texto: e.t('ayuda.exp_disp_sin_horas', { v0: e.numero(detenido, 1) }) };
  const total = e.rango * 24;
  const horas = (detenido / 100) * total;
  return { id: 'disponibilidad', titulo, texto: e.t('ayuda.exp_disp_horas', { v0: e.numero(detenido, 1), v1: e.numero(horas, 1), v2: e.numero(total, 0) }) };
}

function fraseMttr(e: ResumenEntrada): FraseResumen | null {
  const mttr = e.stats.financials?.mttr;
  if (mttr === undefined || mttr === null) return null;
  return {
    id: 'mttr',
    titulo: e.t('ayuda.exp_t_mttr', { v0: e.numero(mttr, 0) }),
    texto: e.t('ayuda.exp_mttr', { v0: duracion(mttr) }),
  };
}

function fraseMtbf(e: ResumenEntrada): FraseResumen {
  const f = e.stats.financials;
  const horas = f?.mtbfHours;
  if (f?.mtbf_visible && horas !== null && horas !== undefined) {
    return { id: 'mtbf', titulo: e.t('ayuda.exp_t_mtbf', { v0: e.mtbf(horas) }), texto: e.t('ayuda.exp_mtbf') };
  }
  return { id: 'mtbf', titulo: e.t('ayuda.exp_t_mtbf_sin'), texto: e.mtbfSinDatos };
}

function fraseCosto(e: ResumenEntrada): FraseResumen | null {
  // Los campos de costo solo existen para quien tiene `ver_kpis_financieros`: si el backend los omitió, la frase no se arma.
  if (e.stats.financieros_visibles === false) return null;
  const costo = e.stats.financials?.costo_total_acumulado;
  if (costo === undefined || costo === null) return null;
  return { id: 'costo', titulo: e.t('ayuda.exp_t_costo', { v0: e.moneda(costo) }), texto: e.t('ayuda.exp_costo'), enlace: 'costos' };
}

/**
 * «Explícame este dashboard»: arma frases con plantillas fijas a partir de las cifras que el dashboard YA recibe.
 * No usa IA, no llama al backend y no agrega datos: así las cifras del texto son siempre las de las tarjetas.
 *
 * Orden: Salud Operacional, Cumplimiento de SLA, Disponibilidad, MTTR, MTBF y Costo directo (este último solo si el perfil
 * tiene acceso a los indicadores financieros). Una frase cuya cifra no llegó se omite en vez de inventarla.
 */
export function construirResumen(entrada: ResumenEntrada): FraseResumen[] {
  return [fraseSalud, fraseSla, fraseDisponibilidad, fraseMttr, fraseMtbf, fraseCosto]
    .map((armar) => armar(entrada))
    .filter((frase): frase is FraseResumen => frase !== null);
}
