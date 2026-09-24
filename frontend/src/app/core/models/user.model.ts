export type Role = 'admin' | 'engineer' | 'supervisor' | 'technician';

export interface User {
  id: string | number;
  name: string;
  role: Role;
  email?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}
