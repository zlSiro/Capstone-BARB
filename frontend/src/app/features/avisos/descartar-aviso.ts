import { Component, inject, input, output, signal } from '@angular/core';
import { form, required, validate, FormField } from '@angular/forms/signals';

import { Aviso } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { MOTIVOS_DESCARTE } from './etiquetas';

interface DescartarModel {
  motivo: string;
}

const MOTIVO_MINIMO = 3;

/** Diálogo con el que el supervisor descarta un aviso. El motivo es obligatorio y lo ve quien reportó la falla. */
@Component({
  selector: 'app-descartar-aviso',
  imports: [FormField, ModalComponent],
  template: `
    <app-modal title="Descartar aviso" subtitle="No se genera una OT. Quien reportó verá el motivo." (closed)="cerrar()">
      <div class="grid gap-4">
        <div class="rounded-control border border-borde bg-superficie-2 p-3 text-base">
          <p class="codigo text-lg text-tinta-suave">{{ aviso().numero_aviso }}, {{ aviso().machine_name }}</p>
          <p class="mt-1">{{ aviso().descripcion }}</p>
        </div>

        <div>
          <label for="descartar-motivo" class="fld-label">Motivo</label>
          <div class="mb-2 flex flex-wrap gap-2" role="group" aria-label="Motivos frecuentes">
            @for (m of motivos; track m) {
              <button type="button" class="pill" [attr.aria-pressed]="model().motivo === m" (click)="elegirMotivo(m)">{{ m }}</button>
            }
          </div>
          <textarea
            id="descartar-motivo"
            rows="3"
            [formField]="descartarForm.motivo"
            [attr.aria-invalid]="descartarForm.motivo().touched() && descartarForm.motivo().invalid()"
            [attr.aria-describedby]="descartarForm.motivo().touched() && descartarForm.motivo().invalid() ? 'descartar-motivo-error' : null"
            placeholder="Ej. Ya está cubierto por la OT-2026-0012."
            class="fld-input resize-none"></textarea>
          @if (descartarForm.motivo().touched() && descartarForm.motivo().invalid()) {
            <p id="descartar-motivo-error" role="alert" class="fld-error">{{ descartarForm.motivo().errors()[0]?.message }}</p>
          }
        </div>
      </div>

      <div modal-footer class="grid gap-2 sm:flex sm:justify-end">
        <button type="button" class="btn-ghost order-2 sm:order-1" (click)="cerrar()">Cancelar</button>
        <button type="button" class="btn-danger order-1 sm:order-2" [disabled]="enviando()" (click)="descartar()">
          {{ enviando() ? 'Descartando…' : 'Descartar aviso' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class DescartarAviso {
  private readonly api = inject(AvisosApi);
  private readonly toast = inject(ToastService);

  readonly aviso = input.required<Aviso>();
  readonly closed = output<void>();
  readonly done = output<Aviso>();

  protected readonly motivos = MOTIVOS_DESCARTE;
  protected readonly enviando = signal(false);

  protected readonly model = signal<DescartarModel>({ motivo: '' });
  protected readonly descartarForm = form(this.model, (f) => {
    required(f.motivo, { message: 'Indica el motivo del descarte.' });
    validate(f.motivo, ({ value }) =>
      value().trim().length >= MOTIVO_MINIMO ? undefined : { kind: 'short', message: `El motivo debe tener al menos ${MOTIVO_MINIMO} caracteres.` });
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
        this.toast.success(`Aviso ${aviso.numero_aviso} descartado.`);
        this.done.emit(aviso);
      },
      error: (err) => {
        this.enviando.set(false);
        this.toast.error(apiErrorMessage(err, 'No se pudo descartar el aviso.'));
      },
    });
  }
}
