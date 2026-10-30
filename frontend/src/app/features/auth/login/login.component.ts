import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionsService } from '../../../core/permissions/permissions.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="flex min-h-dvh items-center justify-center bg-fondo p-4">
      <div class="panel w-full max-w-md border-t-8 border-t-senal p-6 md:p-8">
        <div class="mb-6">
          <h1 class="codigo text-5xl font-bold text-accion">BARB</h1>
          <p class="mt-1 text-base text-tinta-suave">Sistema de mantenimiento de planta</p>
        </div>

        <form (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
          <div>
            <label for="login-email" class="fld-label">Usuario</label>
            <input
              id="login-email"
              type="email"
              [(ngModel)]="email"
              name="email"
              required
              autocomplete="username"
              class="fld-input"
              placeholder="admin@barb.com" />
          </div>

          <div>
            <label for="login-password" class="fld-label">Contraseña</label>
            <input
              id="login-password"
              type="password"
              [(ngModel)]="password"
              name="password"
              required
              autocomplete="current-password"
              class="fld-input"
              placeholder="••••••••" />
          </div>

          @if (error()) {
            <div class="rounded-control border border-peligro bg-peligro-suave px-3 py-2 text-base text-peligro" role="alert">
              {{ error() }}
            </div>
          }

          <button type="submit" [disabled]="loading()" class="btn-primary min-h-14 text-lg md:min-h-12 md:text-base">
            {{ loading() ? 'Ingresando...' : 'Ingresar' }}
          </button>
        </form>
      </div>
    </main>
  `
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private permissions = inject(PermissionsService);

  email = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);

  onSubmit() {
    if (!this.email || !this.password) return;

    this.loading.set(true);
    this.error.set(null);

    this.auth.login(this.email, this.password).subscribe({
      // Cada rol aterriza en su página inicial (super_usuario -> /empresas).
      next: () => this.router.navigateByUrl(this.permissions.getDefaultRoute()),
      error: (err: HttpErrorResponse) => {
        // 403 = empresa suspendida/cancelada; el backend explica el motivo.
        this.error.set(err.status === 403 && err.error?.detail ? err.error.detail : 'Usuario o contraseña incorrecta');
        this.loading.set(false);
      }
    });
  }
}
