import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Machine, Plant, Discipline, Technician } from '../models';
import {
  MaquinaCreada,
  MaquinaNuevaPayload,
  PlantaActualizada,
  PlantaCompletaPayload,
  PlantaCompletaResponse,
  PlantaUpdatePayload,
} from '../models';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  getMachines() {
    return this.http.get<Machine[]>(`${this.apiUrl}/machines`);
  }

  getPlants() {
    return this.http.get<Plant[]>(`${this.apiUrl}/plants`);
  }

  getDisciplines() {
    return this.http.get<Discipline[]>(`${this.apiUrl}/disciplines`);
  }

  getTechnicians() {
    return this.http.get<Technician[]>(`${this.apiUrl}/technicians`);
  }

  /**
   * Alta masiva de una planta (HU-25 / CGBIDA-461, subtarea CGBIDA-466).
   *
   * El backend crea la planta, resuelve las disciplinas e inserta las máquinas en una sola
   * transacción: si algo falla —código de máquina repetido, nombre de planta ya usado— no
   * queda nada a medias. Las disciplinas viajan por nombre y el backend las reutiliza.
   */
  crearPlantaCompleta(payload: PlantaCompletaPayload) {
    return this.http.post<PlantaCompletaResponse>(`${this.apiUrl}/plantas/completa`, payload);
  }

  /**
   * Edita el nombre y/o la ubicación de una planta (HU-25, CGBIDA-466).
   *
   * El backend valida la unicidad del nombre en Python (el esquema no tiene la
   * restricción), así que un 409 aquí trae el mismo mensaje que devolvería el alta.
   */
  actualizarPlanta(plantaId: number, payload: PlantaUpdatePayload) {
    return this.http.patch<PlantaActualizada>(`${this.apiUrl}/plantas/${plantaId}`, payload);
  }

  /** Agrega una máquina a una planta existente (HU-25, CGBIDA-466). */
  agregarMaquina(plantaId: number, payload: MaquinaNuevaPayload) {
    return this.http.post<MaquinaCreada>(`${this.apiUrl}/plantas/${plantaId}/maquinas`, payload);
  }
}
