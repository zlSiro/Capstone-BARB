// =============================================================================
// MATRIZ DE PERMISOS — Espejo exacto de backend/core/permissions.py
// =============================================================================
//
// Fuente de verdad del frontend. Cualquier cambio debe hacerse también en
// permissions.py del backend, y viceversa. El backend aplica los permisos
// realmente vía require_route/require_action; este archivo solo controla
// qué se muestra en la UI para no exponer botones que el servidor rechazaría.
//

import { Role } from '../models';

export const ROLES = [
  'operador',
  'tecnico',
  'supervisor',
  'engineer',
  'gerente',
  'admin',
  'visitante',
  'super_usuario',
] as const;

export type PermisoValor = boolean | 'ver';

export type RutaKey =
  | 'menu'
  | 'docchat'
  | 'debug'
  | 'topology'
  | 'memory'
  | 'report'
  | 'dashboard'
  | 'history'
  | 'empresas'
  | 'usuarios'
  | 'documentos';

export type AccionKey =
  | 'crear_ot'
  | 'cambiar_estado_ot'
  | 'cancelar_ot'
  | 'eliminar_ot'
  | 'subir_documentos'
  | 'gestionar_usuarios'
  | 'ver_usuarios'
  | 'eliminar_documentos'
  | 'gestionar_empresas';

// =============================================================================
// MATRIZ DE RUTAS (idéntica a RUTAS en permissions.py)
// =============================================================================

export const RUTAS: Record<RutaKey, Record<string, PermisoValor>> = {
  menu:      { operador: true, tecnico: true,  supervisor: true,  engineer: true,  gerente: true,  admin: true, visitante: true , super_usuario: true },
  docchat:   { operador: true, tecnico: true,  supervisor: true,  engineer: true,  gerente: true,  admin: true, visitante: false , super_usuario: true },
  debug:     { operador: true, tecnico: true,  supervisor: true,  engineer: true,  gerente: true,  admin: true, visitante: false , super_usuario: true },
  topology:  { operador: true, tecnico: true,  supervisor: true,  engineer: true,  gerente: true,  admin: true, visitante: 'ver' , super_usuario: true },
  memory:    { operador: true, tecnico: true,  supervisor: true,  engineer: true,  gerente: true,  admin: true, visitante: 'ver' , super_usuario: true },
  report:    { operador: true, tecnico: true,  supervisor: true,  engineer: true,  gerente: true,  admin: true, visitante: false , super_usuario: true },
  dashboard: { operador: false, tecnico: false, supervisor: true,  engineer: true,  gerente: true,  admin: true, visitante: 'ver' , super_usuario: true },
  // Multi-empresa (espejo de permissions.py)
  empresas:   { operador: false, tecnico: false, supervisor: false, engineer: false, gerente: false, admin: false, visitante: false, super_usuario: true },
  usuarios:   { operador: false, tecnico: false, supervisor: false, engineer: false, gerente: false, admin: true,  visitante: false, super_usuario: true },
  documentos: { operador: 'ver',  tecnico: 'ver',  supervisor: 'ver',  engineer: true,  gerente: true,  admin: true,  visitante: false, super_usuario: true },
  history:   { operador: false, tecnico: false, supervisor: true,  engineer: false, gerente: true,  admin: true, visitante: false , super_usuario: true },
};

// =============================================================================
// MATRIZ DE ACCIONES (idéntica a ACCIONES en permissions.py)
// =============================================================================

export const ACCIONES: Record<AccionKey, Record<string, boolean>> = {
  crear_ot:           { operador: false, tecnico: false, supervisor: false, engineer: false, gerente: true, admin: true, visitante: false , super_usuario: true },
  cambiar_estado_ot:  { operador: false, tecnico: false, supervisor: true,  engineer: true,  gerente: true, admin: true, visitante: false , super_usuario: true },
  cancelar_ot:        { operador: false, tecnico: false, supervisor: true,  engineer: false, gerente: true, admin: true, visitante: false , super_usuario: true },
  eliminar_ot:        { operador: false, tecnico: false, supervisor: true,  engineer: true,  gerente: true, admin: true, visitante: false , super_usuario: true },
  subir_documentos:   { operador: false, tecnico: false, supervisor: false, engineer: true,  gerente: true, admin: true, visitante: false , super_usuario: true },
  gestionar_usuarios: { operador: false, tecnico: false, supervisor: false, engineer: false, gerente: false, admin: true, visitante: false , super_usuario: true },
  eliminar_documentos: { operador: false, tecnico: false, supervisor: false, engineer: true,  gerente: true, admin: true, visitante: false, super_usuario: true },
  gestionar_empresas: { operador: false, tecnico: false, supervisor: false, engineer: false, gerente: false, admin: false, visitante: false, super_usuario: true },
  ver_usuarios:       { operador: false, tecnico: false, supervisor: false, engineer: false, gerente: false, admin: true, visitante: false , super_usuario: true },
};

// =============================================================================
// VALIDACIONES DE ACCESO
// =============================================================================

/**
 * Verifica si un rol puede acceder a una ruta.
 * Si soloLectura es true, acepta también el permiso 'ver'.
 */
export const puedeAccederRuta = (
  role: Role | null | undefined,
  ruta: RutaKey,
  soloLectura = true
): boolean => {
  if (!role) return false;
  const permiso = RUTAS[ruta]?.[role];
  if (permiso === true) return true;
  if (soloLectura && permiso === 'ver') return true;
  return false;
};

/**
 * Verifica si un rol puede ejecutar una acción.
 */
export const puedeEjecutarAccion = (
  role: Role | null | undefined,
  accion: AccionKey
): boolean => {
  if (!role) return false;
  return ACCIONES[accion]?.[role] === true;
};

/**
 * Retorna la primera ruta accesible para el rol dado, usada tras el login.
 */
export const getDefaultRouteForRole = (role: Role | null | undefined): string => {
  // El super_usuario administra la plataforma: aterriza en el mantenedor de empresas.
  if (puedeAccederRuta(role, 'empresas')) return '/empresas';
  if (puedeAccederRuta(role, 'dashboard')) return '/dashboard';
  if (puedeAccederRuta(role, 'menu')) return '/work-orders';
  return '/login';
};

// =============================================================================
// HELPERS PARA RUTAS CON FORMATO '/nombre'
// =============================================================================

export type AppPage = `/${RutaKey}`;

export const canAccessPage = (
  role: Role | null | undefined,
  page: AppPage,
  soloLectura = true
): boolean => puedeAccederRuta(role, page.slice(1) as RutaKey, soloLectura);

export const canPerformAction = (
  role: Role | null | undefined,
  action: AccionKey
): boolean => puedeEjecutarAccion(role, action);
