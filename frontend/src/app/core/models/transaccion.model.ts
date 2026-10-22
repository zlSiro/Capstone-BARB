// =============================================================================
// TRANSACCIONES (vista del super_usuario) — contrato de /api/transacciones
// =============================================================================

export type RangoTransacciones = '24h' | '7d' | '30d' | '1y' | 'custom';
export type OperacionTransaccion = 'INSERT' | 'UPDATE' | 'DELETE';

export interface CambioColumna {
  antes: unknown;
  despues: unknown;
}

/** `cambios` viene en los UPDATE; `datos` (fila completa) en INSERT y DELETE. */
export interface DetalleTransaccion {
  tabla?: string;
  operacion?: OperacionTransaccion;
  registro_id?: string | null;
  cambios?: Record<string, CambioColumna>;
  datos?: Record<string, unknown>;
}

export interface Transaccion {
  transaccion_id: number;
  fecha: string;
  usuario_id: number;
  usuario_nombre: string;
  usuario_email: string;
  empresa_id: number | null;
  empresa_nombre: string | null;
  perfil: string;
  accion: string;
  operacion: OperacionTransaccion | null;
  tabla: string | null;
  registro_id: string | null;
  detalle: DetalleTransaccion;
}

export interface TransaccionesPage {
  items: Transaccion[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransaccionesFiltros {
  empresa_id?: number | null;
  rol?: string;
  usuario_id?: number | null;
  rango: RangoTransacciones;
  desde?: string;
  hasta?: string;
  limit: number;
  offset: number;
}

/** Opciones de filtro del gerente: solo roles y usuarios de su empresa. */
export type TransaccionesEmpresaOpciones = Pick<TransaccionesOpciones, 'roles' | 'usuarios'>;

export interface TransaccionesOpciones {
  empresas: { empresa_id: number; nombre: string }[];
  roles: string[];
  usuarios: { usuario_id: number; nombre: string; rol: string; empresa_id: number | null }[];
}
