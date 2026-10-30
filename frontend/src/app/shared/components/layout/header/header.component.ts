import { Component, computed, inject } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, scan, startWith } from 'rxjs/operators';
import { AuthService } from '../../../../core/services/auth.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { getDefaultRouteForRole } from '../../../../core/permissions/permissions';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { ReportarFallaUi } from '../../../../core/services/reportar-falla-ui';
import { Icon } from '../../ui/icon/icon';

// Vistas que ya ofrecen su propia forma lógica de salir o volver (no llevan el "Volver" global):
// el detalle de topología navega al nodo padre y el historial de chat tiene "← Volver al chat".
const RUTAS_CON_SALIDA_PROPIA = ['/topology', '/topologia', '/chat/history'];

@Component({
  selector: 'app-header',
  imports: [TranslatePipe, Icon],
  template: `
    <header class="flex min-h-14 items-center justify-between gap-3 border-b border-borde bg-superficie px-4 md:px-6">
      <div class="flex min-w-0 items-center gap-2">
        @if (mostrarVolver()) {
          <button
            type="button"
            data-testid="btn-volver"
            (click)="volver()"
            class="-ml-2 inline-flex size-12 shrink-0 items-center justify-center rounded-control text-tinta hover:bg-superficie-2 md:size-10"
            [attr.aria-label]="'common.back' | translate">
            <app-icon name="atras" [size]="24" />
          </button>
        }
        <h1 class="codigo shrink-0 text-2xl font-bold tracking-wide text-accion">{{ 'login.title' | translate }}</h1>
        @if (auth.user()?.empresa_nombre) {
          <span class="min-w-0 truncate border-l border-borde pl-3 text-base text-tinta-suave">{{ auth.user()?.empresa_nombre }}</span>
        }
      </div>

      <div class="flex items-center gap-1 md:gap-2">
        @if (puedeReportar()) {
          <button type="button" class="btn-senal hidden md:inline-flex" data-testid="btn-reportar-header" (click)="reportar()">
            <app-icon name="alerta" [size]="20" />
            {{ 'nav.reportarFalla' | translate }}
          </button>
        }
        <span class="hidden text-base text-tinta lg:inline">{{ auth.user()?.name }}</span>
        <span class="chip chip-accion hidden md:inline-flex">{{ auth.user()?.role }}</span>
        <button
          type="button"
          (click)="theme.toggle()"
          class="hidden size-10 items-center justify-center rounded-control text-tinta hover:bg-superficie-2 md:inline-flex"
          [attr.aria-label]="(theme.dark() ? 'nav.themeLight' : 'nav.themeDark') | translate">
          <app-icon [name]="theme.dark() ? 'sol' : 'luna'" [size]="22" />
        </button>
        <button
          type="button"
          (click)="i18n.toggleLang()"
          class="hidden min-h-10 items-center gap-1.5 rounded-control px-2 text-base font-medium text-tinta hover:bg-superficie-2 md:inline-flex"
          [attr.aria-label]="('nav.language' | translate) + ': ' + (i18n.lang() === 'es' ? 'ES' : 'EN')">
          <app-icon name="idioma" [size]="20" />
          {{ i18n.lang() === 'es' ? 'ES' : 'EN' }}
        </button>
        <button type="button" data-testid="btn-salir" (click)="salir()" class="btn-danger hidden md:inline-flex">
          <app-icon name="salir" [size]="20" />
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
  private readonly router = inject(Router);
  private readonly permissions = inject(PermissionsService);
  private readonly reportarUi = inject(ReportarFallaUi);

  protected readonly puedeReportar = computed(() => {
    this.permissions.role();
    return this.permissions.canPerform('reportar_falla');
  });

  protected reportar(): void {
    this.reportarUi.abrir();
  }
  private readonly location = inject(Location);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Navegaciones hechas desde que se cargó la cabecera: con una sola no hay historial al que volver. */
  private readonly navegaciones = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      scan((total) => total + 1, 0),
      startWith(0),
    ),
    { initialValue: 0 },
  );

  private readonly inicio = computed(() => getDefaultRouteForRole(this.auth.user()?.role));

  /** Se oculta en la página de inicio del rol (no hay a dónde volver) y en vistas con salida propia. */
  protected readonly mostrarVolver = computed(() => {
    const ruta = this.currentUrl().split(/[?#]/)[0];
    return ruta !== this.inicio() && !RUTAS_CON_SALIDA_PROPIA.some((r) => ruta === r || ruta.startsWith(r + '/'));
  });

  protected volver(): void {
    // Con historial dentro de la app se retrocede un paso; si se entró directo por URL, se va al inicio del rol.
    if (this.navegaciones() > 1) this.location.back();
    else this.router.navigateByUrl(this.inicio());
  }

  /** Pide confirmación: si se cancela, la sesión queda intacta y el usuario sigue en la misma vista. */
  protected salir(): void {
    if (!confirm(this.i18n.get('topbar', 'logoutConfirm'))) return;
    this.auth.logout();
  }
}
