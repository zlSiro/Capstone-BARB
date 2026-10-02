import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { form, required, validate, FormField } from '@angular/forms/signals';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import { CatalogService } from '../../../../core/services/catalog.service';
import { WorkOrdersService } from '../../../../core/services/work-orders.service';
import { ToastService } from '../../../../core/services/toast.service';
import { Discipline, Machine, Technician, WorkOrder, WorkOrderPriority } from '../../../../core/models';

interface CreateOtFormModel {
  title: string;
  disciplineId: string;
  machineId: string;
  technicianId: string;
  priority: WorkOrderPriority;
  estado: string;
  description: string;
}

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function defaultModel(): CreateOtFormModel {
  return {
    title: '',
    disciplineId: '',
    machineId: '',
    technicianId: '',
    priority: 'medium',
    estado: 'pending',
    description: '',
  };
}

@Component({
  selector: 'app-create-ot-modal',
  standalone: true,
  imports: [FormField],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      (click)="onBackdropClick($event)">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ot-title"
        class="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="create-ot-title" class="text-xl font-bold text-slate-100">Crear OT</h2>
            <p class="text-sm text-slate-400">Ingresa los detalles para generar y asignar la orden.</p>
          </div>
          <button
            type="button"
            (click)="close()"
            class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Cerrar">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div class="grid gap-4 px-6 py-5 md:grid-cols-2">
          <div>
            <label for="ot-title" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Título *</label>
            <input
              type="text"
              [formField]="otForm.title"
              id="ot-title"
              [attr.aria-invalid]="otForm.title().touched() && otForm.title().invalid()"
              [attr.aria-describedby]="otForm.title().touched() && otForm.title().invalid() ? 'ot-title-error' : null"
              placeholder="Ej. Inspección de vibración motor D1"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            @if (otForm.title().touched() && otForm.title().invalid()) {
              <p id="ot-title-error" role="alert" class="mt-1 text-xs text-red-400">{{ otForm.title().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label for="ot-disciplineId" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Disciplina *</label>
            <select
              [formField]="otForm.disciplineId"
              id="ot-disciplineId"
              [attr.aria-invalid]="otForm.disciplineId().touched() && otForm.disciplineId().invalid()"
              [attr.aria-describedby]="otForm.disciplineId().touched() && otForm.disciplineId().invalid() ? 'ot-disciplineId-error' : null"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona una disciplina</option>
              @for (d of disciplines(); track d.id) {
                <option [value]="d.id">{{ d.name }}</option>
              }
            </select>
            @if (otForm.disciplineId().touched() && otForm.disciplineId().invalid()) {
              <p id="ot-disciplineId-error" role="alert" class="mt-1 text-xs text-red-400">{{ otForm.disciplineId().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label for="ot-machineId" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Máquina *</label>
            <select
              [formField]="otForm.machineId"
              id="ot-machineId"
              [attr.aria-invalid]="otForm.machineId().touched() && otForm.machineId().invalid()"
              [attr.aria-describedby]="otForm.machineId().touched() && otForm.machineId().invalid() ? 'ot-machineId-error' : null"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona una máquina</option>
              @for (m of filteredMachines(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
            @if (otForm.machineId().touched() && otForm.machineId().invalid()) {
              <p id="ot-machineId-error" role="alert" class="mt-1 text-xs text-red-400">{{ otForm.machineId().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label for="ot-technicianId" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Técnico *</label>
            <select
              [formField]="otForm.technicianId"
              id="ot-technicianId"
              [attr.aria-invalid]="otForm.technicianId().touched() && otForm.technicianId().invalid()"
              [attr.aria-describedby]="otForm.technicianId().touched() && otForm.technicianId().invalid() ? 'ot-technicianId-error' : null"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona un técnico</option>
              @for (t of technicians(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            @if (otForm.technicianId().touched() && otForm.technicianId().invalid()) {
              <p id="ot-technicianId-error" role="alert" class="mt-1 text-xs text-red-400">{{ otForm.technicianId().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label for="ot-priority" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Prioridad</label>
            <select
              [formField]="otForm.priority"
              id="ot-priority"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>

          <div>
            <label for="ot-estado" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Estado</label>
            <select
              [formField]="otForm.estado"
              id="ot-estado"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="pending">Abierta</option>
              <option value="assigned">Asignada</option>
              <option value="in_progress">En Progreso</option>
              <option value="completed">Completada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </div>

          <div class="md:col-span-2">
            <label for="ot-description" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Descripción *</label>
            <textarea
              [formField]="otForm.description"
              id="ot-description"
              [attr.aria-invalid]="otForm.description().touched() && otForm.description().invalid()"
              [attr.aria-describedby]="otForm.description().touched() && otForm.description().invalid() ? 'ot-description-error' : null"
              rows="4"
              placeholder="Describe la falla..."
              class="w-full resize-none rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            @if (otForm.description().touched() && otForm.description().invalid()) {
              <p id="ot-description-error" role="alert" class="mt-1 text-xs text-red-400">{{ otForm.description().errors()[0]?.message }}</p>
            }
          </div>

          <div class="md:col-span-2">
            <span id="ot-photo-label" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Foto de la falla (opcional)</span>
            <div class="flex items-center gap-3">
              <button
                type="button"
                (click)="fileInput.click()"
                aria-describedby="ot-photo-label"
                class="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700">
                <span aria-hidden="true">📎</span> Adjuntar
              </button>
              <span class="text-sm text-slate-400">{{ selectedFile()?.name ?? 'Sin foto' }}</span>
              <input
                #fileInput
                type="file"
                class="hidden"
                aria-labelledby="ot-photo-label"
                accept="image/jpeg,image/png,image/webp"
                (change)="onFileSelected($event)" />
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-slate-800 px-6 py-4">
          <div class="flex items-center gap-4">
            <button
              type="button"
              (click)="close()"
              class="text-sm font-medium text-slate-300 hover:text-white">
              Cancelar
            </button>
            <button
              type="button"
              (click)="resetForm()"
              class="text-sm font-medium text-slate-300 hover:text-white">
              Limpiar
            </button>
          </div>
        </div>

        <div class="px-6 pb-6">
          <button
            type="button"
            [disabled]="submitting()"
            (click)="onSubmit()"
            class="w-full rounded bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-800">
            {{ submitting() ? 'Creando...' : 'Crear OT' }}
          </button>
        </div>
      </div>
    </div>
  `,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class CreateOtModalComponent {
  private catalogService = inject(CatalogService);
  private workOrdersService = inject(WorkOrdersService);
  private toastService = inject(ToastService);

  readonly closed = output<void>();
  readonly created = output<WorkOrder>();

  readonly disciplines = signal<Discipline[]>([]);
  readonly machines = signal<Machine[]>([]);
  readonly technicians = signal<Technician[]>([]);
  readonly selectedFile = signal<File | null>(null);
  readonly submitting = signal(false);

  readonly model = signal<CreateOtFormModel>(defaultModel());
  readonly otForm = form(this.model, (f) => {
    required(f.title, { message: 'Ingresa un título para la OT.' });
    validate(f.title, ({ value }) =>
      value().trim() ? undefined : { kind: 'blank', message: 'Ingresa un título para la OT.' });
    required(f.disciplineId, { message: 'Selecciona una disciplina.' });
    required(f.machineId, { message: 'Selecciona una máquina.' });
    required(f.technicianId, { message: 'Selecciona un técnico.' });
    required(f.description, { message: 'Describe la falla.' });
    validate(f.description, ({ value }) =>
      value().trim() ? undefined : { kind: 'blank', message: 'Describe la falla.' });
  });

  readonly filteredMachines = computed(() => {
    const disciplineId = this.model().disciplineId;
    if (!disciplineId) return this.machines();
    return this.machines().filter(m => String(m.discipline_id) === disciplineId);
  });

  constructor() {
    forkJoin({
      disciplines: this.catalogService.getDisciplines(),
      machines: this.catalogService.getMachines(),
      technicians: this.catalogService.getTechnicians(),
    }).subscribe({
      next: ({ disciplines, machines, technicians }) => {
        this.disciplines.set(disciplines ?? []);
        this.machines.set(machines ?? []);
        this.technicians.set(technicians ?? []);
      },
      error: () => this.toastService.error('No se pudieron cargar los catálogos para crear la OT.'),
    });

    // Si la máquina seleccionada deja de pertenecer a la disciplina elegida, se limpia.
    effect(() => {
      const disciplineId = this.model().disciplineId;
      const machineId = this.model().machineId;
      if (!machineId) return;
      const stillValid = this.filteredMachines().some(m => String(m.id) === machineId);
      if (!stillValid) {
        this.model.update(current => ({ ...current, machineId: '' }));
      }
      void disciplineId;
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && !ALLOWED_PHOTO_TYPES.includes(file.type)) {
      this.toastService.error('Solo se permiten imágenes JPEG, PNG o WEBP.');
      input.value = '';
      this.selectedFile.set(null);
      return;
    }
    this.selectedFile.set(file);
  }

  resetForm(): void {
    this.otForm().reset(defaultModel());
    this.selectedFile.set(null);
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    event.stopPropagation();
    this.close();
  }

  onSubmit(): void {
    if (this.submitting()) return;
    this.otForm().markAsTouched();
    if (!this.otForm().valid()) return;

    const m = this.model();

    const formData = new FormData();
    formData.append('maquina_id', m.machineId);
    formData.append('tecnico_id', m.technicianId);
    formData.append('descripcion_problema', `${m.title.trim()}\n\n${m.description.trim()}`.trim());
    formData.append('priority', m.priority);
    formData.append('estado', m.estado);
    if (this.selectedFile()) {
      formData.append('photos', this.selectedFile()!);
    }

    this.submitting.set(true);
    this.workOrdersService.create(formData).subscribe({
      next: (workOrder) => {
        this.submitting.set(false);
        this.toastService.success(`OT ${workOrder.numero_ot} creada correctamente.`);
        this.created.emit(workOrder);
        this.resetForm();
      },
      error: (err) => {
        this.submitting.set(false);
        this.toastService.error(this.errorMessage(err));
      },
    });
  }

  private errorMessage(err: HttpErrorResponse): string {
    const detail = err?.error?.detail;
    const text = typeof detail === 'string' ? detail : null;
    switch (err?.status) {
      case 0:
        return 'No se pudo conectar con el servidor. Revisa tu conexión.';
      case 401:
        return 'Tu sesión expiró. Vuelve a iniciar sesión.';
      case 403:
        return text ?? 'No tienes permisos para crear órdenes de trabajo.';
      case 400:
      case 415:
      case 422:
        return text ?? 'Los datos de la OT no son válidos.';
      default:
        return text ?? 'Error al crear la OT.';
    }
  }
}
