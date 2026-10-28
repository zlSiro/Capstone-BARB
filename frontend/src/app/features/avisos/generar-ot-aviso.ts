import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { form, required, FormField } from '@angular/forms/signals';

import { Aviso, AvisoGenerarOtResponse, Technician, WorkOrderPriority } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { PRIORIDADES, gravedadMeta, prioridadSugerida } from './etiquetas';

interface GenerarOtModel {
  technicianId: string;
  priority: WorkOrderPriority;
  /** `datetime-local` (hora local). Vacío = el backend calcula el vencimiento según el SLA de la máquina. */
  vencimiento: string;
}

/** Diálogo con el que el supervisor atiende un aviso: elige técnico y prioridad, y se genera la OT enlazada. */
@Component({
  selector: 'app-generar-ot-aviso',
  imports: [FormField],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" (click)="cerrar()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="generar-ot-title"
        class="max-h-full w-full max-w-xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="generar-ot-title" class="text-xl font-bold text-slate-100">Generar OT desde el aviso</h2>
            <p class="text-sm text-slate-400">Se crea una orden de trabajo asignada y el aviso queda «Con OT».</p>
          </div>
          <button type="button" (click)="cerrar()" class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Cerrar">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div class="grid gap-4 px-6 py-5">
          <div class="rounded border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-200">
            <p class="font-mono text-xs text-slate-400">{{ aviso().numero_aviso }} · {{ aviso().machine_name }} · {{ aviso().plant_name }}</p>
            <p class="mt-1">{{ aviso().descripcion }}</p>
            <p class="mt-2 text-xs text-slate-400">
              Reportado por {{ aviso().reportado_por.nombre }} · gravedad percibida: {{ gravedad().label }}
            </p>
            @if (aviso().foto) {
              <p class="mt-1 text-xs text-slate-300"><span aria-hidden="true">📎</span> La foto del aviso se adjuntará a la OT.</p>
            }
          </div>

          <div>
            <label for="gen-tecnico" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Técnico responsable *</label>
            <select
              id="gen-tecnico"
              [formField]="otForm.technicianId"
              [attr.aria-invalid]="otForm.technicianId().touched() && otForm.technicianId().invalid()"
              [attr.aria-describedby]="otForm.technicianId().touched() && otForm.technicianId().invalid() ? 'gen-tecnico-error' : null"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona un técnico</option>
              @for (t of technicians(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            @if (otForm.technicianId().touched() && otForm.technicianId().invalid()) {
              <p id="gen-tecnico-error" role="alert" class="mt-1 text-xs text-red-400">{{ otForm.technicianId().errors()[0]?.message }}</p>
            }
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label for="gen-prioridad" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Prioridad</label>
              <select
                id="gen-prioridad"
                [formField]="otForm.priority"
                class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                @for (p of prioridades; track p.value) {
                  <option [value]="p.value">{{ p.label }}</option>
                }
              </select>
              <p class="mt-1 text-xs text-slate-400">Sugerida según la gravedad del aviso.</p>
            </div>
            <div>
              <label for="gen-vencimiento" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Vencimiento (opcional)</label>
              <input
                id="gen-vencimiento"
                type="datetime-local"
                [formField]="otForm.vencimiento"
                class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p class="mt-1 text-xs text-slate-400">Si lo dejas vacío se calcula con el SLA de la máquina.</p>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <button type="button" (click)="cerrar()" class="text-sm font-medium text-slate-300 hover:text-white">Cancelar</button>
          <button
            type="button"
            [disabled]="enviando()"
            (click)="generar()"
            class="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-800">
            {{ enviando() ? 'Generando…' : 'Generar OT' }}
          </button>
        </div>
      </div>
    </div>
  `,
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class GenerarOtAviso implements OnInit {
  private readonly api = inject(AvisosApi);
  private readonly catalog = inject(CatalogService);
  private readonly toast = inject(ToastService);

  readonly aviso = input.required<Aviso>();
  readonly closed = output<void>();
  readonly done = output<AvisoGenerarOtResponse>();

  protected readonly prioridades = PRIORIDADES;
  protected readonly technicians = signal<Technician[]>([]);
  protected readonly enviando = signal(false);

  protected readonly model = signal<GenerarOtModel>({ technicianId: '', priority: 'medium', vencimiento: '' });
  protected readonly otForm = form(this.model, (f) => {
    required(f.technicianId, { message: 'Selecciona un técnico.' });
  });

  protected gravedad() {
    return gravedadMeta(this.aviso().severidad);
  }

  constructor() {
    this.catalog.getTechnicians().subscribe({
      next: (technicians) => this.technicians.set(technicians ?? []),
      error: () => this.toast.error('No se pudo cargar la lista de técnicos.'),
    });
  }

  ngOnInit(): void {
    // La prioridad parte de la gravedad que percibió quien reportó; el supervisor la ajusta.
    this.model.update((m) => ({ ...m, priority: prioridadSugerida(this.aviso().severidad) }));
  }

  protected cerrar(): void {
    this.closed.emit();
  }

  protected generar(): void {
    if (this.enviando()) return;
    this.otForm().markAsTouched();
    if (!this.otForm().valid()) return;

    const m = this.model();
    this.enviando.set(true);
    this.api
      .generarOt(this.aviso().aviso_id, {
        tecnico_id: Number(m.technicianId),
        priority: m.priority,
        ...(m.vencimiento ? { fecha_vencimiento: new Date(m.vencimiento).toISOString() } : {}),
      })
      .subscribe({
        next: (res) => {
          this.enviando.set(false);
          this.toast.success(`OT ${res.ot.numero_ot} generada desde el aviso ${res.aviso.numero_aviso}.`);
          this.done.emit(res);
        },
        error: (err) => {
          this.enviando.set(false);
          this.toast.error(apiErrorMessage(err, 'No se pudo generar la OT.'));
        },
      });
  }
}
