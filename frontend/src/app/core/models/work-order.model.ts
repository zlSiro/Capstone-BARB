export type OTStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'overdue';
export type OTPriority = 'low' | 'medium' | 'high' | 'urgent';
export type OTSeverity = 'low' | 'medium' | 'high' | 'critical';
export type OTType = 'corrective' | 'preventive' | 'predictive' | 'inspection';

export interface WorkOrder {
  ot_id: number;
  numero_ot: string;
  maquina_id: number;
  tecnico_id: number;
  creado_por: number;
  tipo: OTType;
  descripcion_problema?: string;
  descripcion_reparacion?: string;
  resolution?: string;
  priority: OTPriority;
  severity?: OTSeverity;
  fecha_creacion: string;
  fecha_inicio?: string;
  fecha_cierre?: string;
  tiempo_reparacion_min?: number;
  downtime_minutes?: number;
  costo_estimado?: number;
  costo_real?: number;
  estado: OTStatus;
}
