import { Component, computed, input, output, signal } from '@angular/core';

import { WorkOrder, WorkOrderStatus } from '../../../../core/models';
import { ModalComponent } from '../../../../shared/components/ui/modal/modal.component';
import { textoActual } from '../../../../core/i18n/i18n.service';
import { statusMeta } from '../../utils/work-order-labels';

import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
const MAX_COMMENT = 500;

/** Confirmación del cambio de estado: muestra de→a, qué implica y permite dejar un comentario para la auditoría. */
@Component({
  selector: 'app-ot-status-change-dialog',
  imports: [ModalComponent, TranslatePipe],
  template: `
    <app-modal [title]="'ot.cambiar_estado_de' | translate: { v0: order().numero_ot }" [subtitle]="order().machine_name" (closed)="cancel()">
      <div class="flex flex-col gap-4 text-tinta">
        <p class="flex flex-wrap items-center gap-2 text-sm">
          <span class="rounded-full px-2.5 py-1 text-sm font-medium" [class]="from().badge">{{ from().label }}</span>
          <span aria-hidden="true">→</span>
          <span class="sr-only">{{ 'ot.cambia_a' | translate }}</span>
          <span class="rounded-full px-2.5 py-1 text-sm font-medium" [class]="destination().badge">{{ destination().label }}</span>
        </p>

        @if (destination().effect) {
          <p class="text-sm text-tinta-suave" [class.text-media]="destination().final">{{ destination().effect }}</p>
        }

        <div class="flex flex-col gap-1">
          <label for="status-comment" class="text-sm font-medium">{{ 'ot.comentario' | translate }} <span class="font-normal text-tinta-suave">{{ (requiereComentario() ? 'ot.obligatorio' : 'ot.opcional') | translate }}</span></label>
          <textarea
            id="status-comment"
            rows="3"
            [attr.maxlength]="maxComment"
            [attr.aria-required]="requiereComentario()"
            [attr.placeholder]="'ot.ej_se_reemplazo_el' | translate"
            class="w-full rounded-control border border-borde bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-suave focus:outline-none focus:ring-2 focus:ring-accion"
            [value]="comment()"
            (input)="comment.set($any($event.target).value)"></textarea>
          <p class="self-end text-sm text-tinta-suave">{{ comment().length }}/{{ maxComment }}</p>
        </div>

        @if (requiereComentario() && !comment().trim()) {
          <p class="text-sm text-tinta-suave" data-testid="comentario-obligatorio">{{ (to() === 'cancelled' ? 'ot.indica_el_motivo_de_la_cancelacion' : 'ot.indica_la_razon_de_la_devolucion') | translate }}</p>
        }

        @if (error()) {
          <p class="rounded-control border border-peligro bg-peligro-suave px-3 py-2 text-sm text-peligro" role="alert">{{ error() }}</p>
        }

        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary" [disabled]="submitting()" (click)="cancel()">{{ 'ot.volver' | translate }}</button>
          <button
            type="button"
            [class]="to() === 'cancelled' ? dangerClass : 'btn-primary'"
            [disabled]="submitting() || (requiereComentario() && !comment().trim())"
            (click)="confirmed.emit(comment().trim())">
            {{ (submitting() ? 'ot.guardando' : 'ot.confirmar_cambio') | translate }}
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
    'rounded-control bg-peligro px-4 py-2 text-sm font-semibold text-sobre-accion transition hover:bg-peligro focus:outline-none focus:ring-2 focus:ring-peligro disabled:cursor-not-allowed disabled:opacity-60';
  protected readonly comment = signal('');
  protected readonly from = computed(() => statusMeta(this.order().estado));
  protected readonly destination = computed(() => {
    const meta = statusMeta(this.to());
    // Devolver una OT por validar no inicia los trabajos: explica que vuelve a corrección.
    return this.order().estado === 'por_validar' && this.to() === 'in_progress'
      ? { ...meta, effect: textoActual('ot.se_devuelve_a_en_curso') }
      : meta;
  });
  /** Cancelar exige el motivo y devolver una OT por validar exige la razón (el backend responde 422 si falta). */
  protected readonly requiereComentario = computed(
    () => this.to() === 'cancelled' || (this.order().estado === 'por_validar' && this.to() === 'in_progress'),
  );

  protected cancel(): void {
    if (!this.submitting()) this.closed.emit();
  }
}
