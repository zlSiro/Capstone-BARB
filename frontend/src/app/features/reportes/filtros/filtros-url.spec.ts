import { describe, expect, it } from 'vitest';

import { FILTROS_VACIOS } from '../../../core/models';
import {
  Catalogos,
  aQuery,
  filtrosActivos,
  filtrosPorDefecto,
  filtrosSoloCliente,
  granularidadPorDefecto,
  idsMaquina,
  limpiarCascada,
  maquinasVisibles,
  parsearFiltros,
} from './filtros-url';

const CAT: Catalogos = {
  plantas: [{ id: 1, name: 'Norte' }, { id: 2, name: 'Sur' }],
  disciplinas: [{ id: 10, name: 'Mecánica' }, { id: 11, name: 'Eléctrica' }],
  maquinas: [
    { id: 100, name: 'Bomba', plant_id: 1, discipline_id: 10 },
    { id: 101, name: 'Tablero', plant_id: 1, discipline_id: 11 },
    { id: 102, name: 'Molino', plant_id: 2, discipline_id: 10 },
  ],
  tecnicos: [{ id: 7, name: 'Ana', email: 'a@x.cl', role: 'tecnico' }],
};
const COLS = ['numero_ot', 'estado', 'maquina'];

describe('filtros de reportes: cascada y conjuntos de máquinas', () => {
  it('sin topología no hay restricción', () => {
    expect(idsMaquina(CAT, FILTROS_VACIOS)).toBeNull();
  });
  it('planta + disciplina acotan las máquinas (por catálogo, no por nombre)', () => {
    expect(idsMaquina(CAT, { planta: 1, disciplina: 10, maquina: null })).toEqual(new Set([100]));
    expect(idsMaquina(CAT, { planta: null, disciplina: 10, maquina: null })).toEqual(new Set([100, 102]));
    expect(maquinasVisibles(CAT, { planta: 2, disciplina: null }).map((m) => m.id)).toEqual([102]);
  });
  it('una máquina que ya no es de la planta se limpia', () => {
    const r = limpiarCascada({ ...FILTROS_VACIOS, planta: 2, maquina: 100 }, CAT);
    expect(r.filtros.maquina).toBeNull();
    expect(r.limpiados).toEqual(['maquina']);
    expect(limpiarCascada({ ...FILTROS_VACIOS, planta: 1, maquina: 100 }, CAT).limpiados).toEqual([]);
  });
});

describe('filtros de reportes: ida y vuelta por la URL', () => {
  it('serializa solo lo que difiere del valor por defecto y lo recupera igual', () => {
    const f = { ...filtrosPorDefecto('r6'), dias: 90, planta: 1, disciplina: 10, tipo: 'corrective', estados: ['completed', 'por_validar'], soloDesviacion: true, cols: ['numero_ot', 'estado'] };
    const q = aQuery('r6', f);
    expect(q).toEqual({ dias: '90', planta: '1', disciplina: '10', tipo: 'corrective', estado: 'completed,por_validar', desviacion: '1', cols: 'numero_ot,estado' });
    const r = parsearFiltros('r6', q, CAT, COLS.concat(['estado']));
    expect(r.descartes).toEqual([]);
    expect(r.filtros).toEqual(f);
  });
  it('el periodo por defecto (30) no va en la URL y el histórico va como «hist»', () => {
    expect(aQuery('r1', filtrosPorDefecto('r1'))).toEqual({});
    expect(aQuery('r1', { ...filtrosPorDefecto('r1'), dias: null })).toEqual({ dias: 'hist' });
    expect(parsearFiltros('r1', { dias: 'hist' }, CAT, []).filtros.dias).toBeNull();
  });
  it('R3 no tiene periodo: dias no se lee ni se escribe', () => {
    expect(filtrosPorDefecto('r3').dias).toBeNull();
    expect(parsearFiltros('r3', { dias: '7' }, CAT, []).filtros.dias).toBeNull();
    expect(aQuery('r3', { ...filtrosPorDefecto('r3'), dias: 7 })).toEqual({});
  });
  it('descarta lo inválido, lo ajeno a la empresa y lo incoherente con la cascada, y avisa', () => {
    const r = parsearFiltros('r1', { dias: '45', planta: '99', disciplina: 'abc', maquina: '102', gran: 'siglo' }, CAT, []);
    const por = Object.fromEntries(r.descartes.map((d) => [d.param, d.motivo]));
    expect(por['dias']).toBe('invalido');
    expect(por['planta']).toBe('ajeno');
    expect(por['disciplina']).toBe('invalido');
    expect(por['gran']).toBe('invalido');
    expect(r.filtros.dias).toBe(30);
    expect(r.filtros.planta).toBeNull();
    expect(r.filtros.maquina).toBe(102); // la máquina existe y no contradice nada
    const c = parsearFiltros('r1', { planta: '1', maquina: '102' }, CAT, []);
    expect(c.filtros.maquina).toBeNull();
    expect(c.descartes).toContainEqual({ param: 'maquina', motivo: 'cascada' });
  });
  it('estados y columnas inválidos se filtran', () => {
    const r = parsearFiltros('r3', { estado: 'pending,completed,xx', cols: 'estado,secreto' }, CAT, COLS);
    expect(r.filtros.estados).toEqual(['pending']); // en R3 solo valen los estados abiertos
    expect(r.filtros.cols).toEqual(['estado']);
    expect(r.descartes.map((d) => d.param).sort()).toEqual(['cols', 'estado']);
  });
  it('un filtro que el reporte no ofrece se ignora', () => {
    expect(parsearFiltros('r9', { planta: '1', tipo: 'corrective', ot: 'OT-2026-0001' }, CAT, []).filtros).toMatchObject({ planta: null, tipo: null, numeroOt: 'OT-2026-0001' });
  });
});

describe('filtros de reportes: qué cambia las tarjetas del backend', () => {
  it('estado, prioridad, técnico… solo existen en el cliente; periodo y topología los entiende el backend', () => {
    const f = { ...filtrosPorDefecto('r6'), planta: 1, dias: 7, tipo: 'corrective', estados: ['completed'] };
    expect(filtrosActivos(f, 'r6').sort()).toEqual(['dias', 'estados', 'planta', 'tipo']);
    expect(filtrosSoloCliente(f, 'r6').sort()).toEqual(['estados', 'tipo']);
  });
  it('sin filtros activos no hay nada que rotular', () => {
    expect(filtrosSoloCliente(filtrosPorDefecto('r3'), 'r3')).toEqual([]);
  });
});

describe('granularidad por defecto', () => {
  it('un punto razonable por periodo', () => {
    expect(granularidadPorDefecto(7)).toBe('day');
    expect(granularidadPorDefecto(30)).toBe('day');
    expect(granularidadPorDefecto(90)).toBe('week');
    expect(granularidadPorDefecto(365)).toBe('month');
    expect(granularidadPorDefecto(null)).toBe('month');
  });
});
