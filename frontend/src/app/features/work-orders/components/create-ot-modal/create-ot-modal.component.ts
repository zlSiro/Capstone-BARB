import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { form, required, FormField } from '@angular/forms/signals';
import { forkJoin } from 'rxjs';

import { CatalogService } from '../../../../core/services/catalog.service';
import { WorkOrdersService } from '../../../../core/services/work-orders.service';
import { AuthService } from '../../../../core/services/auth.service';
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
      <div class="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl" (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 class="text-xl font-bold text-slate-100">Crear OT</h2>
            <p class="text-sm text-slate-400">Ingresa los detalles para generar y asignar la orden.</p>
          </div>
          <button
            type="button"
            (click)="close()"
            class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div class="grid gap-4 px-6 py-5 md:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Título</label>
            <input
              type="text"
              [formField]="otForm.title"
              placeholder="Ej. Inspección de vibración motor D1"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            @if (otForm.title().touched() && otForm.title().invalid()) {
              <p class="mt-1 text-xs text-red-400">{{ otForm.title().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Disciplina</label>
            <select
              [formField]="otForm.disciplineId"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona una disciplina</option>
              @for (d of disciplines(); track d.id) {
                <option [value]="d.id">{{ d.name }}</option>
              }
            </select>
            @if (otForm.disciplineId().touched() && otForm.disciplineId().invalid()) {
              <p class="mt-1 text-xs text-red-400">{{ otForm.disciplineId().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Máquina</label>
            <select
              [formField]="otForm.machineId"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona una máquina</option>
              @for (m of filteredMachines(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
            @if (otForm.machineId().touched() && otForm.machineId().invalid()) {
              <p class="mt-1 text-xs text-red-400">{{ otForm.machineId().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Técnico</label>
            <select
              [formField]="otForm.technicianId"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona un técnico</option>
              @for (t of technicians(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            @if (otForm.technicianId().touched() && otForm.technicianId().invalid()) {
              <p class="mt-1 text-xs text-red-400">{{ otForm.technicianId().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Prioridad</label>
            <select
              [formField]="otForm.priority"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>

          <div>
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Estado</label>
            <select
              [formField]="otForm.estado"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="pending">Abierta</option>
              <option value="assigned">Asignada</option>
              <option value="in_progress">En Progreso</option>
              <option value="completed">Completada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </div>

          <div class="md:col-span-2">
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Descripción</label>
            <textarea
              [formField]="otForm.description"
              rows="4"
              placeholder="Describe la falla..."
              class="w-full resize-none rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            @if (otForm.description().touched() && otForm.description().invalid()) {
              <p class="mt-1 text-xs text-red-400">{{ otForm.description().errors()[0]?.message }}</p>
            }
          </div>

          <div class="md:col-span-2">
            <label class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Foto de la falla (opcional)</label>
            <div class="flex items-center gap-3">
              <button
                type="button"
                (click)="fileInput.click()"
                class="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700">
                📎 Adjuntar
              </button>
              <span class="text-sm text-slate-500">{{ selectedFile()?.name ?? 'Sin foto' }}</span>
              <input
                #fileInput
                type="file"
                class="hidden"
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
  private authService = inject(AuthService);
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
    required(f.disciplineId, { message: 'Selecciona una disciplina.' });
    required(f.machineId, { message: 'Selecciona una máquina.' });
    required(f.technicianId, { message: 'Selecciona un técnico.' });
    required(f.description, { message: 'Describe la falla.' });
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
    this.otForm().markAsTouched();
    if (!this.otForm().valid()) return;

    const m = this.model();
    const currentUserId = this.authService.user()?.id;

    const formData = new FormData();
    formData.append('maquina_id', m.machineId);
    formData.append('tecnico_id', m.technicianId);
    if (currentUserId != null) {
      formData.append('creado_por', String(currentUserId));
    }
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
        this.toastService.error(err?.error?.detail || 'Error al crear la OT.');
      },
    });
  }
}
