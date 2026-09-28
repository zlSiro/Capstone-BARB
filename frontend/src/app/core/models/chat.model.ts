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

// Eventos que emite el backend por SSE
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
