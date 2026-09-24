import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Machine, Plant, Discipline } from '../models';
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
    return this.http.get<any[]>(`${this.apiUrl}/technicians`);
  }
}
