// frontend/src/app/core/models/chat.model.ts

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export interface ChatRequest {
  session_id: string | null;
  message: string;
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
