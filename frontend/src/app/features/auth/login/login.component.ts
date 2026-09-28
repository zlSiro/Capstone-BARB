import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-100">
      <div class="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <div class="text-center mb-6">
          <div class="text-5xl mb-2">🏭</div>
          <h1 class="text-2xl font-bold text-gray-800">BARB</h1>
          <p class="text-sm text-gray-500">Sistema de mantenimiento de planta</p>
        </div>

        <form (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
            <input
              type="email"
              [(ngModel)]="email"
              name="email"
              required
              class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="admin@barb.com" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
            <input
              type="password"
              [(ngModel)]="password"
              name="password"
              required
              class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••" />
          </div>

          @if (error()) {
            <div class="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded">
              {{ error() }}
            </div>
          }

          <button
            type="submit"
            [disabled]="loading()"
            class="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2 rounded transition">
            {{ loading() ? 'Ingresando...' : 'Ingresar' }}
          </button>
        </form>
      </div>
    </div>
  `
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);

  onSubmit() {
    if (!this.email || !this.password) return;

    this.loading.set(true);
    this.error.set(null);

    this.auth.login(this.email, this.password).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.error.set('Usuario o contraseña incorrecta');
        this.loading.set(false);
      }
    });
  }
}
