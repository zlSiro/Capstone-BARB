import { Component, input, model } from '@angular/core';

import { WorkOrderStatus } from '../../../../core/models';
import { STATUS_FILTER_ORDER, statusMeta } from '../../utils/work-order-labels';

/** Filtro por estado (con conteos) y búsqueda de texto. `status = ''` significa «todas». */
@Component({
  selector: 'app-ot-filter-bar',
  template: `
    <div class="flex flex-col gap-3">
      <div role="group" aria-label="Filtrar por estado" class="flex flex-wrap gap-2">
        <button type="button" class="chip" [class.chip-active]="status() === ''" [attr.aria-pressed]="status() === ''" (click)="status.set('')">
          Todas <span class="font-semibold">{{ counts()['all'] ?? 0 }}</span>
        </button>
        @for (s of statuses; track s) {
          <button type="button" class="chip" [class.chip-active]="status() === s" [attr.aria-pressed]="status() === s" (click)="status.set(s)">
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
          class="w-full max-w-md rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          [value]="search()"
          (input)="search.set($any($event.target).value)" />
      </div>
    </div>
  `,
  styles: [
    `
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        border: 1px solid #d1d5db;
        border-radius: 9999px;
        background: #fff;
        padding: 0.25rem 0.75rem;
        font-size: 0.8125rem;
        color: #374151;
      }
      .chip:hover {
        background: #f3f4f6;
      }
      .chip:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 2px;
      }
      .chip-active {
        border-color: #1d4ed8;
        background: #1d4ed8;
        color: #fff;
      }
      .chip-active:hover {
        background: #1e40af;
      }
    `,
  ],
})
export class OtFilterBarComponent {
  /** Cantidad de OT por estado, más la clave `all` con el total. */
  readonly counts = input.required<Record<string, number>>();
  readonly status = model<WorkOrderStatus>('');
  readonly search = model('');

  protected readonly statuses = STATUS_FILTER_ORDER;
  protected readonly label = (s: WorkOrderStatus) => statusMeta(s).label;
}
