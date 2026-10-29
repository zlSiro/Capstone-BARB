import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AvisosPendientes } from '../../../../core/services/avisos-pendientes';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { Icon } from '../../ui/icon/icon';
import { NAV_ITEMS } from '../nav-items';

/**
 * Navegación lateral. Desde `lg` va expandida (ícono y texto); en tablet (`md`) es un riel de íconos con el nombre
 * en el tooltip; en móvil no se muestra (ahí está la barra inferior).
 */
@Component({
  selector: 'app-sidebar',
  host: { class: 'hidden md:flex' },
  imports: [RouterLink, RouterLinkActive, Icon, TranslatePipe],
  template: `
    <aside [attr.aria-label]="'nav.menuTitle' | translate" class="w-[72px] shrink-0 overflow-y-auto border-r border-borde bg-superficie py-3 md:block lg:w-64">
      <nav class="flex flex-col gap-1 px-2" [attr.aria-label]="'nav.mainNav' | translate">
        @for (item of items(); track item.path) {
          <a
            [routerLink]="item.path"
            routerLinkActive="bg-accion-suave text-accion font-semibold"
            [attr.title]="('nav.' + item.label) | translate"
            class="relative flex min-h-12 items-center justify-center gap-3 rounded-control px-3 text-base text-tinta transition-colors hover:bg-superficie-2 lg:justify-start">
            <app-icon [name]="item.icon" [size]="24" />
            <span class="hidden lg:inline">{{ ('nav.' + item.label) | translate }}</span>
            <span class="sr-only lg:hidden">{{ ('nav.' + item.label) | translate }}</span>
            @if (item.ruta === 'avisos' && pendientes() > 0) {
              <span
                class="codigo absolute right-1 top-1 inline-flex min-w-6 items-center justify-center rounded-full bg-peligro px-1.5 text-sm text-fondo lg:static lg:ml-auto"
                [attr.aria-label]="pendientes() + ' ' + ('nav.pendingAria' | translate)">
                {{ pendientes() }}
              </span>
            }
          </a>
        }
      </nav>
    </aside>
  `,
})
export class SidebarComponent {
  private readonly permissions = inject(PermissionsService);
  protected readonly avisos = inject(AvisosPendientes);

  // Se recalcula si cambia el rol (login/logout).
  protected readonly items = computed(() => {
    this.permissions.role();
    return NAV_ITEMS.filter((i) => this.permissions.canAccess(i.ruta));
  });

  protected readonly pendientes = computed(() => (this.permissions.canPerform('gestionar_avisos') ? this.avisos.total() : 0));
}
