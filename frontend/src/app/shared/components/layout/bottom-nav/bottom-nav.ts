import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { AuthService } from '../../../../core/services/auth.service';
import { AvisosPendientes } from '../../../../core/services/avisos-pendientes';
import { ReportarFallaUi } from '../../../../core/services/reportar-falla-ui';
import { ThemeService } from '../../../../core/services/theme.service';
import { Icon } from '../../ui/icon/icon';
import { ModalComponent } from '../../ui/modal/modal.component';
import { NAV_ITEMS, NavItem } from '../nav-items';

/**
 * Navegación inferior del móvil (la zona que alcanza el pulgar): hasta 3 destinos del rol, «Reportar falla» al centro
 * (para quien puede reportar) y «Más», que abre el resto de las pantallas, el tema, el idioma y la salida.
 * Desde `md` no se muestra: ahí manda el riel lateral.
 */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive, Icon, TranslatePipe, ModalComponent],
  template: `
    <nav
      class="fixed inset-x-0 bottom-0 z-40 border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden"
      [attr.aria-label]="'nav.bottomNav' | translate">
      <ul class="flex items-stretch">
        @for (item of principales(); track item.path; let i = $index) {
          @if (puedeReportar() && i === mitad()) {
            <li class="flex flex-1 items-start justify-center">
              <button
                type="button"
                data-testid="btn-reportar-nav"
                (click)="reportar()"
                class="-mt-5 inline-flex size-16 flex-col items-center justify-center rounded-full border-4 border-superficie bg-senal text-sobre-senal shadow-md"
                [attr.aria-label]="'nav.reportarFalla' | translate">
                <app-icon name="alerta" [size]="28" />
              </button>
            </li>
          }
          <li class="flex-1">
            <a
              [routerLink]="item.path"
              routerLinkActive="text-accion font-semibold"
              class="relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-sm text-tinta-suave">
              <app-icon [name]="item.icon" [size]="24" />
              <span class="max-w-full truncate">{{ ('nav.' + item.label + 'Corto') | translate }}</span>
              @if (item.ruta === 'avisos' && pendientes() > 0) {
                <span
                  class="codigo absolute right-[calc(50%-1.75rem)] top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-peligro px-1 text-sm text-fondo"
                  [attr.aria-label]="pendientes() + ' ' + ('nav.pendingAria' | translate)">
                  {{ pendientes() }}
                </span>
              }
            </a>
          </li>
        }
        @if (puedeReportar() && principales().length <= mitad()) {
          <li class="flex flex-1 items-start justify-center">
            <button
              type="button"
              data-testid="btn-reportar-nav"
              (click)="reportar()"
              class="-mt-5 inline-flex size-16 items-center justify-center rounded-full border-4 border-superficie bg-senal text-sobre-senal shadow-md"
              [attr.aria-label]="'nav.reportarFalla' | translate">
              <app-icon name="alerta" [size]="28" />
            </button>
          </li>
        }
        <li class="flex-1">
          <button
            type="button"
            data-testid="btn-mas"
            (click)="menuAbierto.set(true)"
            class="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-1 text-sm text-tinta-suave"
            aria-haspopup="dialog">
            <app-icon name="menu" [size]="24" />
            <span>{{ 'nav.more' | translate }}</span>
          </button>
        </li>
      </ul>
    </nav>

    @if (menuAbierto()) {
      <app-modal [title]="'nav.menuTitle' | translate" [subtitle]="usuario()" (closed)="menuAbierto.set(false)">
        <nav [attr.aria-label]="'nav.mainNav' | translate">
          <ul class="grid gap-1">
            @for (item of resto(); track item.path) {
              <li>
                <a
                  [routerLink]="item.path"
                  (click)="menuAbierto.set(false)"
                  class="flex min-h-12 items-center gap-3 rounded-control px-3 text-base text-tinta hover:bg-superficie-2">
                  <app-icon [name]="item.icon" [size]="24" />
                  {{ ('nav.' + item.label) | translate }}
                </a>
              </li>
            }
          </ul>
        </nav>

        <div class="mt-4 grid gap-2 border-t border-borde pt-4">
          <button type="button" class="btn-secondary justify-start" (click)="theme.toggle()">
            <app-icon [name]="theme.dark() ? 'sol' : 'luna'" [size]="22" />
            {{ (theme.dark() ? 'nav.themeLight' : 'nav.themeDark') | translate }}
          </button>
          <button type="button" class="btn-secondary justify-start" (click)="i18n.toggleLang()">
            <app-icon name="idioma" [size]="22" />
            {{ 'nav.language' | translate }}: {{ i18n.lang() === 'es' ? 'Español' : 'English' }}
          </button>
          <button type="button" class="btn-danger justify-start" data-testid="btn-salir-menu" (click)="salir()">
            <app-icon name="salir" [size]="22" />
            {{ 'topbar.logout' | translate }}
          </button>
        </div>
      </app-modal>
    }
  `,
})
export class BottomNav {
  private readonly permissions = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly avisos = inject(AvisosPendientes);
  private readonly reportarUi = inject(ReportarFallaUi);
  protected readonly theme = inject(ThemeService);
  protected readonly i18n = inject(I18nService);

  protected readonly menuAbierto = signal(false);

  private readonly accesibles = computed<NavItem[]>(() => {
    this.permissions.role();
    return NAV_ITEMS.filter((i) => this.permissions.canAccess(i.ruta)).sort((a, b) => a.prioridad - b.prioridad);
  });

  protected readonly puedeReportar = computed(() => {
    this.permissions.role();
    return this.permissions.canPerform('reportar_falla');
  });

  /** Con el botón central caben 3 destinos más «Más»; sin él, 4. */
  private readonly cupo = computed(() => (this.puedeReportar() ? 3 : 4));
  protected readonly principales = computed(() => {
    const n = this.accesibles().length;
    // Si todo cabe sin necesitar «Más», igual se deja «Más» para tema/idioma/salir: se reserva un lugar.
    return this.accesibles().slice(0, Math.min(this.cupo(), n));
  });
  protected readonly resto = computed(() => this.accesibles().slice(this.principales().length));

  /** Posición del botón central: en medio de los destinos. */
  protected readonly mitad = computed(() => Math.ceil(this.principales().length / 2));

  protected readonly pendientes = computed(() => (this.permissions.canPerform('gestionar_avisos') ? this.avisos.total() : 0));
  protected readonly usuario = computed(() => {
    const u = this.auth.user();
    return u ? `${u.name}, ${u.role}` : '';
  });

  protected reportar(): void {
    this.reportarUi.abrir();
  }

  protected salir(): void {
    if (!confirm(this.i18n.get('topbar', 'logoutConfirm'))) return;
    this.menuAbierto.set(false);
    this.auth.logout();
  }
}
