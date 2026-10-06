// =============================================================================
// ÓRDENES DE TRABAJO
// =============================================================================
//
// Contrato exacto que devuelve el backend en routers/work_orders.py:
// row_to_work_order(). El backend retorna nombres en inglés y español,
// para dar flexibilidad a cualquier frontend.
//

export type WorkOrderStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'overdue'
  | (string & {});

export type WorkOrderPriority =
  | 'low'
  | 'medium'
  | 'high'
  | 'urgent'
  | (string & {});

export type WorkOrderSeverity =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | (string & {});

export type MaintenanceType =
  | 'corrective'
  | 'preventive'
  | 'predictive'
  | 'inspection'
  | (string & {});

export interface WorkOrderPhoto {
  id: number;
  ot_id: number;
  file_name: string;
  original_name: string;
  content_type: string;
  file_path: string;
  created_at?: string | null;
}

export interface WorkOrder {
  // Identificadores
  id: string;              // = numero_ot (string)
  numero_ot: string;
  ot_id: number;

  // Multi-empresa: empresa dueña de la OT (visible para el super_usuario)
  empresa_id?: number | null;
  empresa_nombre?: string;

  // Título y descripción
  title: string;
  description?: string | null;
  resolution?: string | null;

  // Máquina
  machine: string;
  machine_name: string;
  machine_id: number;

  // Planta
  plant: string;
  plant_name: string;
  plant_id: number;

  // Disciplina
  discipline: string;
  discipline_name: string;

  // Prioridad, estado, severidad
  priority: WorkOrderPriority;
  status: string;          // Humanizado ("In Progress")
  estado: WorkOrderStatus; // Raw snake_case ("in_progress") ← usar para lógica
  severity?: WorkOrderSeverity | null;

  // Fechas y duración
  age_minutes: number;
  created_at: string;
  fecha_inicio?: string | null;
  fecha_cierre?: string | null;
  downtime_minutes?: number | null;

  // Fotos
  photo_count: number;
  photos: WorkOrderPhoto[];

  // Técnico y tipo
  tecnico_nombre: string;
  tipo: MaintenanceType;

  // Costos
  costo_estimado: number;
  costo_real: number;

  // Referencias
  reporte_id?: number | null;
  diagnostico_id?: number | null;
}
