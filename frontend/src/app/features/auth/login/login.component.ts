import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionsService } from '../../../core/permissions/permissions.service';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { Icon } from '../../../shared/components/ui/icon/icon';
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, TranslatePipe, Icon],
  template: `
    <main class="flex min-h-dvh items-center justify-center bg-fondo p-4">
      <div class="panel w-full max-w-md border-t-8 border-t-senal p-6 md:p-8">
        <div class="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 class="codigo text-5xl font-bold text-accion">BARB</h1>
            <p class="mt-1 text-base text-tinta-suave">{{ 'acceso.sistema_de_mantenimiento_de' | translate }}</p>
          </div>
          <button type="button" class="btn-secondary shrink-0" data-testid="login-idioma" [attr.aria-label]="'acceso.cambiar_idioma' | translate" (click)="i18n.toggleLang()">
            <app-icon name="idioma" [size]="20" />
            {{ i18n.lang() === 'es' ? 'ES' : 'EN' }}
          </button>
        </div>

        <form (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
          <div>
            <label for="login-email" class="fld-label">{{ 'acceso.usuario' | translate }}</label>
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
            <label for="login-password" class="fld-label">{{ 'acceso.contrasena' | translate }}</label>
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
            {{ (loading() ? 'acceso.ingresando' : 'acceso.ingresar') | translate }}
          </button>
        </form>
      </div>
    </main>
  `
})
export class LoginComponent {
  protected readonly i18n = inject(I18nService);
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
        this.error.set(err.status === 403 && err.error?.detail ? err.error.detail : this.i18n.tr('acceso.usuario_o_contrasena_incorrect'));
        this.loading.set(false);
      }
    });
  }
}
