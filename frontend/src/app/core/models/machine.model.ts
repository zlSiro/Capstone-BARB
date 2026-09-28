// =============================================================================
// CATÁLOGOS (contrato exacto del backend /api/machines, /api/disciplines,
// /api/plants, /api/technicians)
// =============================================================================

export interface Machine {
  id: number;
  name: string;
  discipline_id: number | null;
  plant_id: number | null;
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
