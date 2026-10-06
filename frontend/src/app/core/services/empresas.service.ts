import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Empresa, EmpresaCreatePayload, EmpresaPayload } from '../models';
import { environment } from '../../../environments/environment';

/** Mantenedor de empresas (solo super_usuario). */
@Service()
export class EmpresasService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/empresas`;

  getAll() {
    return this.http.get<Empresa[]>(this.url);
  }

  create(payload: EmpresaCreatePayload) {
    return this.http.post<Empresa>(this.url, payload);
  }

  update(id: number, payload: Partial<EmpresaPayload>) {
    return this.http.put<Empresa>(`${this.url}/${id}`, payload);
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
