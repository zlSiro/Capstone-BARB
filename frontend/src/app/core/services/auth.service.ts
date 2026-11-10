import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { User, LoginResponse } from '../models';
import { environment } from '../../../environments/environment';

const TOKEN_KEY = 'barb_token';
const USER_KEY = 'barb_user';
/** Marca persistente: tras un login correcto el usuario debe confirmar sus privilegios antes de usar la herramienta. */
const PRIVILEGIOS_KEY = 'barb_privilegios_pendiente';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private apiUrl = environment.apiUrl;

  user = signal<User | null>(this.loadUser());
  /** `true` mientras el usuario no haya confirmado el aviso de privilegios (sobrevive a recargar la página). */
  readonly privilegiosPendientes = signal(this.isLoggedIn() && localStorage.getItem(PRIVILEGIOS_KEY) === '1');

  login(email: string, password: string) {
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/login`, { email, password })
      .pipe(tap(res => {
        localStorage.setItem(TOKEN_KEY, res.token);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
        localStorage.setItem(PRIVILEGIOS_KEY, '1');
        this.user.set(res.user);
        this.privilegiosPendientes.set(true);
      }));
  }

  /** El usuario confirmó que comprende los privilegios de su perfil. */
  aceptarPrivilegios(): void {
    localStorage.removeItem(PRIVILEGIOS_KEY);
    this.privilegiosPendientes.set(false);
  }

  logout() {
    this.http.post(`${this.apiUrl}/auth/logout`, {}).subscribe({
      next: () => this.clear(),
      error: () => this.clear()
    });
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  private clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('barb_tenant_empresa_id'); // empresa elegida por el super_usuario
    localStorage.removeItem(PRIVILEGIOS_KEY);
    this.privilegiosPendientes.set(false);
    this.user.set(null);
    this.router.navigate(['/login']);
  }

  private loadUser(): User | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
}
