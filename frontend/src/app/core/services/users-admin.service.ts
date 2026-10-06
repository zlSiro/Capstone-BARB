import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { UserCreateRequest, UserUpdateRequest, UsuarioPerfil } from '../models';
import { environment } from '../../../environments/environment';

/** Mantenedor de perfiles de usuario (admin de empresa y super_usuario). */
@Service()
export class UsersAdminService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/usuarios`;

  getAll() {
    return this.http.get<UsuarioPerfil[]>(this.url);
  }

  create(payload: UserCreateRequest) {
    return this.http.post<UsuarioPerfil>(this.url, payload);
  }

  update(id: number, payload: UserUpdateRequest) {
    return this.http.put<UsuarioPerfil>(`${this.url}/${id}`, payload);
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
