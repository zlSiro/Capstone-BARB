import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Machine, Plant, Discipline, Technician } from '../models';
import { PlantaCompletaPayload, PlantaCompletaResponse } from '../models';
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
}
