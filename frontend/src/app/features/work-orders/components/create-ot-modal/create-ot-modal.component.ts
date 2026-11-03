import { Icon } from '../../../../shared/components/ui/icon/icon';
import { ModalComponent } from '../../../../shared/components/ui/modal/modal.component';
import { Component, inject, output, signal } from '@angular/core';
import { form, required, validate, FormField } from '@angular/forms/signals';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import { CatalogService } from '../../../../core/services/catalog.service';
import { WorkOrdersService } from '../../../../core/services/work-orders.service';
import { ToastService } from '../../../../core/services/toast.service';
import { Machine, Technician, WorkOrder, WorkOrderPriority, WorkOrderSeverity } from '../../../../core/models';

import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { I18nService } from '../../../../core/i18n/i18n.service';
interface CreateOtFormModel {
  title: string;
  machineId: string;
  technicianId: string;
  priority: WorkOrderPriority;
  /** Impacto de la falla. Vacío = sin clasificar (el backend acepta null). */
  severity: WorkOrderSeverity | '';
  description: string;
}

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function defaultModel(): CreateOtFormModel {
  return {
    title: '',
    machineId: '',
    technicianId: '',
    priority: 'medium',
    severity: '',
    description: '',
  };
}

@Component({
  selector: 'app-create-ot-modal',
  standalone: true,
  imports: [FormField, ModalComponent, Icon, TranslatePipe],
  template: `
    <app-modal [title]="'ot.crear_ot_2' | translate" [subtitle]="'ot.ingresa_los_detalles_para' | translate" size="lg" (closed)="close()">
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <label for="ot-title" class="fld-label">{{ 'ot.titulo' | translate }}</label>
            <input
              type="text"
              [formField]="otForm.title"
              id="ot-title"
              [attr.aria-invalid]="otForm.title().touched() && otForm.title().invalid()"
              [attr.aria-describedby]="otForm.title().touched() && otForm.title().invalid() ? 'ot-title-error' : null"
              [attr.placeholder]="'ot.ej_inspeccion_de_vibracion' | translate"
              class="fld-input" />
            @if (otForm.title().touched() && otForm.title().invalid()) {
              <p id="ot-title-error" role="alert" class="mt-1 text-sm text-peligro">{{ otForm.title().errors()[0]?.message | translate }}</p>
            }
          </div>

          <div>
            <label for="ot-machineId" class="fld-label">{{ 'ot.maquina_2' | translate }}</label>
            <select
              [formField]="otForm.machineId"
              id="ot-machineId"
              [attr.aria-invalid]="otForm.machineId().touched() && otForm.machineId().invalid()"
              [attr.aria-describedby]="otForm.machineId().touched() && otForm.machineId().invalid() ? 'ot-machineId-error' : null"
              class="fld-input">
              <option value="">{{ 'ot.selecciona_una_maquina' | translate }}</option>
              @for (m of machines(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
            @if (otForm.machineId().touched() && otForm.machineId().invalid()) {
              <p id="ot-machineId-error" role="alert" class="mt-1 text-sm text-peligro">{{ otForm.machineId().errors()[0]?.message | translate }}</p>
            }
          </div>

          <div>
            <label for="ot-technicianId" class="fld-label">{{ 'ot.tecnico_2' | translate }}</label>
            <select
              [formField]="otForm.technicianId"
              id="ot-technicianId"
              [attr.aria-invalid]="otForm.technicianId().touched() && otForm.technicianId().invalid()"
              [attr.aria-describedby]="otForm.technicianId().touched() && otForm.technicianId().invalid() ? 'ot-technicianId-error' : null"
              class="fld-input">
              <option value="">{{ 'ot.selecciona_un_tecnico' | translate }}</option>
              @for (t of technicians(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            @if (otForm.technicianId().touched() && otForm.technicianId().invalid()) {
              <p id="ot-technicianId-error" role="alert" class="mt-1 text-sm text-peligro">{{ otForm.technicianId().errors()[0]?.message | translate }}</p>
            }
          </div>

          <div>
            <label for="ot-priority" class="fld-label">{{ 'ot.prioridad' | translate }}</label>
            <select
              [formField]="otForm.priority"
              id="ot-priority"
              class="fld-input">
              <option value="low">{{ 'ot.baja' | translate }}</option>
              <option value="medium">{{ 'ot.media' | translate }}</option>
              <option value="high">{{ 'ot.alta' | translate }}</option>
              <option value="urgent">{{ 'ot.urgente' | translate }}</option>
            </select>
          </div>

          <div>
            <label for="ot-severity" class="fld-label">{{ 'ot.severidad' | translate }}</label>
            <select
              [formField]="otForm.severity"
              id="ot-severity"
              class="fld-input">
              <option value="">{{ 'ot.sin_clasificar' | translate }}</option>
              <option value="low">{{ 'ot.baja' | translate }}</option>
              <option value="medium">{{ 'ot.media' | translate }}</option>
              <option value="high">{{ 'ot.alta' | translate }}</option>
              <option value="critical">{{ 'ot.critica' | translate }}</option>
            </select>
            <p class="mt-1 text-sm text-tinta-suave">{{ 'ot.impacto_de_la_falla' | translate }}</p>
          </div>

          <div class="md:col-span-2">
            <label for="ot-description" class="fld-label">{{ 'ot.descripcion_2' | translate }}</label>
            <textarea
              [formField]="otForm.description"
              id="ot-description"
              [attr.aria-invalid]="otForm.description().touched() && otForm.description().invalid()"
              [attr.aria-describedby]="otForm.description().touched() && otForm.description().invalid() ? 'ot-description-error' : null"
              rows="4"
              [attr.placeholder]="'ot.describe_la_falla' | translate"
              class="fld-input resize-none"></textarea>
            @if (otForm.description().touched() && otForm.description().invalid()) {
              <p id="ot-description-error" role="alert" class="mt-1 text-sm text-peligro">{{ otForm.description().errors()[0]?.message | translate }}</p>
            }
          </div>

          <div class="md:col-span-2">
            <span id="ot-photo-label" class="fld-label">{{ 'ot.foto_de_la_falla' | translate }}</span>
            <div class="flex items-center gap-3">
              <button
                type="button"
                (click)="fileInput.click()"
                aria-describedby="ot-photo-label"
                class="btn-secondary">
                <app-icon name="imagen" [size]="20" /> {{ 'ot.adjuntar' | translate }}
              </button>
              <span class="text-sm text-tinta-suave">{{ selectedFile()?.name ?? ('ot.sin_foto' | translate) }}</span>
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

      <div modal-footer class="grid gap-2 sm:flex sm:items-center sm:justify-between">
        <div class="order-2 flex items-center gap-2 sm:order-1">
          <button type="button" class="btn-ghost" (click)="close()">{{ 'ot.cancelar' | translate }}</button>
          <button type="button" class="btn-ghost" (click)="resetForm()">{{ 'ot.limpiar' | translate }}</button>
        </div>
        <button type="button" class="btn-primary order-1 min-h-14 text-lg sm:order-2 sm:min-h-10 sm:text-sm" [disabled]="submitting()" (click)="onSubmit()">
          {{ (submitting() ? 'ot.creando' : 'ot.crear_ot_2') | translate }}
        </button>
      </div>
    </app-modal>
  `,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class CreateOtModalComponent {
  private readonly i18n = inject(I18nService);
  private catalogService = inject(CatalogService);
  private workOrdersService = inject(WorkOrdersService);
  private toastService = inject(ToastService);

  readonly closed = output<void>();
  readonly created = output<WorkOrder>();

  readonly machines = signal<Machine[]>([]);
  readonly technicians = signal<Technician[]>([]);
  readonly selectedFile = signal<File | null>(null);
  readonly submitting = signal(false);

  readonly model = signal<CreateOtFormModel>(defaultModel());
  readonly otForm = form(this.model, (f) => {
    required(f.title, { message: 'ot.ingresa_un_titulo_para' });
    validate(f.title, ({ value }) =>
      value().trim() ? undefined : { kind: 'blank', message: 'ot.ingresa_un_titulo_para' });
    required(f.machineId, { message: 'ot.selecciona_una_maquina_2' });
    required(f.technicianId, { message: 'ot.selecciona_un_tecnico_2' });
    required(f.description, { message: 'ot.describe_la_falla_2' });
    validate(f.description, ({ value }) =>
      value().trim() ? undefined : { kind: 'blank', message: 'ot.describe_la_falla_2' });
  });

  constructor() {
    forkJoin({
      machines: this.catalogService.getMachines(),
      technicians: this.catalogService.getTechnicians(),
    }).subscribe({
      next: ({ machines, technicians }) => {
        this.machines.set(machines ?? []);
        this.technicians.set(technicians ?? []);
      },
      error: () => this.toastService.error(this.i18n.tr('ot.no_se_pudieron_cargar_2')),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && !ALLOWED_PHOTO_TYPES.includes(file.type)) {
      this.toastService.error(this.i18n.tr('ot.solo_se_permiten_imagenes'));
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
    if (m.severity) formData.append('severity', m.severity);
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
        return this.i18n.tr('ot.no_se_pudo_conectar');
      case 401:
        return this.i18n.tr('ot.tu_sesion_expiro_vuelve');
      case 403:
        return text ?? this.i18n.tr('ot.no_tienes_permisos_para');
      case 400:
      case 415:
      case 422:
        return text ?? this.i18n.tr('ot.los_datos_de_la');
      default:
        return text ?? this.i18n.tr('ot.error_al_crear_la');
    }
  }
}
