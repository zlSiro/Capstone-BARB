import { Component, computed, input } from '@angular/core';

import { WorkOrderStatus } from '../../../../core/models';
import { statusMeta } from '../../utils/work-order-labels';

/** Etiqueta de estado: punto de color + texto (el color nunca es el único indicador). */
@Component({
  selector: 'app-ot-status-badge',
  template: `
    <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" [class]="meta().badge">
      <span class="size-2 rounded-full" [class]="meta().dot" aria-hidden="true"></span>
      {{ meta().label }}
    </span>
  `,
})
export class OtStatusBadgeComponent {
  readonly estado = input.required<WorkOrderStatus>();
  protected readonly meta = computed(() => statusMeta(this.estado()));
}
