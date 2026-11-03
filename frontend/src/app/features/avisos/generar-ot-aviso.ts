import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { form, required, FormField } from '@angular/forms/signals';

import { Aviso, AvisoGenerarOtResponse, Technician, WorkOrderPriority } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { Icon } from '../../shared/components/ui/icon/icon';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { PRIORIDADES, prioridadSugerida } from './etiquetas';
import { GravedadMedidor } from './gravedad-medidor';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
interface GenerarOtModel {
  technicianId: string;
  priority: WorkOrderPriority;
  /** `datetime-local` (hora local). Vacío = el backend calcula el vencimiento según el SLA de la máquina. */
  vencimiento: string;
}

/** Diálogo con el que el supervisor atiende un aviso: elige técnico y prioridad, y se genera la OT enlazada. */
@Component({
  selector: 'app-generar-ot-aviso',
  imports: [FormField, ModalComponent, GravedadMedidor, Icon, TranslatePipe],
  template: `
    <app-modal [title]="'avisos.generar_ot_desde_el' | translate" [subtitle]="'avisos.se_crea_una_orden' | translate" (closed)="cerrar()">
      <div class="grid gap-4">
        <div class="rounded-control border border-borde bg-superficie-2 p-3 text-base">
          <p class="codigo text-lg text-tinta-suave">{{ aviso().numero_aviso }}, {{ aviso().machine_name }}, {{ aviso().plant_name }}</p>
          <p class="mt-1">{{ aviso().descripcion }}</p>
          <p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tinta-suave">
            <span>{{ 'avisos.reportado_por' | translate: { v0: aviso().reportado_por.nombre } }}</span>
            <app-gravedad [severidad]="aviso().severidad" />
          </p>
          @if (aviso().foto) {
            <p class="mt-1 flex items-center gap-1.5 text-sm text-tinta">
              <app-icon name="imagen" [size]="18" /> {{ 'avisos.la_foto_del_aviso' | translate }}
            </p>
          }
        </div>

        <div>
          <label for="gen-tecnico" class="fld-label">{{ 'avisos.tecnico_responsable' | translate }}</label>
          <select
            id="gen-tecnico"
            [formField]="otForm.technicianId"
            [attr.aria-invalid]="otForm.technicianId().touched() && otForm.technicianId().invalid()"
            [attr.aria-describedby]="otForm.technicianId().touched() && otForm.technicianId().invalid() ? 'gen-tecnico-error' : null"
            class="fld-input">
            <option value="">{{ 'avisos.selecciona_un_tecnico' | translate }}</option>
            @for (t of technicians(); track t.id) {
              <option [value]="t.id">{{ t.name }}</option>
            }
          </select>
          @if (otForm.technicianId().touched() && otForm.technicianId().invalid()) {
            <p id="gen-tecnico-error" role="alert" class="fld-error">{{ otForm.technicianId().errors()[0]?.message | translate }}</p>
          }
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="gen-prioridad" class="fld-label">{{ 'avisos.prioridad' | translate }}</label>
            <select id="gen-prioridad" [formField]="otForm.priority" class="fld-input">
              @for (p of prioridades; track p.value) {
                <option [value]="p.value">{{ p.label }}</option>
              }
            </select>
            <p class="fld-ayuda">{{ 'avisos.sugerida_segun_la_gravedad' | translate }}</p>
          </div>
          <div>
            <label for="gen-vencimiento" class="fld-label">{{ 'avisos.vencimiento_opcional' | translate }}</label>
            <input id="gen-vencimiento" type="datetime-local" [formField]="otForm.vencimiento" class="fld-input" />
            <p class="fld-ayuda">{{ 'avisos.si_lo_dejas_vacio' | translate }}</p>
          </div>
        </div>
      </div>

      <div modal-footer class="grid gap-2 sm:flex sm:justify-end">
        <button type="button" class="btn-ghost order-2 sm:order-1" (click)="cerrar()">{{ 'avisos.cancelar' | translate }}</button>
        <button type="button" class="btn-primary order-1 sm:order-2" [disabled]="enviando()" (click)="generar()">
          {{ (enviando() ? 'avisos.generando' : 'avisos.generar_ot') | translate }}
        </button>
      </div>
    </app-modal>
  `,
})
export class GenerarOtAviso implements OnInit {
  private readonly i18n = inject(I18nService);
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
    required(f.technicianId, { message: 'avisos.selecciona_un_tecnico_2' });
  });

  constructor() {
    this.catalog.getTechnicians().subscribe({
      next: (technicians) => this.technicians.set(technicians ?? []),
      error: () => this.toast.error(this.i18n.tr('avisos.no_se_pudo_cargar')),
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
          this.toast.success(this.i18n.tr('avisos.ot_generada_desde_el', { v0: res.ot.numero_ot, v1: res.aviso.numero_aviso }));
          this.done.emit(res);
        },
        error: (err) => {
          this.enviando.set(false);
          this.toast.error(apiErrorMessage(err, this.i18n.tr('avisos.no_se_pudo_generar')));
        },
      });
  }
}
