// =============================================================================
// CATÁLOGOS (contrato exacto del backend /api/machines, /api/disciplines,
// /api/plants, /api/technicians)
// =============================================================================

export interface Machine {
  id: number;
  name: string;
  /** Código interno del equipo (se usa para precargar la edición). */
  codigo?: string;
  discipline_id: number | null;
  plant_id: number | null;
  /** SLA propio de la máquina, en horas. `null` = usa el default de la empresa. */
  sla_horas?: number | null;
  /** Costo de tener la máquina detenida, por minuto. `null` = sin dato por equipo. */
  costo_inactividad_minuto?: number | null;
}

export interface Discipline {
  id: number;
  name: string;
}

export interface Plant {
  id: number;
  name: string;
  ubicacion?: string | null;
}

export interface Technician {
  id: number;
  name: string;
  email: string;
  role: string;
}

/** Cuerpo de `PATCH /api/maquinas/{id}`. Los campos en `null`/ausentes no se tocan. */
export interface MaquinaUpdatePayload {
  nombre?: string;
  codigo?: string;
  /** Id de una disciplina existente de la empresa. */
  disciplina_id?: number | null;
  sla_horas?: number | null;
  costo_inactividad_minuto?: number | null;
}

/** Respuesta de `PATCH /api/maquinas/{id}`. */
export interface MaquinaActualizada {
  maquina_id: number;
  planta_id: number;
  nombre: string;
  codigo: string;
  disciplina_id: number | null;
  sla_horas?: number | null;
  costo_inactividad_minuto?: number | null;
}