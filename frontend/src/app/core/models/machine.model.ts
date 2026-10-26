// =============================================================================
// CATÁLOGOS (contrato exacto del backend /api/machines, /api/disciplines,
// /api/plants, /api/technicians)
// =============================================================================

export interface Machine {
  id: number;
  name: string;
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
