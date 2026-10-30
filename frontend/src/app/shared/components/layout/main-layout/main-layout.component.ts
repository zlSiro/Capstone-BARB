import { Component, computed, effect, inject, untracked } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';

import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { Aviso } from '../../../../core/models';
import { AvisosPendientes } from '../../../../core/services/avisos-pendientes';
import { Conexion } from '../../../../core/services/conexion';
import { ReportarFallaUi } from '../../../../core/services/reportar-falla-ui';
import { ReportarFalla } from '../../../../features/avisos/reportar-falla';
import { BottomNav } from '../bottom-nav/bottom-nav';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { Icon } from '../../ui/icon/icon';
import { ToastComponent } from '../../ui/toast/toast.component';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, BottomNav, ToastComponent, ReportarFalla, Icon, TranslatePipe],
  template: `
    <a
      href="#contenido"
      class="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded-control focus:bg-accion focus:px-4 focus:py-3 focus:text-sobre-accion">
      {{ 'nav.skipToContent' | translate }}
    </a>
    <div class="flex h-dvh flex-col overflow-hidden bg-fondo text-tinta">
      <app-header />
      @if (!conexion.enLinea()) {
        <p role="status" class="flex items-center gap-2 bg-senal-suave px-4 py-2 text-base text-tinta" data-testid="aviso-sin-conexion">
          <app-icon name="sin-conexion" [size]="20" />
          {{ 'nav.offline' | translate }}
        </p>
      }
      <div class="flex min-h-0 flex-1">
        <app-sidebar />
        <main id="contenido" tabindex="-1" [class]="mainClass()">
          <router-outlet />
        </main>
      </div>
      <app-bottom-nav />
      <app-toast />
      @defer (when reportarUi.abierto()) {
        @if (reportarUi.abierto()) {
          <app-reportar-falla (closed)="reportarUi.cerrar()" (created)="alCrear($event)" />
        }
      }
    </div>
  `
})
export class MainLayoutComponent {
  private readonly router = inject(Router);
  private readonly permissions = inject(PermissionsService);
  private readonly avisos = inject(AvisosPendientes);
  protected readonly reportarUi = inject(ReportarFallaUi);
  protected readonly conexion = inject(Conexion);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  constructor() {
    // Solo quien decide sobre los avisos (gestionar_avisos) necesita el conteo de pendientes.
    effect(() => {
      this.permissions.role();
      const gestiona = this.permissions.canPerform('gestionar_avisos');
      untracked(() => (gestiona ? this.avisos.iniciar() : this.avisos.detener()));
    });
  }

  protected alCrear(aviso: Aviso): void {
    this.avisos.marcarVisto(aviso.aviso_id);
    this.reportarUi.notificarCreado(aviso);
  }

  /** En móvil se deja espacio para la barra inferior (la altura de la barra más la zona segura del sistema). */
  readonly mainClass = computed(() => {
    const url = this.currentUrl();
    const base = 'min-w-0 flex-1 outline-none';
    if (url.startsWith('/chat')) return `${base} overflow-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0`;
    return `${base} overflow-auto p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-6`;
  });
}
