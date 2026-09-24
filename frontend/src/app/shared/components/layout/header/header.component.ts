import { Component, inject } from '@angular/core';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🏭</span>
        <h1 class="text-lg font-bold text-gray-800">BARB</h1>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-600">{{ auth.user()?.name }}</span>
        <span class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{{ auth.user()?.role }}</span>
        <button (click)="auth.logout()" class="text-sm text-red-600 hover:text-red-800">
          Cerrar sesión
        </button>
      </div>
    </header>
  `
})
export class HeaderComponent {
  auth = inject(AuthService);
}
