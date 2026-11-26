import { Control } from '../../../core/models';

/**
 * Cuadratura: controles automáticos que comparan una cifra del reporte con otra fuente (otra parte de la misma respuesta
 * del backend o el listado de OT). Mientras un control falle, la exportación queda deshabilitada.
 */
export function control(id: string, ok: boolean, detalle: string): Control {
  return { id, ok, detalle };
}

/** Compara dos enteros exactamente. */
export function igual(a: number, b: number): boolean {
  return a === b;
}

/** Compara dos montos al centavo (el backend entrega los montos con 2 decimales). */
export function igualMonto(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/** Compara dos promedios al decimal que usa el backend (1 decimal en KPIs). */
export function igualDecimal(a: number, b: number, dec = 1): boolean {
  const f = 10 ** dec;
  return Math.round(a * f) === Math.round(b * f);
}

export function exportacionPermitida(controles: readonly Control[]): boolean {
  return controles.every((c) => c.ok);
}

/** Controles que fallaron (para explicar por qué la exportación está bloqueada). */
export function controlesFallidos(controles: readonly Control[]): Control[] {
  return controles.filter((c) => !c.ok);
}

/** Suma de un campo numérico, redondeada a 2 decimales para evitar ruido de coma flotante. */
export function suma(valores: readonly number[]): number {
  return Math.round(valores.reduce((a, b) => a + b, 0) * 100) / 100;
}
