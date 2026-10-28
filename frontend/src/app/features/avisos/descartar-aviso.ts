import { Component, inject, input, output, signal } from '@angular/core';
import { form, required, validate, FormField } from '@angular/forms/signals';

import { Aviso } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';

interface DescartarModel {
  motivo: string;
}

const MOTIVO_MINIMO = 3;

/** Diálogo con el que el supervisor descarta un aviso. El motivo es obligatorio y lo ve quien reportó la falla. */
@Component({
  selector: 'app-descartar-aviso',
  imports: [FormField],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" (click)="cerrar()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="descartar-title"
        class="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="descartar-title" class="text-xl font-bold text-slate-100">Descartar aviso</h2>
            <p class="text-sm text-slate-400">No se genera una OT. Quien reportó verá el motivo.</p>
          </div>
          <button type="button" (click)="cerrar()" class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Cerrar">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div class="grid gap-4 px-6 py-5">
          <div class="rounded border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-200">
            <p class="font-mono text-xs text-slate-400">{{ aviso().numero_aviso }} · {{ aviso().machine_name }}</p>
            <p class="mt-1">{{ aviso().descripcion }}</p>
          </div>

          <div>
            <label for="descartar-motivo" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Motivo *</label>
            <textarea
              id="descartar-motivo"
              rows="3"
              [formField]="descartarForm.motivo"
              [attr.aria-invalid]="descartarForm.motivo().touched() && descartarForm.motivo().invalid()"
              [attr.aria-describedby]="descartarForm.motivo().touched() && descartarForm.motivo().invalid() ? 'descartar-motivo-error' : null"
              placeholder="Ej. Ya está cubierto por la OT-2026-0012."
              class="w-full resize-none rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            @if (descartarForm.motivo().touched() && descartarForm.motivo().invalid()) {
              <p id="descartar-motivo-error" role="alert" class="mt-1 text-xs text-red-400">{{ descartarForm.motivo().errors()[0]?.message }}</p>
            }
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <button type="button" (click)="cerrar()" class="text-sm font-medium text-slate-300 hover:text-white">Cancelar</button>
          <button
            type="button"
            [disabled]="enviando()"
            (click)="descartar()"
            class="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-900">
            {{ enviando() ? 'Descartando…' : 'Descartar aviso' }}
          </button>
        </div>
      </div>
    </div>
  `,
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class DescartarAviso {
  private readonly api = inject(AvisosApi);
  private readonly toast = inject(ToastService);

  readonly aviso = input.required<Aviso>();
  readonly closed = output<void>();
  readonly done = output<Aviso>();

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
