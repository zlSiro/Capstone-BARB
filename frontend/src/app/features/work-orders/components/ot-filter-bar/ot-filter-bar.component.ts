import { Component, input, model } from '@angular/core';

import { WorkOrderStatus } from '../../../../core/models';
import { STATUS_FILTER_ORDER, statusMeta } from '../../utils/work-order-labels';

/** Filtro por estado (con conteos) y búsqueda de texto. `status = ''` significa «todas». */
@Component({
  selector: 'app-ot-filter-bar',
  template: `
    <div class="flex flex-col gap-3">
      <div role="group" aria-label="Filtrar por estado" class="flex flex-wrap gap-2">
        <button type="button" class="pill" [attr.aria-pressed]="status() === ''" (click)="status.set('')">
          Todas <span class="font-semibold">{{ counts()['all'] ?? 0 }}</span>
        </button>
        @for (s of statuses; track s) {
          <button type="button" class="pill" [attr.aria-pressed]="status() === s" (click)="status.set(s)">
            {{ label(s) }} <span class="font-semibold">{{ counts()[s] ?? 0 }}</span>
          </button>
        }
      </div>
      <div>
        <label for="ot-search" class="sr-only">Buscar orden de trabajo</label>
        <input
          id="ot-search"
          type="search"
          placeholder="Buscar por N° OT, máquina, técnico o descripción…"
          class="fld-input max-w-md"
          [value]="search()"
          (input)="search.set($any($event.target).value)" />
      </div>
    </div>
  `,
})
export class OtFilterBarComponent {
  /** Cantidad de OT por estado, más la clave `all` con el total. */
  readonly counts = input.required<Record<string, number>>();
  readonly status = model<WorkOrderStatus>('');
  readonly search = model('');

  protected readonly statuses = STATUS_FILTER_ORDER;
  protected readonly label = (s: WorkOrderStatus) => statusMeta(s).label;
}
