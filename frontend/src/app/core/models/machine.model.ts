export interface Machine {
  maquina_id: number;
  planta_id: number;
  categoria_id?: number;
  nombre: string;
  tipo?: string;
  modelo?: string;
  fabricante?: string;
  numero_serie?: string;
  estado: string;
  image_url?: string;
}

export interface Plant {
  planta_id: number;
  cliente_id: number;
  nombre: string;
  ubicacion?: string;
  area?: string;
  sector?: string;
  estado: string;
}

export interface Discipline {
  disciplina_id: number;
  nombre: string;
  icono?: string;
  color?: string;
  descripcion?: string;
}
