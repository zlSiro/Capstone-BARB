import { Celda, ColumnaDef, FilaReporte, FiltrosReporte, ReporteId } from '../../../core/models';
import { FILTROS_POR_REPORTE, aQuery } from '../filtros/filtros-url';
import { Formato } from '../logica/tipos';

/**
 * Exportación a CSV, generada en el navegador (sin dependencias).
 *
 * - BOM UTF-8 al inicio, para que Excel respete las tildes.
 * - ES: separador `;` y coma decimal. EN: separador `,` y punto decimal.
 * - Encabezados en el idioma activo; los montos llevan la moneda en el encabezado (`Costo real (CLP)`).
 * - Fechas `YYYY-MM-DD HH:mm` en hora local.
 * - Solo las columnas elegidas y solo las filas que pasaron los filtros.
 */
export const BOM = '﻿';

export function separador(idioma: 'es' | 'en'): string {
  return idioma === 'es' ? ';' : ',';
}

/** Número sin separador de miles y con el decimal del idioma. */
export function numeroCsv(valor: number, dec: number, idioma: 'es' | 'en'): string {
  const txt = valor.toFixed(dec);
  return idioma === 'es' ? txt.replace('.', ',') : txt;
}

/** Escapa una celda: comillas dobles duplicadas y entre comillas si lleva separador, comillas o saltos de línea. */
export function escaparCelda(texto: string, sep: string): string {
  return /["\r\n]/.test(texto) || texto.includes(sep) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Evita que Excel interprete un texto como fórmula (`=`, `+`, `-`, `@` al inicio). Solo se aplica a celdas de texto. */
function sinFormula(texto: string): string {
  return /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
}

export function encabezado(col: ColumnaDef, fmt: Formato): string {
  const base = fmt.t(col.clave);
  if (col.tipo === 'moneda') return `${base} (${fmt.monedaCodigo})`;
  if (col.tipo === 'minutos') return `${base} (min)`;
  if (col.tipo === 'porcentaje') return `${base} (%)`;
  return base;
}

/** Texto de una celda para el CSV. */
export function celdaCsv(valor: Celda, col: ColumnaDef, fmt: Formato): string {
  if (valor === null || valor === undefined || valor === '') return '';
  switch (col.tipo) {
    case 'entero':
    case 'minutos':
      return typeof valor === 'number' ? numeroCsv(valor, 0, fmt.idioma) : String(valor);
    case 'numero':
    case 'porcentaje':
      return typeof valor === 'number' ? numeroCsv(valor, 1, fmt.idioma) : String(valor);
    case 'moneda':
      return typeof valor === 'number' ? numeroCsv(fmt.convertir(valor), 2, fmt.idioma) : String(valor);
    case 'fecha':
      return fmt.fecha(String(valor));
    case 'enum':
      return fmt.t(`reportes.v_${col.enumPrefijo}_${valor}`);
    default:
      return sinFormula(String(valor));
  }
}

/** Texto de una celda para la pantalla (con formato de miles y símbolo de moneda). */
export function celdaPantalla(valor: Celda, col: ColumnaDef, fmt: Formato): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  switch (col.tipo) {
    case 'entero':
    case 'minutos':
      return typeof valor === 'number' ? fmt.numero(valor, 0) : String(valor);
    case 'numero':
      return typeof valor === 'number' ? fmt.numero(valor, 1) : String(valor);
    case 'porcentaje':
      return typeof valor === 'number' ? `${fmt.numero(valor, 1)} %` : String(valor);
    case 'moneda':
      return typeof valor === 'number' ? fmt.moneda(valor) : String(valor);
    case 'fecha':
      return fmt.fecha(String(valor)) || '—';
    case 'enum':
      return fmt.t(`reportes.v_${col.enumPrefijo}_${valor}`);
    default:
      return String(valor);
  }
}

/** Genera el CSV completo (con BOM) de las columnas y filas dadas. */
export function generarCsv(columnas: readonly ColumnaDef[], filas: readonly FilaReporte[], fmt: Formato): string {
  const sep = separador(fmt.idioma);
  const lineas = [columnas.map((col) => escaparCelda(encabezado(col, fmt), sep)).join(sep)];
  for (const fila of filas) {
    lineas.push(columnas.map((col) => escaparCelda(celdaCsv(fila[col.id] ?? null, col, fmt), sep)).join(sep));
  }
  return BOM + lineas.join('\r\n') + '\r\n';
}

/** Resumen de los filtros activos para el nombre del archivo (`dias30_planta2`), solo letras, números y guiones. */
export function filtrosParaNombre(id: ReporteId, f: FiltrosReporte): string {
  const q = aQuery(id, f);
  delete q['cols'];
  // El periodo siempre va en el nombre (aunque sea el de por defecto): dice qué ventana de tiempo cubre el archivo.
  if (FILTROS_POR_REPORTE[id].includes('dias')) q['dias'] = f.dias === null ? 'hist' : String(f.dias);
  const partes = Object.entries(q)
    .sort(([a], [b]) => (a === 'dias' ? -1 : b === 'dias' ? 1 : 0))
    .map(([k, v]) => `${k}${v}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  return partes.length ? partes.join('_') : 'sin-filtros';
}

const dos = (n: number) => String(n).padStart(2, '0');

/** `barb_<id>_<filtros-resumidos>_<YYYY-MM-DD>.csv` (fecha local). */
export function nombreArchivo(id: ReporteId, f: FiltrosReporte, hoy: Date): string {
  const fecha = `${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}-${dos(hoy.getDate())}`;
  return `barb_${id}_${filtrosParaNombre(id, f)}_${fecha}.csv`;
}

/** Descarga un CSV en el navegador. */
export function descargarCsv(nombre: string, contenido: string): void {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
