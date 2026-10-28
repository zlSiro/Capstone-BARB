import { describe, expect, it } from 'vitest';

import { ACCIONES, AccionKey, RUTAS, ROLES, puedeAccederRuta, puedeEjecutarAccion } from './permissions';

/**
 * Espejo de `backend/tests/test_permissions.py`: si cambia la matriz en uno de los dos lados, estas pruebas
 * (y las del backend) obligan a actualizar el otro.
 */
const ACCIONES_ESPERADAS: Partial<Record<AccionKey, string[]>> = {
  crear_ot: ['supervisor', 'gerente'],
  cambiar_estado_ot: ['supervisor', 'engineer', 'gerente'],
  cancelar_ot: ['supervisor', 'gerente'],
  eliminar_ot: ['gerente'],
  reportar_falla: ['operador', 'tecnico', 'supervisor', 'engineer', 'gerente'],
  gestionar_avisos: ['supervisor', 'gerente'],
  asignar_ot: ['supervisor', 'gerente'],
  iniciar_ot_asignada: ['tecnico'],
};

describe('permisos: acciones del ciclo de la OT', () => {
  for (const [accion, esperados] of Object.entries(ACCIONES_ESPERADAS)) {
    it(`${accion}: ${esperados.join(', ')}`, () => {
      const conPermiso = ROLES.filter((r) => puedeEjecutarAccion(r, accion as AccionKey));
      expect([...conPermiso].sort()).toEqual([...esperados].sort());
    });
  }

  it('el administrador no opera órdenes de trabajo ni avisos', () => {
    for (const accion of Object.keys(ACCIONES_ESPERADAS) as AccionKey[]) {
      expect(puedeEjecutarAccion('admin', accion)).toBe(false);
    }
  });

  it('el visitante no gana ninguna acción nueva', () => {
    for (const accion of Object.keys(ACCIONES_ESPERADAS) as AccionKey[]) {
      expect(puedeEjecutarAccion('visitante', accion)).toBe(false);
    }
  });

  it('cada acción y cada ruta cubren todos los roles', () => {
    for (const matriz of Object.values(ACCIONES)) expect(Object.keys(matriz).sort()).toEqual([...ROLES].sort());
    for (const matriz of Object.values(RUTAS)) expect(Object.keys(matriz).sort()).toEqual([...ROLES].sort());
  });
});

describe('permisos: pantallas', () => {
  it('Avisos de falla: quienes reportan, y no el admin ni el super_usuario', () => {
    const conAcceso = ROLES.filter((r) => puedeAccederRuta(r, 'avisos'));
    expect([...conAcceso].sort()).toEqual(['engineer', 'gerente', 'operador', 'supervisor', 'tecnico']);
  });

  it('Historial: el ingeniero lo analiza y el administrador solo lo consulta', () => {
    expect(puedeAccederRuta('engineer', 'history')).toBe(true);
    expect(puedeAccederRuta('admin', 'history')).toBe(true); // lectura
    expect(puedeAccederRuta('admin', 'history', false)).toBe(false); // no escritura
  });
});
