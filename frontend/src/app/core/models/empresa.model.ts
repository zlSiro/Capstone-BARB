// =============================================================================
// EMPRESAS (mantenedor del super_usuario) — contrato de /api/empresas
// =============================================================================

export type PlanEmpresa = 'trial' | 'starter' | 'professional' | 'enterprise';
export type EstadoEmpresa = 'active' | 'suspended' | 'cancelled' | 'demo';

export interface Empresa {
  empresa_id: number;
  nombre: string;
  rut: string | null;
  pais: string;
  industria: string | null;
  contacto_nombre: string | null;
  contacto_email: string | null;
  contacto_telefono: string | null;
  plan: PlanEmpresa;
  estado: EstadoEmpresa;
  max_usuarios: number;
  max_plantas: number;
  licencia_inicio: string | null;
  licencia_fin: string | null;
  notas: string | null;
  created_at: string | null;
  // Contadores para la grilla
  usuarios_activos: number;
  usuarios_total: number;
  documentos: number;
  plantas: number;
  ordenes_trabajo: number;
}

/** Primer administrador de la empresa; se crea junto con ella (opcional). */
export interface AdminInicial {
  nombre: string;
  email: string;
  password: string;
}

export interface EmpresaPayload {
  nombre: string;
  rut: string | null;
  pais: string;
  industria: string | null;
  contacto_nombre: string | null;
  contacto_email: string | null;
  contacto_telefono: string | null;
  plan: PlanEmpresa;
  estado: EstadoEmpresa;
  max_usuarios: number;
  max_plantas: number;
  licencia_inicio: string | null;
  licencia_fin: string | null;
  notas: string | null;
}

export interface EmpresaCreatePayload extends EmpresaPayload {
  admin?: AdminInicial | null;
}
