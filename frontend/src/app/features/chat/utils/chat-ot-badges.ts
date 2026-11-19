import { WorkOrderStatus } from '../../../core/models';
import { priorityMeta, statusMeta } from '../../work-orders/utils/work-order-labels';

export const STATUS_SYNONYMS: Record<string, WorkOrderStatus> = {
  pending: 'pending',
  pendiente: 'pending',
  pendientes: 'pending',
  assigned: 'assigned',
  asignada: 'assigned',
  asignadas: 'assigned',
  in_progress: 'in_progress',
  'in progress': 'in_progress',
  'en curso': 'in_progress',
  en_curso: 'in_progress',
  'en-curso': 'in_progress',
  por_validar: 'por_validar',
  'por validar': 'por_validar',
  'needs review': 'por_validar',
  'needs_review': 'por_validar',
  completed: 'completed',
  cerrada: 'completed',
  cerradas: 'completed',
  completada: 'completed',
  completadas: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  cancelada: 'cancelled',
  canceladas: 'cancelled',
  cancelado: 'cancelled',
  overdue: 'overdue',
  vencida: 'overdue',
  vencidas: 'overdue',
};

export const PRIORITY_SYNONYMS: Record<string, string> = {
  low: 'low',
  baja: 'low',
  bajo: 'low',
  medium: 'medium',
  media: 'medium',
  medio: 'medium',
  high: 'high',
  alta: 'high',
  alto: 'high',
  urgent: 'urgent',
  urgente: 'urgent',
  crítica: 'urgent',
  critica: 'urgent',
};

/**
 * Genera el HTML del badge de estado de OT con el punto de color y estilos de la vista de OTs.
 */
export function buildStatusBadgeHtml(estado: WorkOrderStatus | string): string {
  const meta = statusMeta(estado as WorkOrderStatus);
  return `<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}"><span class="size-2 rounded-full ${meta.dot}" aria-hidden="true"></span>${meta.label}</span>`;
}

/**
 * Genera el HTML del badge de prioridad de OT con estilos de la vista de OTs.
 */
export function buildPriorityBadgeHtml(prioridad: string): string {
  const meta = priorityMeta(prioridad);
  return `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.badge}">${meta.label}</span>`;
}

/**
 * Transforma menciones de estados y prioridades de OT en el markdown del chat a badges visuales coloreados.
 */
export function formatOtBadges(content: string): string {
  if (!content) return content;

  // 1. Procesar tablas markdown (| Estado | Prioridad |)
  let text = formatTableBadges(content);

  // 2. Procesar paréntesis con estado y prioridad: (Pendiente, prioridad Media) o (in_progress, prioridad high)
  text = text.replace(
    /\(\s*([a-zA-Z_áéíóúÁÉÍÓÚ\s]+?)\s*,\s*(?:prioridad|priority)\s+([a-zA-Z_áéíóúÁÉÍÓÚ\s]+?)\s*\)/gi,
    (match, st, pr) => {
      const stKey = STATUS_SYNONYMS[st.trim().toLowerCase()];
      const prKey = PRIORITY_SYNONYMS[pr.trim().toLowerCase()];
      if (stKey && prKey) {
        return `(${buildStatusBadgeHtml(stKey)}, prioridad ${buildPriorityBadgeHtml(prKey)})`;
      }
      return match;
    }
  );

  // 3. Procesar estado entre paréntesis tras código de OT: **OT-IA-...** (Pendiente) o OT-... (in_progress)
  text = text.replace(
    /(\b(?:OT|SYN-HIST|REAL-CHA|OT-IA)-[A-Z0-9-]+\*{0,2}\s*)\(\s*([a-zA-Z_áéíóúÁÉÍÓÚ\s]+?)\s*\)/gi,
    (match, otCode, st) => {
      const stKey = STATUS_SYNONYMS[st.trim().toLowerCase()];
      if (stKey) {
        return `${otCode}(${buildStatusBadgeHtml(stKey)})`;
      }
      return match;
    }
  );

  // 4. Procesar etiquetas "Estado: <valor>" / "Status: <valor>"
  text = text.replace(
    /(^|[\n\r·\-\*]\s*)(Estado|Status)(\s*:\s*)([a-zA-Z_áéíóúÁÉÍÓÚ\s]+?)(?=\s*(?:[·\n\r,\.;|]|\([^\)]*\)|$))/gi,
    (match, prefix, label, sep, val) => {
      const key = STATUS_SYNONYMS[val.trim().toLowerCase()];
      if (key) {
        return `${prefix}${label}${sep}${buildStatusBadgeHtml(key)}`;
      }
      return match;
    }
  );

  // 5. Procesar etiquetas "Prioridad: <valor>" / "Priority: <valor>"
  text = text.replace(
    /(^|[\n\r·\-\*]\s*)(Prioridad|Priority)(\s*:\s*)([a-zA-Z_áéíóúÁÉÍÓÚ\s]+?)(?=\s*(?:[·\n\r,\.;|]|\([^\)]*\)|$))/gi,
    (match, prefix, label, sep, val) => {
      const key = PRIORITY_SYNONYMS[val.trim().toLowerCase()];
      if (key) {
        return `${prefix}${label}${sep}${buildPriorityBadgeHtml(key)}`;
      }
      return match;
    }
  );

  return text;
}

/**
 * Transforma celdas en columnas de Estado y Prioridad dentro de tablas markdown.
 */
function formatTableBadges(markdown: string): string {
  const lines = markdown.split('\n');
  let inTable = false;
  let statusColIdx = -1;
  let priorityColIdx = -1;

  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => c.trim());

      if (!inTable) {
        inTable = true;
        statusColIdx = cells.findIndex(c => /^(?:estado|status)$/i.test(c));
        priorityColIdx = cells.findIndex(c => /^(?:prioridad|priority)$/i.test(c));
        result.push(line);
        continue;
      }

      // Línea divisoria (|---|---|)
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        result.push(line);
        continue;
      }

      // Fila de datos
      const formattedCells = [...cells];
      if (statusColIdx !== -1 && statusColIdx < formattedCells.length) {
        const raw = formattedCells[statusColIdx].replace(/<[^>]*>/g, '').trim().toLowerCase();
        const key = STATUS_SYNONYMS[raw];
        if (key) {
          formattedCells[statusColIdx] = buildStatusBadgeHtml(key);
        }
      }

      if (priorityColIdx !== -1 && priorityColIdx < formattedCells.length) {
        const raw = formattedCells[priorityColIdx].replace(/<[^>]*>/g, '').trim().toLowerCase();
        const key = PRIORITY_SYNONYMS[raw];
        if (key) {
          formattedCells[priorityColIdx] = buildPriorityBadgeHtml(key);
        }
      }

      result.push(`| ${formattedCells.join(' | ')} |`);
    } else {
      inTable = false;
      statusColIdx = -1;
      priorityColIdx = -1;
      result.push(line);
    }
  }

  return result.join('\n');
}
