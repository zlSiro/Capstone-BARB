import { Component, computed, inject, input, output, signal } from '@angular/core';
import { form, required, validate, FormField } from '@angular/forms/signals';

import { Aviso } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { motivosDescarte } from './etiquetas';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
interface DescartarModel {
  motivo: string;
}

const MOTIVO_MINIMO = 3;

/** Diálogo con el que el supervisor descarta un aviso. El motivo es obligatorio y lo ve quien reportó la falla. */
@Component({
  selector: 'app-descartar-aviso',
  imports: [FormField, ModalComponent, TranslatePipe],
  template: `
    <app-modal [title]="'avisos.descartar_aviso' | translate" [subtitle]="'avisos.no_se_genera_una' | translate" (closed)="cerrar()">
      <div class="grid gap-4">
        <div class="rounded-control border border-borde bg-superficie-2 p-3 text-base">
          <p class="codigo text-lg text-tinta-suave">{{ aviso().numero_aviso }}, {{ aviso().machine_name }}</p>
          <p class="mt-1">{{ aviso().descripcion }}</p>
        </div>

        <div>
          <label for="descartar-motivo" class="fld-label">{{ 'avisos.motivo' | translate }}</label>
          <div class="mb-2 flex flex-wrap gap-2" role="group" [attr.aria-label]="'avisos.motivos_frecuentes' | translate">
            @for (m of motivos(); track m) {
              <button type="button" class="pill" [attr.aria-pressed]="model().motivo === m" (click)="elegirMotivo(m)">{{ m }}</button>
            }
          </div>
          <textarea
            id="descartar-motivo"
            rows="3"
            [formField]="descartarForm.motivo"
            [attr.aria-invalid]="descartarForm.motivo().touched() && descartarForm.motivo().invalid()"
            [attr.aria-describedby]="descartarForm.motivo().touched() && descartarForm.motivo().invalid() ? 'descartar-motivo-error' : null"
            [attr.placeholder]="'avisos.ej_ya_esta_cubierto' | translate"
            class="fld-input resize-none"></textarea>
          @if (descartarForm.motivo().touched() && descartarForm.motivo().invalid()) {
            <p id="descartar-motivo-error" role="alert" class="fld-error">{{ descartarForm.motivo().errors()[0]?.message | translate }}</p>
          }
        </div>
      </div>

      <div modal-footer class="grid gap-2 sm:flex sm:justify-end">
        <button type="button" class="btn-ghost order-2 sm:order-1" (click)="cerrar()">{{ 'avisos.cancelar' | translate }}</button>
        <button type="button" class="btn-danger order-1 sm:order-2" [disabled]="enviando()" (click)="descartar()">
          {{ (enviando() ? 'avisos.descartando' : 'avisos.descartar_aviso') | translate }}
        </button>
      </div>
    </app-modal>
  `,
})
export class DescartarAviso {
  private readonly i18n = inject(I18nService);
  private readonly api = inject(AvisosApi);
  private readonly toast = inject(ToastService);

  readonly aviso = input.required<Aviso>();
  readonly closed = output<void>();
  readonly done = output<Aviso>();

  protected readonly motivos = computed(() => motivosDescarte());
  protected readonly enviando = signal(false);

  protected readonly model = signal<DescartarModel>({ motivo: '' });
  protected readonly descartarForm = form(this.model, (f) => {
    required(f.motivo, { message: 'avisos.indica_el_motivo_del' });
    validate(f.motivo, ({ value }) =>
      value().trim().length >= MOTIVO_MINIMO ? undefined : { kind: 'short', message: 'avisos.el_motivo_debe_tener' });
  });

  protected cerrar(): void {
    this.closed.emit();
  }

  protected elegirMotivo(motivo: string): void {
    this.model.set({ motivo });
  }

  protected descartar(): void {
    if (this.enviando()) return;
    this.descartarForm().markAsTouched();
    if (!this.descartarForm().valid()) return;

    this.enviando.set(true);
    this.api.descartar(this.aviso().aviso_id, this.model().motivo.trim()).subscribe({
      next: (aviso) => {
        this.enviando.set(false);
        this.toast.success(this.i18n.tr('avisos.aviso_descartado', { v0: aviso.numero_aviso }));
        this.done.emit(aviso);
      },
      error: (err) => {
        this.enviando.set(false);
        this.toast.error(apiErrorMessage(err, this.i18n.tr('avisos.no_se_pudo_descartar')));
      },
    });
  }
}
