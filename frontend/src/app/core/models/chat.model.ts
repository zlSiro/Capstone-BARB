// frontend/src/app/core/models/chat.model.ts

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  /**
   * Imagen adjunta del turno (data URL). Solo existe en la sesión viva:
   * el backend NO persiste la imagen (HU-05, decisión D2) — al recargar
   * desde el Historial este campo llega indefinido.
   */
  imageUrl?: string;
}

export interface ChatRequest {
  session_id: string | null;
  message: string;
  // Solo para el super_usuario: empresa cuya documentación consulta.
  empresa_id?: number | null;
}

// --- Chat multimodal (HU-05, CGBIDA-276): docs/contrato_api_chat_multimedia.md ---

export interface MultimediaRequest {
  session_id: string | null;
  /** 1 a 2000 caracteres (el backend revalida). */
  message: string;
  /** Data URL: data:image/{jpeg|png|webp};base64,... — máx. 5 MB decodificados. */
  image_base64: string;
  // Solo para el super_usuario (igual que en el chat textual).
  empresa_id?: number | null;
}

// --- Eventos SSE ---
export interface SseSessionEvent {
  session_id: string;
}

export interface SseTokenEvent {
  text: string;
}

export interface SseErrorEvent {
  code: string;
  message: string;
}

/** Eventos del stream SSE del chat (textual y multimodal): session/token/error/done. */
export type ChatStreamEvent =
  | { type: 'session'; data: SseSessionEvent }
  | { type: 'token'; data: SseTokenEvent }
  | { type: 'error'; data: SseErrorEvent }
  | { type: 'done'; data: Record<string, never> };

// --- Historial de conversaciones (CGBIDA-254/255/256) ---

export interface SessionListItem {
  session_id: string;
  titulo: string;
  saved_at: string;         // ISO 8601
  message_count: number;
  saved_by?: string | null;
  machine_name?: string | null;
  discipline?: string | null;
  plant_name?: string | null;
}

export interface SessionListResponse {
  sessions: SessionListItem[];
  total: number;
}

export interface SessionMessage {
  role: MessageRole | 'system';
  content: string;
  timestamp?: number | null;
}

export interface SessionDetailResponse {
  session_id: string;
  titulo: string;
  saved_at: string;
  messages: SessionMessage[];
}

export interface DeleteSessionResponse {
  deleted: boolean;
  session_id: string;
}
