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
}

export interface DocumentoUpdate {
  title?: string;
  notes?: string | null;
  activo?: boolean;
}
