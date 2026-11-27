import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { Icon } from '../../shared/components/ui/icon/icon';
import { biblioteca } from './reportes-catalogo';

/** Biblioteca de reportes: solo los que el perfil puede abrir, agrupados; un grupo sin reportes no se muestra. */
@Component({
  selector: 'app-reportes-biblioteca',
  imports: [Icon, RouterLink, TranslatePipe],
  template: `
    <section class="flex flex-col gap-5" aria-labelledby="reportes-titulo">
      <div class="min-w-0">
        <h1 id="reportes-titulo" class="text-3xl font-bold leading-tight text-tinta">{{ 'reportes.titulo' | translate }}</h1>
        <p class="mt-1 max-w-prose text-base text-tinta-suave">{{ 'reportes.subtitulo' | translate }}</p>
      </div>

      <div class="flex flex-col gap-5" data-tour="reportes-biblioteca">
      @for (g of grupos(); track g.grupo) {
        <section class="flex flex-col gap-3" [attr.aria-labelledby]="'grupo-' + g.grupo" [attr.data-testid]="'grupo-' + g.grupo">
          <h2 [id]="'grupo-' + g.grupo" class="text-xl font-bold text-tinta">{{ 'reportes.grupo_' + g.grupo | translate }}</h2>
          <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            @for (r of g.reportes; track r.id) {
              <li>
                <a
                  class="panel flex h-full flex-col gap-2 p-4 text-left no-underline transition-colors hover:border-accion focus-visible:outline-2"
                  [routerLink]="['/reportes', r.id]"
                  [attr.data-testid]="'reporte-' + r.id">
                  <span class="flex items-center gap-2 text-lg font-semibold text-tinta">
                    <app-icon name="reportes" [size]="22" class="text-accion" />
                    {{ 'reportes.' + r.id + '_titulo' | translate }}
                  </span>
                  <span class="text-sm text-tinta-suave">{{ 'reportes.' + r.id + '_desc' | translate }}</span>
                  <span class="mt-auto pt-1 text-sm font-semibold text-accion">{{ 'reportes.abrir' | translate }}</span>
                </a>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p class="text-base text-tinta-suave" data-testid="reportes-vacio">{{ 'reportes.sin_reportes' | translate }}</p>
      }
      </div>
    </section>
  `,
})
export class ReportesBibliotecaComponent {
  private readonly permisos = inject(PermissionsService);
  protected readonly grupos = computed(() => biblioteca(this.permisos));
}
