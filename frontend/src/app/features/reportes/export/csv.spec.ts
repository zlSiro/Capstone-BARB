import { describe, expect, it } from 'vitest';

import { ColumnaDef, FILTROS_VACIOS } from '../../../core/models';
import { columnasDisponibles, columnasElegidas } from '../columnas';
import { formatoTest } from '../fixtures';
import { BOM, escaparCelda, generarCsv, nombreArchivo, numeroCsv, separador } from './csv';

const col = (id: string, tipo: ColumnaDef['tipo'], extra: Partial<ColumnaDef> = {}): ColumnaDef => ({ id, clave: `reportes.col_${id}`, tipo, ...extra });

describe('CSV: formato por idioma', () => {
  it('empieza con BOM UTF-8 y usa CRLF', () => {
    const csv = generarCsv([col('a', 'texto')], [{ a: 'x' }], formatoTest('es'));
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(`${BOM}reportes.col_a\r\nx\r\n`);
  });
  it('ES: separador «;» y coma decimal. EN: «,» y punto', () => {
    expect(separador('es')).toBe(';');
    expect(separador('en')).toBe(',');
    const cols = [col('n', 'numero'), col('m', 'moneda'), col('t', 'texto')];
    const fila = { n: 12.34, m: 1500.5, t: 'a' };
    expect(generarCsv(cols, [fila], formatoTest('es'))).toContain('12,3;1500,50;a');
    expect(generarCsv(cols, [fila], formatoTest('en'))).toContain('12.3,1500.50,a');
    expect(numeroCsv(1234567.8, 1, 'es')).toBe('1234567,8'); // sin separador de miles
  });
  it('los encabezados llevan unidad y moneda', () => {
    const csv = generarCsv([col('c', 'moneda'), col('p', 'porcentaje'), col('t', 'minutos')], [], formatoTest('es'));
    expect(csv).toContain('reportes.col_c (CLP);reportes.col_p (%);reportes.col_t (min)');
  });
  it('escapa comillas, separadores y saltos de línea', () => {
    expect(escaparCelda('a;b', ';')).toBe('"a;b"');
    expect(escaparCelda('di "hola"', ';')).toBe('"di ""hola"""');
    expect(escaparCelda('l1\nl2', ';')).toBe('"l1\nl2"');
    expect(escaparCelda('a,b', ';')).toBe('a,b'); // la coma no es separador en ES
    expect(escaparCelda('a,b', ',')).toBe('"a,b"');
  });
  it('un texto que empieza con «=» no se interpreta como fórmula', () => {
    expect(generarCsv([col('t', 'texto')], [{ t: '=SUMA(A1)' }], formatoTest('es'))).toContain("'=SUMA(A1)");
  });
  it('las enumeraciones se exportan traducidas y las celdas nulas vacías', () => {
    const csv = generarCsv([col('e', 'enum', { enumPrefijo: 'estado' }), col('n', 'entero')], [{ e: 'in_progress', n: null }], formatoTest('es'));
    expect(csv).toContain('reportes.v_estado_in_progress;');
  });
  it('solo las columnas elegidas y solo las filas dadas', () => {
    const cols = [col('a', 'texto'), col('c', 'texto')];
    const csv = generarCsv(cols, [{ a: '1', b: 'oculto', c: '3' }], formatoTest('es'));
    expect(csv).toBe(`${BOM}reportes.col_a;reportes.col_c\r\n1;3\r\n`);
    expect(csv).not.toContain('oculto');
  });
});

describe('CSV: nombre de archivo', () => {
  it('barb_<id>_<filtros>_<fecha>.csv', () => {
    const f = { ...FILTROS_VACIOS, dias: 30, planta: 2 };
    expect(nombreArchivo('r1', f, new Date(2026, 10, 5))).toBe('barb_r1_dias30_planta2_2026-11-05.csv');
    expect(nombreArchivo('r3', FILTROS_VACIOS, new Date(2026, 0, 9))).toBe('barb_r3_sin-filtros_2026-01-09.csv');
  });
});

describe('columnas: nada de datos sobrantes ni de costos ajenos', () => {
  const PROHIBIDAS = ['ot_id', 'empresa_id', 'tecnico_id', 'photos', 'allowed_transitions', 'reporte_id', 'diagnostico_id'];
  it('ningún reporte ofrece columnas internas', () => {
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10'] as const) {
      for (const c of columnasDisponibles(id, true)) expect(PROHIBIDAS).not.toContain(c.id);
    }
  });
  it('las columnas de costo solo existen con ver_kpis_financieros', () => {
    const sin = columnasDisponibles('r6', false).map((c) => c.id);
    const con = columnasDisponibles('r6', true).map((c) => c.id);
    for (const id of ['costo_estimado', 'costo_real', 'desviacion']) {
      expect(sin).not.toContain(id);
      expect(con).toContain(id);
    }
    expect(columnasDisponibles('r3', false).every((c) => !c.soloFinanzas)).toBe(true);
  });
  it('sin elección se usan las de por defecto; con elección, solo esas (y solo si existen)', () => {
    expect(columnasElegidas('r3', [], false).every((c) => c.porDefecto)).toBe(true);
    expect(columnasElegidas('r3', ['numero_ot', 'estado'], false).map((c) => c.id)).toEqual(['numero_ot', 'estado']);
    expect(columnasElegidas('r6', ['costo_real'], false).length).toBeGreaterThan(0); // costo_real no existe: cae a las de por defecto
    expect(columnasElegidas('r6', ['costo_real'], false).map((c) => c.id)).not.toContain('costo_real');
  });
});
