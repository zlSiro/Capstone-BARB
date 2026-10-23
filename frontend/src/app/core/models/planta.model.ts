/**
 * Contrato del alta masiva de plantas (HU-25 / CGBIDA-461, subtarea CGBIDA-466).
 *
 * Espeja `backend/src/barb/schemas/plantas.py`. Las disciplinas viajan por NOMBRE: el
 * backend las reutiliza si la empresa ya las tiene y sólo crea las que faltan, porque
 * `disciplina` cuelga de la empresa y se comparte entre plantas.
 */

/** Máquina que se crea junto con la planta. */
export interface MaquinaNuevaPayload {
  nombre: string;
  codigo: string;
  /** Nombre de la disciplina, o null si la máquina no tiene. */
  disciplina: string | null;
}

/** Cuerpo de `POST /api/plantas/completa`. */
export interface PlantaCompletaPayload {
  nombre: string;
  ubicacion: string | null;
  disciplinas: string[];
  maquinas: MaquinaNuevaPayload[];
}

/** Disciplina tal como la resolvió el backend. */
export interface DisciplinaResuelta {
  disciplina_id: number;
  nombre: string;
  /** `false` = ya existía en la empresa y se reutilizó. */
  creada: boolean;
}

export interface MaquinaCreada {
  maquina_id: number;
  nombre: string;
  codigo: string;
  disciplina_id: number | null;
}

/** Respuesta de `POST /api/plantas/completa`. */
export interface PlantaCompletaResponse {
  planta_id: number;
  nombre: string;
  ubicacion: string | null;
  disciplinas: DisciplinaResuelta[];
  maquinas: MaquinaCreada[];
}

/** Cuerpo de `PATCH /api/plantas/{id}`. El campo ausente no se toca. */
export interface PlantaUpdatePayload {
  nombre?: string;
  ubicacion?: string | null;
}

/** Respuesta de `PATCH /api/plantas/{id}`. */
export interface PlantaActualizada {
  planta_id: number;
  nombre: string;
  ubicacion: string | null;
}
