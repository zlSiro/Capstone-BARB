import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { RutaKey } from '../../../../core/permissions/permissions';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  ruta: RutaKey;
}

// Orden del menú. Cada ítem solo aparece si el rol tiene acceso a su ruta
// (el backend igualmente valida cada endpoint).
const NAV_ITEMS: NavItem[] = [
  { path: '/empresas', icon: '🏢', label: 'Empresas', ruta: 'empresas' },
  { path: '/dashboard', icon: '📊', label: 'Dashboard', ruta: 'dashboard' },
  { path: '/work-orders', icon: '🔧', label: 'Órdenes de Trabajo', ruta: 'menu' },
  { path: '/topology', icon: '🌐', label: 'Topología', ruta: 'topology' },
  { path: '/chat', icon: '💬', label: 'DocChat', ruta: 'docchat' },
  { path: '/documentos', icon: '📚', label: 'Documentos', ruta: 'documentos' },
  { path: '/usuarios', icon: '👥', label: 'Usuarios', ruta: 'usuarios' },
];

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside class="w-56 bg-gray-900 text-gray-100 min-h-screen py-4">
      <nav class="flex flex-col gap-1 px-2" aria-label="Navegación principal">
        @for (item of items(); track item.path) {
          <a
            [routerLink]="item.path"
            routerLinkActive="bg-gray-700"
            class="px-3 py-2 rounded hover:bg-gray-800 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <span aria-hidden="true">{{ item.icon }}</span> {{ item.label }}
          </a>
        }
      </nav>
    </aside>
  `
})
export class SidebarComponent {
  private readonly permissions = inject(PermissionsService);

  // Se recalcula si cambia el rol (login/logout).
  protected readonly items = computed(() => {
    this.permissions.role();
    return NAV_ITEMS.filter(i => this.permissions.canAccess(i.ruta));
  });
}
