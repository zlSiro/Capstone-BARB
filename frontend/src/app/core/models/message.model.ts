// =============================================================================
// CHAT Y MENSAJERÍA
// =============================================================================

export interface SourceHit {
  documentName?: string;
  pageNumber?: number | string;
  excerpt?: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'bot' | (string & {});
  content: string;
  timestamp?: number;
  sources?: SourceHit[];
}

export type DebugMessagesByMachine = Record<string, Message[]>;

// =============================================================================
// RESPUESTAS DE API
// =============================================================================

export interface DocApiResponse {
  response: string;
  sources?: SourceHit[];
  suggestedQuestions?: string[];
  conversationId?: string;
}

export interface DebugApiResponse {
  response: string;
  diagnostics?: unknown;
  suggestedActions?: unknown[];
}
