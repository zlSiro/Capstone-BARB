import { Component, computed, input, output, signal } from '@angular/core';

import { WorkOrder, WorkOrderStatus } from '../../../../core/models';
import { ModalComponent } from '../../../../shared/components/ui/modal/modal.component';
import { statusMeta } from '../../utils/work-order-labels';

const MAX_COMMENT = 500;

/** Confirmación del cambio de estado: muestra de→a, qué implica y permite dejar un comentario para la auditoría. */
@Component({
  selector: 'app-ot-status-change-dialog',
  imports: [ModalComponent],
  template: `
    <app-modal [title]="'Cambiar estado de ' + order().numero_ot" [subtitle]="order().machine_name" (closed)="cancel()">
      <div class="flex flex-col gap-4 text-slate-200">
        <p class="flex flex-wrap items-center gap-2 text-sm">
          <span class="rounded-full px-2.5 py-1 text-xs font-medium" [class]="from().badge">{{ from().label }}</span>
          <span aria-hidden="true">→</span>
          <span class="sr-only">cambia a</span>
          <span class="rounded-full px-2.5 py-1 text-xs font-medium" [class]="destination().badge">{{ destination().label }}</span>
        </p>

        @if (destination().effect) {
          <p class="text-sm text-slate-300" [class.text-amber-300]="destination().final">{{ destination().effect }}</p>
        }

        <div class="flex flex-col gap-1">
          <label for="status-comment" class="text-sm font-medium">Comentario <span class="font-normal text-slate-400">(opcional)</span></label>
          <textarea
            id="status-comment"
            rows="3"
            [attr.maxlength]="maxComment"
            placeholder="Ej.: se reemplazó el rodamiento y se probó el equipo"
            class="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            [value]="comment()"
            (input)="comment.set($any($event.target).value)"></textarea>
          <p class="self-end text-xs text-slate-400">{{ comment().length }}/{{ maxComment }}</p>
        </div>

        @if (error()) {
          <p class="rounded border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-200" role="alert">{{ error() }}</p>
        }

        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary" [disabled]="submitting()" (click)="cancel()">Volver</button>
          <button
            type="button"
            [class]="to() === 'cancelled' ? dangerClass : 'btn-primary'"
            [disabled]="submitting()"
            (click)="confirmed.emit(comment().trim())">
            {{ submitting() ? 'Guardando…' : 'Confirmar cambio' }}
          </button>
        </div>
      </div>
    </app-modal>
  `,
})
export class OtStatusChangeDialogComponent {
  readonly order = input.required<WorkOrder>();
  readonly to = input.required<WorkOrderStatus>();
  readonly submitting = input(false);
  readonly error = input<string | null>(null);

  readonly confirmed = output<string>();
  readonly closed = output<void>();

  protected readonly maxComment = MAX_COMMENT;
  protected readonly dangerClass =
    'rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-60';
  protected readonly comment = signal('');
  protected readonly from = computed(() => statusMeta(this.order().estado));
  protected readonly destination = computed(() => statusMeta(this.to()));

  protected cancel(): void {
    if (!this.submitting()) this.closed.emit();
  }
}
