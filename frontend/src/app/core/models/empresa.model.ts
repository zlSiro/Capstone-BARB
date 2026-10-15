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

/** Primer usuario de la empresa, con perfil gerente; se crea junto con ella (opcional). */
export interface GerenteInicial {
  nombre: string;
  email: string;
  password: string;
}

/** Respuesta de POST /api/empresas; con gerente inicial incluye los datos de su aviso de bienvenida. */
export interface EmpresaCreada extends Empresa {
  gerente?: { nombre: string; rol: string; created_at: string | null };
  creado_por?: { nombre: string; email: string };
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
  gerente?: GerenteInicial | null;
}
