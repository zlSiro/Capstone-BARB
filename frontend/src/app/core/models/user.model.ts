// =============================================================================
// USUARIOS Y ROLES
// =============================================================================
//
// Roles reales del backend (permissions.py ROLES): operador, tecnico,
// supervisor, engineer, gerente, admin, visitante. El backend devuelve el
// rol en minúsculas (ver auth.py login: str(user["rol"]).lower()).
//

export type Role =
  | 'operador'
  | 'tecnico'
  | 'supervisor'
  | 'engineer'
  | 'gerente'
  | 'admin'
  | 'visitante'
  // Operador de la plataforma BARB: no pertenece a una empresa y ve todas.
  | 'super_usuario'
  | (string & {});

export interface User {
  id: string | number;
  name: string;
  role: Role;
  token?: string;
  // Multi-empresa: null para el super_usuario (no pertenece a ninguna empresa).
  empresa_id?: number | null;
  empresa_nombre?: string | null;
}

// =============================================================================
// AUTENTICACIÓN (contrato exacto de /api/auth/login)
// =============================================================================

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: number;
    name: string;
    role: Role;
    empresa_id: number | null;
    empresa_nombre: string | null;
  };
}

// =============================================================================
// GESTIÓN DE USUARIOS (admin) — contrato de /api/usuarios
// =============================================================================

export interface UserCreateRequest {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  activo?: boolean;
  // Solo lo respeta el backend para el super_usuario; el admin siempre crea en su empresa.
  empresa_id?: number | null;
}

/** Perfil de usuario tal como lo devuelve GET /api/usuarios. */
export interface UsuarioPerfil {
  usuario_id: number;
  nombre: string;
  email: string;
  rol: Role;
  activo: boolean;
  created_at: string | null;
  ultimo_login: string | null;
  empresa_id: number | null;
  empresa_nombre: string | null;
}

export interface UserUpdateRequest {
  nombre?: string;
  email?: string;
  password?: string;
  rol?: string;
  activo?: boolean;
}
