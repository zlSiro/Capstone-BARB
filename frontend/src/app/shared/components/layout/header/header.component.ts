import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../../../../core/services/auth.service';
import { EmpresasService } from '../../../../core/services/empresas.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { Empresa } from '../../../../core/models';

@Component({
  selector: 'app-header',
  imports: [TranslatePipe],
  template: `
    <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between transition-colors">
      <div class="flex items-center gap-3">
        <span class="text-2xl" aria-hidden="true">🏭</span>
        <h1 class="text-lg font-bold text-gray-800 dark:text-gray-100">{{ 'login.title' | translate }}</h1>
        @if (!tenant.isSuper() && auth.user()?.empresa_nombre) {
          <span class="text-sm text-gray-600 dark:text-gray-300 border-l border-gray-300 dark:border-gray-600 pl-3">
            {{ auth.user()?.empresa_nombre }}
          </span>
        }
        @if (tenant.isSuper()) {
          <!-- super_usuario: elige qué empresa ver; "Todas" = vista global de la plataforma -->
          <div class="flex items-center gap-2 border-l border-gray-300 dark:border-gray-600 pl-3">
            <label for="tenant-select" class="text-sm text-gray-600 dark:text-gray-300">Empresa:</label>
            <select
              id="tenant-select"
              class="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              (change)="onTenantChange($any($event.target).value)">
              <option value="" [selected]="tenant.empresaId() === null">Todas las empresas</option>
              @for (e of empresas(); track e.empresa_id) {
                <option [value]="e.empresa_id" [selected]="e.empresa_id === tenant.empresaId()">{{ e.nombre }}</option>
              }
            </select>
          </div>
        }
      </div>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-600 dark:text-gray-300">{{ auth.user()?.name }}</span>
        <span class="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 px-2 py-1 rounded">
          {{ auth.user()?.role }}
        </span>
        <button
          (click)="theme.toggle()"
          class="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
          title="Tema">
          {{ theme.dark() ? '☀️' : '🌙' }}
        </button>
        <button
          (click)="i18n.toggleLang()"
          class="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium">
          🌐 {{ i18n.lang() === 'es' ? 'ES' : 'EN' }}
        </button>
        <button (click)="auth.logout()" class="text-sm text-red-600 dark:text-red-400 hover:text-red-800">
          {{ 'topbar.logout' | translate }}
        </button>
      </div>
    </header>
  `
})
export class HeaderComponent {
  auth = inject(AuthService);
  i18n = inject(I18nService);
  theme = inject(ThemeService);
  protected readonly tenant = inject(TenantContextService);
  private readonly empresasService = inject(EmpresasService);

  protected readonly empresas = signal<Empresa[]>([]);

  constructor() {
    if (this.tenant.isSuper()) {
      this.empresasService.getAll().subscribe({ next: (list) => this.empresas.set(list) });
    }
  }

  protected onTenantChange(value: string): void {
    this.tenant.select(value ? Number(value) : null);
    // Todas las pantallas cargan sus datos al iniciarse: se recarga para que
    // el nuevo contexto de empresa se aplique de inmediato en la vista actual.
    window.location.reload();
  }
}
