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
  | (string & {});

export interface User {
  id: string | number;
  name: string;
  role: Role;
  token?: string;
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
}

export interface UserUpdateRequest {
  nombre?: string;
  email?: string;
  password?: string;
  rol?: string;
  activo?: boolean;
}
