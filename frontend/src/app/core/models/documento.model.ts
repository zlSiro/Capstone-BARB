// =============================================================================
// DOCUMENTACIÓN POR EMPRESA (fuente de conocimiento del chat IA) — /api/documents
// =============================================================================

export interface Documento {
  id: number;
  empresa_id: number;
  empresa_nombre: string;
  title: string;
  notes: string | null;
  original_name: string;
  content_type: string | null;
  size_bytes: number;
  /** Fragmentos indexados que la IA puede consultar. */
  chunks_indexed: number;
  /** false = la IA no lo usa (sigue almacenado). */
  activo: boolean;
  created_at: string | null;
  subido_por: string | null;
  /** Máquina del catálogo a la que está ligado (HU-23); `null` = documento general de la empresa. */
  maquina_id: number | null;
  maquina_nombre: string | null;
  maquina_codigo: string | null;
}

export interface DocumentoUpdate {
  title?: string;
  notes?: string | null;
  activo?: boolean;
  /** Ausente = no cambia; número = asigna; `null` = desvincula. */
  maquina_id?: number | null;
}
