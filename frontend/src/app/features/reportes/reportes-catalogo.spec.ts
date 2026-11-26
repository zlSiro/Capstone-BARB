import { describe, expect, it } from 'vitest';

import { Role } from '../../core/models';
import { puedeAccederRuta, puedeEjecutarAccion } from '../../core/permissions/permissions';
import { REPORTES, PermisosReporte, biblioteca, puedeVerReporte, reportePorId, reportesVisibles } from './reportes-catalogo';

/** Permisos reales de la matriz para un rol (la misma lógica que `PermissionsService`, sin Angular). */
function permisos(rol: Role): PermisosReporte {
  return {
    role: () => rol,
    canAccess: (r) => puedeAccederRuta(rol, r),
    canPerform: (a) => puedeEjecutarAccion(rol, a),
  };
}

const ids = (rol: Role) => reportesVisibles(permisos(rol)).map((r) => r.id).sort();
const esperados = (...x: string[]) => x.sort();

describe('catálogo de reportes: visibilidad por perfil (matriz actual)', () => {
  it('supervisor: R1–R5, R7, R9 y R10', () => {
    expect(ids('supervisor')).toEqual(esperados('r1', 'r2', 'r3', 'r4', 'r5', 'r7', 'r9', 'r10'));
  });
  it('ingeniero: R1–R5 y R9', () => {
    expect(ids('engineer')).toEqual(esperados('r1', 'r2', 'r3', 'r4', 'r5', 'r9'));
  });
  it('gerente: R1–R7 y R9 (con costos, R6)', () => {
    expect(ids('gerente')).toEqual(esperados('r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r9'));
  });
  it('operador y técnico: R8 y R9', () => {
    expect(ids('operador')).toEqual(esperados('r8', 'r9'));
    expect(ids('tecnico')).toEqual(esperados('r8', 'r9'));
  });
  it('admin: R9 y R10', () => {
    expect(ids('admin')).toEqual(esperados('r9', 'r10'));
  });
  it('super_usuario no ve ningún reporte', () => {
    expect(ids('super_usuario')).toEqual([]);
  });
  it('R6 solo para quien puede ver KPIs financieros', () => {
    const r6 = reportePorId('r6')!;
    expect(puedeVerReporte(r6, permisos('gerente'))).toBe(true);
    for (const rol of ['operador', 'tecnico', 'supervisor', 'engineer', 'admin'] as Role[]) {
      expect(puedeVerReporte(r6, permisos(rol)), rol).toBe(false);
    }
  });
  it('cada perfil de empresa ve al menos un reporte', () => {
    for (const rol of ['operador', 'tecnico', 'supervisor', 'engineer', 'gerente', 'admin'] as Role[]) {
      expect(reportesVisibles(permisos(rol)).length, rol).toBeGreaterThan(0);
    }
  });
  it('la biblioteca no muestra grupos vacíos', () => {
    // el admin solo tiene R9 (operación) y R10 (confiabilidad y datos): no hay grupo «desempeño»
    expect(biblioteca(permisos('admin')).map((g) => g.grupo)).toEqual(['operacion', 'confiabilidad']);
    expect(biblioteca(permisos('operador')).map((g) => g.grupo)).toEqual(['operacion']);
    expect(biblioteca(permisos('supervisor')).map((g) => g.grupo)).toEqual(['desempeno', 'operacion', 'confiabilidad']);
  });
  it('el catálogo tiene 10 reportes con ids únicos', () => {
    expect(new Set(REPORTES.map((r) => r.id)).size).toBe(10);
  });
  it('un id desconocido no existe', () => {
    expect(reportePorId('r99')).toBeUndefined();
    expect(reportePorId(null)).toBeUndefined();
  });
});
