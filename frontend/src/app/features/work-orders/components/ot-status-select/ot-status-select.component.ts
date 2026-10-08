import { Component, computed, input, output } from '@angular/core';

import { WorkOrder, WorkOrderStatus } from '../../../../core/models';
import { statusMeta } from '../../utils/work-order-labels';
import { OtStatusBadgeComponent } from '../ot-status-badge/ot-status-badge.component';

export interface StatusChangeRequest {
  order: WorkOrder;
  to: WorkOrderStatus;
}

/**
 * Selector de estado de una OT. Solo ofrece los destinos que el backend declara
 * en `allowed_transitions` (máquina de estados + rol), así que no duplica reglas.
 * Si no hay destinos (estado final o rol sin permiso) muestra solo la etiqueta.
 * No cambia nada por sí mismo: emite `changeRequested` y el padre confirma y aplica.
 */
@Component({
  selector: 'app-ot-status-select',
  imports: [OtStatusBadgeComponent],
  template: `
    @if (options().length) {
      <select
        class="rounded-md border border-gray-300 bg-white py-1 pl-2 pr-7 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        [attr.aria-label]="'Cambiar estado de la OT ' + order().numero_ot + '. Estado actual: ' + currentLabel()"
        (change)="onChange($event)">
        <option [value]="order().estado" selected>{{ currentLabel() }}</option>
        @for (opt of options(); track opt.value) {
          <option [value]="opt.value">→ {{ opt.label }}</option>
        }
      </select>
    } @else {
      <app-ot-status-badge [estado]="order().estado" />
    }
  `,
})
export class OtStatusSelectComponent {
  readonly order = input.required<WorkOrder>();
  readonly changeRequested = output<StatusChangeRequest>();

  protected readonly currentLabel = computed(() => statusMeta(this.order().estado).label);
  protected readonly options = computed(() =>
    (this.order().allowed_transitions ?? []).map(value => ({ value, label: statusMeta(value).label })),
  );

  protected onChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const to = select.value as WorkOrderStatus;
    // El cambio real ocurre tras confirmar: el selector vuelve al estado vigente.
    select.value = this.order().estado;
    if (to !== this.order().estado) {
      this.changeRequested.emit({ order: this.order(), to });
    }
  }
}
