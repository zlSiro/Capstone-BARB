// =============================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// =============================================================================
//
// Traducción de AppState (React context) a modelo Angular. En Angular el
// estado vive en un servicio (CoreStateService) que se construye en el
// Paquete 2, pero el contrato del estado se define aquí.
//

import { Message, DebugMessagesByMachine } from './message.model';
import { User } from './user.model';

export interface AppState {
  // UI / preferencias
  currentScreen: string;
  dark: boolean;
  lang: string;

  // Selecciones de dominio
  discipline: string | null;
  docMachine: string;
  plant: string;
  selectedMachine: string | null;

  // Sesión de chat / debug
  sessionId: string | null;
  sessionStart: number | null;
  docMessages: Message[];
  debugMessagesByMachine: DebugMessagesByMachine;

  // Autenticación
  user: User | null;

  // URLs de servicios
  apiBase: string;
  lmBase: string;

  // UI global
  loading: boolean;
}

export interface StoredAuth {
  user: Pick<User, 'id' | 'name' | 'role'>;
  token: string;
  savedAt: number;
}
