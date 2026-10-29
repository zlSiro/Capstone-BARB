import { Component, computed, input } from '@angular/core';

import { WorkOrderSeverity } from '../../core/models';
import { gravedadMeta } from './etiquetas';

/** Gravedad de un aviso: cuatro barras que se llenan (como la señal de un celular) y siempre el texto. No depende del color. */
@Component({
  selector: 'app-gravedad',
  template: `
    <span class="inline-flex items-center gap-2" role="img" [attr.aria-label]="'Gravedad ' + meta().label">
      <span class="flex items-end gap-0.5" aria-hidden="true" [class]="meta().texto">
        @for (barra of barras; track barra) {
          <span
            class="w-1.5 rounded-sm"
            [style.height.px]="6 + barra * 4"
            [class]="barra <= meta().nivel ? 'bg-current' : 'bg-borde'"></span>
        }
      </span>
      <span class="text-sm font-semibold text-tinta" aria-hidden="true">{{ meta().label }}</span>
    </span>
  `,
})
export class GravedadMedidor {
  readonly severidad = input<WorkOrderSeverity | null>('medium');

  protected readonly barras = [1, 2, 3, 4];
  protected readonly meta = computed(() => gravedadMeta(this.severidad()));
}
