import { Component, computed, input, output } from '@angular/core';

import { Control } from '../../../core/models';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { Icon } from '../../../shared/components/ui/icon/icon';
import { controlesFallidos, exportacionPermitida } from './cuadratura';

/**
 * Panel «Cuadratura»: cada control compara una cifra del reporte con otra fuente. Con un control en ✗ la exportación queda
 * deshabilitada (lo decide la página con `exportacionPermitida`) y aquí se explica el motivo y se ofrece volver a cargar.
 */
@Component({
  selector: 'app-cuadratura-panel',
  imports: [Icon, TranslatePipe],
  template: `
    <section class="panel flex flex-col gap-2 p-4 print:break-inside-avoid" aria-labelledby="cuadratura-titulo" data-testid="cuadratura" data-tour="reporte-cuadratura">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cuadratura-titulo" class="text-lg font-bold text-tinta">{{ 'reportes.cuadratura_titulo' | translate }}</h2>
        <span class="chip" [class.chip-ok]="ok()" [class.chip-peligro]="!ok()" data-testid="cuadratura-estado">
          <app-icon [name]="ok() ? 'check-circulo' : 'alerta'" [size]="18" />
          {{ (ok() ? 'reportes.cuadratura_ok' : 'reportes.cuadratura_falla') | translate }}
        </span>
      </div>
      <ul class="flex flex-col gap-1">
        @for (c of controles(); track c.id) {
          <li class="flex items-start gap-2 text-sm text-tinta" [attr.data-testid]="'control-' + c.id" [attr.data-ok]="c.ok">
            <app-icon [name]="c.ok ? 'check' : 'x'" [size]="16" [class]="c.ok ? 'mt-0.5 text-ok' : 'mt-0.5 text-peligro'" />
            <span>
              <span class="sr-only">{{ (c.ok ? 'reportes.control_ok' : 'reportes.control_falla') | translate }}: </span>{{ c.detalle }}
            </span>
          </li>
        } @empty {
          <li class="text-sm text-tinta-suave">{{ 'reportes.cuadratura_sin_controles' | translate }}</li>
        }
      </ul>
      @if (!ok()) {
        <div class="flex flex-wrap items-center gap-3 print:hidden" role="alert" data-testid="cuadratura-bloqueo">
          <p class="text-sm font-medium text-peligro">{{ 'reportes.export_bloqueada' | translate: { v0: fallidos().length } }}</p>
          <button type="button" class="btn-secondary" (click)="recargar.emit()">
            <app-icon name="refrescar" [size]="18" />
            {{ 'reportes.volver_a_cargar' | translate }}
          </button>
        </div>
      }
    </section>
  `,
})
export class CuadraturaPanelComponent {
  readonly controles = input.required<readonly Control[]>();
  readonly recargar = output<void>();
  protected readonly ok = computed(() => exportacionPermitida(this.controles()));
  protected readonly fallidos = computed(() => controlesFallidos(this.controles()));
}
