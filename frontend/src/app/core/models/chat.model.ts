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
  /** El turno llevó una imagen que ya no está disponible (viene del Historial, HU-23). */
  hasImage?: boolean;
}

export interface ChatRequest {
  session_id: string | null;
  message: string;
  // Solo para el super_usuario: empresa cuya documentación consulta.
  empresa_id?: number | null;
  /** HU-23. Ausente = conserva la máquina de la sesión; número = fija/cambia; `null` = desvincula. */
  maquina_id?: number | null;
  /** CGBIDA-551: Idioma elegido por el usuario ('es' | 'en'). */
  locale?: string;
}

// --- Chat multimodal (HU-05, CGBIDA-276): docs/referencias/contrato_api_chat_multimedia.md ---

export interface MultimediaRequest {
  session_id: string | null;
  /** 1 a 2000 caracteres (el backend revalida). */
  message: string;
  /** Data URL: data:image/{jpeg|png|webp};base64,... — máx. 5 MB decodificados. */
  image_base64: string;
  // Solo para el super_usuario (igual que en el chat textual).
  empresa_id?: number | null;
  /** HU-23: misma semántica que en `ChatRequest`. */
  maquina_id?: number | null;
  /** CGBIDA-551: Idioma elegido por el usuario ('es' | 'en'). */
  locale?: string;
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
  /** HU-23: el turno llevó una imagen (la imagen no se guarda). */
  has_image?: boolean;
}

export interface SessionDetailResponse {
  session_id: string;
  titulo: string;
  saved_at: string;
  messages: SessionMessage[];
  /** HU-23: máquina vinculada a la conversación, para restaurar el selector. */
  maquina_id?: number | null;
  machine_name?: string | null;
}

export interface DeleteSessionResponse {
  deleted: boolean;
  session_id: string;
}
