import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Documento, DocumentoUpdate } from '../models';
import { environment } from '../../../environments/environment';

/** Documentación de la empresa que consume el chat IA. */
@Service()
export class DocumentsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/documents`;

  /** El interceptor acota a la empresa elegida cuando el usuario es super_usuario. */
  getAll() {
    return this.http.get<Documento[]>(this.url);
  }

  upload(form: FormData) {
    return this.http.post<Documento>(this.url, form);
  }

  update(id: number, changes: DocumentoUpdate) {
    return this.http.patch<Documento>(`${this.url}/${id}`, changes);
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
