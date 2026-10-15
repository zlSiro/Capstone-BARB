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

// Vistas que ya ofrecen su propia forma lógica de salir o volver (no llevan el "Volver" global):
// el detalle de topología navega al nodo padre y el historial de chat tiene "← Volver al chat".
const RUTAS_CON_SALIDA_PROPIA = ['/topology', '/topologia', '/chat/history'];

@Component({
  selector: 'app-header',
  imports: [TranslatePipe],
  template: `
    <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between transition-colors">
      <div class="flex items-center gap-3">
        <span class="text-2xl" aria-hidden="true">🏭</span>
        <h1 class="text-lg font-bold text-gray-800 dark:text-gray-100">{{ 'login.title' | translate }}</h1>
        @if (auth.user()?.empresa_nombre) {
          <span class="text-sm text-gray-600 dark:text-gray-300 border-l border-gray-300 dark:border-gray-600 pl-3">
            {{ auth.user()?.empresa_nombre }}
          </span>
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
        @if (mostrarVolver()) {
          <button
            type="button"
            data-testid="btn-volver"
            (click)="volver()"
            class="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium">
            <span aria-hidden="true">←</span> {{ 'common.back' | translate }}
          </button>
        }
        <button type="button" data-testid="btn-salir" (click)="salir()" class="text-sm text-red-600 dark:text-red-400 hover:text-red-800">
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
