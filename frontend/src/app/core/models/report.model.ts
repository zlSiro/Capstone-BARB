// =============================================================================
// REPORTES Y SESIONES DE DIAGNÓSTICO
// =============================================================================

export interface Report {
  reportId: string;
  machineId?: string | number;
  title: string;
  summary: string;
  createdAt: string;
  createdBy?: string;
}

export interface DebugSession {
  sessionId: string;
  machineId?: string | number;
  startedAt: string;
  endedAt?: string;
  technician?: string;
  notes?: string;
}

// =============================================================================
// HISTORIAL
// =============================================================================

export type HistoryEvent = {
  id: string;
  type: 'workorder' | 'report' | 'debug' | (string & {});
  date: string;
  title: string;
  actor?: string;
  summary?: string;
};
