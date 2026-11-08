import { describe, expect, it } from 'vitest';

import {
  ACCIONES,
  AccionKey,
  ROLES,
  ROLES_REPOSITORIO_AVISOS,
  RUTAS,
  getDefaultRouteForRole,
  puedeAccederRuta,
  puedeEjecutarAccion,
} from './permissions';

/**
 * Espejo de `backend/tests/test_permissions.py`: si cambia la matriz en uno de los dos lados, estas pruebas
 * (y las del backend) obligan a actualizar el otro.
 */
const ACCIONES_ESPERADAS: Partial<Record<AccionKey, string[]>> = {
  crear_ot: ['supervisor'],
  cambiar_estado_ot: ['supervisor'],
  cancelar_ot: ['supervisor'],
  eliminar_ot: [],
  reportar_falla: ['operador', 'tecnico', 'supervisor', 'engineer', 'gerente'],
  gestionar_avisos: ['supervisor'],
  asignar_ot: ['supervisor'],
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

  it('el rol «visitante» ya no existe: ni en la lista de roles ni en ninguna matriz', () => {
    expect([...ROLES]).not.toContain('visitante');
    expect(ROLES).toHaveLength(7);
    for (const matriz of [...Object.values(ACCIONES), ...Object.values(RUTAS)]) expect(Object.keys(matriz)).not.toContain('visitante');
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

  it('Historial y dashboard: supervisor, ingeniero y gerente; el administrador no', () => {
    for (const ruta of ['history', 'dashboard'] as const) {
      const conAcceso = ROLES.filter((r) => puedeAccederRuta(r, ruta));
      expect([...conAcceso].sort()).toEqual(['engineer', 'gerente', 'supervisor']);
    }
    expect(puedeAccederRuta('admin', 'history')).toBe(false);
    expect(puedeAccederRuta('admin', 'dashboard')).toBe(false);
  });

  it('Mantenedor de plantas: solo el admin', () => {
    expect(ROLES.filter((r) => puedeAccederRuta(r, 'plantas'))).toEqual(['admin']);
  });

  it('Documentos: el gerente solo los consulta; los suben el ingeniero y el admin', () => {
    expect(puedeAccederRuta('gerente', 'documentos')).toBe(true); // lectura
    expect(puedeAccederRuta('gerente', 'documentos', false)).toBe(false); // no escritura
    for (const accion of ['subir_documentos', 'eliminar_documentos'] as const) {
      expect([...ROLES.filter((r) => puedeEjecutarAccion(r, accion))].sort()).toEqual(['admin', 'engineer']);
    }
  });

  it('el repositorio de avisos lo ven supervisor y gerente, pero solo el supervisor decide', () => {
    expect([...ROLES_REPOSITORIO_AVISOS].sort()).toEqual(['gerente', 'supervisor']);
    expect(ROLES.filter((r) => puedeEjecutarAccion(r, 'gestionar_avisos'))).toEqual(['supervisor']);
  });

  it('los KPIs financieros del dashboard son solo del gerente', () => {
    expect(ROLES.filter((r) => puedeEjecutarAccion(r, 'ver_kpis_financieros'))).toEqual(['gerente']);
  });

  it('el gerente consulta las OT pero no las opera', () => {
    for (const accion of ['cambiar_estado_ot', 'cancelar_ot', 'eliminar_ot', 'asignar_ot', 'gestionar_avisos'] as const) {
      expect(puedeEjecutarAccion('gerente', accion)).toBe(false);
    }
    expect(puedeEjecutarAccion('gerente', 'gestionar_usuarios')).toBe(true);
  });
});

describe('permisos: pantalla de inicio por rol (HU-24)', () => {
  it.each([
    ['operador', '/avisos'],
    ['supervisor', '/avisos'],
    ['tecnico', '/work-orders'],
    ['engineer', '/dashboard'],
    ['gerente', '/dashboard'],
    ['admin', '/work-orders'],
    ['super_usuario', '/empresas'],
  ])('%s empieza en %s', (rol, ruta) => {
    expect(getDefaultRouteForRole(rol as never)).toBe(ruta);
  });

  it('sin sesión o sin rol va al login', () => {
    expect(getDefaultRouteForRole(null)).toBe('/login');
    expect(getDefaultRouteForRole(undefined)).toBe('/login');
  });
});
