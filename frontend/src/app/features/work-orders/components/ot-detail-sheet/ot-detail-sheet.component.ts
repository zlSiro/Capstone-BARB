import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

import { WorkOrder } from '../../../../core/models';
import { ModalComponent } from '../../../../shared/components/ui/modal/modal.component';
import { priorityMeta, roleLabel, tipoLabel } from '../../utils/work-order-labels';
import { OtStatusBadgeComponent } from '../ot-status-badge/ot-status-badge.component';
import { OtStatusSelectComponent, StatusChangeRequest } from '../ot-status-select/ot-status-select.component';

/** Detalle de una OT: datos clave, cambio de estado y línea de tiempo de la auditoría. */
@Component({
  selector: 'app-ot-detail-sheet',
  imports: [DatePipe, ModalComponent, OtStatusBadgeComponent, OtStatusSelectComponent],
  template: `
    <app-modal size="lg" [title]="order().numero_ot" [subtitle]="order().title" (closed)="closed.emit()">
      <div class="flex flex-col gap-6 text-slate-200">
        <dl class="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">Estado</dt>
            <dd class="mt-1"><app-ot-status-select [order]="order()" (changeRequested)="changeRequested.emit($event)" /></dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">Prioridad</dt>
            <dd class="mt-1">
              <span class="rounded-full px-2.5 py-1 text-xs font-medium" [class]="priority().badge">{{ priority().label }}</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">Máquina</dt>
            <dd class="mt-1">{{ order().machine_name }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">Planta · Disciplina</dt>
            <dd class="mt-1">{{ order().plant_name || '—' }} · {{ order().discipline_name || '—' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">Técnico asignado</dt>
            <dd class="mt-1">{{ order().tecnico_nombre || 'Sin asignar' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">Tipo de mantenimiento</dt>
            <dd class="mt-1">{{ tipo() }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">Creada</dt>
            <dd class="mt-1">{{ order().created_at | date: 'dd/MM/yyyy HH:mm' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-400">Inicio · Cierre</dt>
            <dd class="mt-1">
              {{ order().fecha_inicio ? (order().fecha_inicio | date: 'dd/MM/yyyy HH:mm') : 'Aún no inicia' }}
              ·
              {{ order().fecha_cierre ? (order().fecha_cierre | date: 'dd/MM/yyyy HH:mm') : 'Abierta' }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-xs uppercase tracking-wide text-slate-400">Descripción del problema</dt>
            <dd class="mt-1 whitespace-pre-line">{{ order().description || 'Sin descripción.' }}</dd>
          </div>
        </dl>

        <section aria-labelledby="ot-history-title">
          <h3 id="ot-history-title" class="mb-3 text-sm font-semibold text-slate-100">Historial de estados</h3>
          @if (!order().status_history) {
            <p class="text-sm text-slate-400" role="status">Cargando historial…</p>
          } @else if (!order().status_history!.length) {
            <p class="text-sm text-slate-400">Aún no hay cambios de estado registrados.</p>
          } @else {
            <ol class="flex flex-col gap-3 border-l border-slate-700 pl-4">
              @for (h of order().status_history; track h.id) {
                <li class="text-sm">
                  <p class="flex flex-wrap items-center gap-2">
                    <app-ot-status-badge [estado]="h.from_status ?? 'pending'" />
                    <span aria-hidden="true">→</span>
                    <span class="sr-only">cambió a</span>
                    <app-ot-status-badge [estado]="h.to_status" />
                  </p>
                  <p class="mt-1 text-xs text-slate-400">
                    {{ h.user_name || 'Usuario desconocido' }}@if (h.user_role) { ({{ role(h.user_role) }}) } ·
                    {{ h.changed_at | date: 'dd/MM/yyyy HH:mm' }}
                  </p>
                  @if (h.comment) {
                    <p class="mt-1 text-slate-200">“{{ h.comment }}”</p>
                  }
                </li>
              }
            </ol>
          }
        </section>
      </div>
    </app-modal>
  `,
})
export class OtDetailSheetComponent {
  readonly order = input.required<WorkOrder>();
  readonly closed = output<void>();
  readonly changeRequested = output<StatusChangeRequest>();

  protected readonly priority = computed(() => priorityMeta(this.order().priority));
  protected readonly tipo = computed(() => tipoLabel(this.order().tipo));
  protected readonly role = roleLabel;
}
