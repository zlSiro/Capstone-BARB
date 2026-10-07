import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { WorkOrder, WorkOrderStatus } from '../../../../core/models';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { ToastService } from '../../../../core/services/toast.service';
import { WorkOrdersService } from '../../../../core/services/work-orders.service';
import { apiErrorMessage } from '../../../../core/utils/http-error';
import { CreateOtModalComponent } from '../../components/create-ot-modal/create-ot-modal.component';
import { OtDetailSheetComponent } from '../../components/ot-detail-sheet/ot-detail-sheet.component';
import { OtFilterBarComponent } from '../../components/ot-filter-bar/ot-filter-bar.component';
import { OtStatusChangeDialogComponent } from '../../components/ot-status-change-dialog/ot-status-change-dialog.component';
import { OtStatusSelectComponent, StatusChangeRequest } from '../../components/ot-status-select/ot-status-select.component';
import { filterGroup, priorityMeta, statusMeta, tipoLabel } from '../../utils/work-order-labels';

@Component({
  selector: 'app-work-orders-list',
  imports: [
    DatePipe,
    CreateOtModalComponent,
    OtDetailSheetComponent,
    OtFilterBarComponent,
    OtStatusChangeDialogComponent,
    OtStatusSelectComponent,
  ],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="ot-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="ot-title" class="text-2xl font-bold text-gray-800 dark:text-gray-100">Órdenes de Trabajo ({{ orders().length }})</h1>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            @if (canChangeStatus()) {
              Usa la columna «Estado» para actualizar el avance de cada orden. Cada cambio queda registrado con tu usuario y la hora.
            } @else {
              Consulta el estado de las órdenes. Tu rol no permite modificar estados.
            }
          </p>
        </div>
        @if (permissions.canPerform('crear_ot')) {
          <button type="button" class="btn-primary" (click)="isCreateModalOpen.set(true)">+ Crear OT</button>
        }
      </div>

      @if (isCreateModalOpen()) {
        <app-create-ot-modal (closed)="isCreateModalOpen.set(false)" (created)="onOtCreated($event)" />
      }

      @if (loading()) {
        <div class="py-10 text-center text-gray-600 dark:text-gray-300" role="status">Cargando órdenes…</div>
      } @else if (error()) {
        <div class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {{ error() }} <button type="button" class="ml-2 underline" (click)="load()">Reintentar</button>
        </div>
      } @else {
        <app-ot-filter-bar [counts]="counts()" [(status)]="statusFilter" [(search)]="search" />

        <div class="overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm">
          <table class="w-full text-sm text-gray-800">
            <caption class="sr-only">Listado de órdenes de trabajo con su estado actual</caption>
            <thead class="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">N° OT</th>
                @if (tenant.isSuper()) {
                  <th scope="col" class="px-4 py-2 text-left">Empresa</th>
                }
                <th scope="col" class="px-4 py-2 text-left">Descripción</th>
                <th scope="col" class="px-4 py-2 text-left">Máquina</th>
                <th scope="col" class="px-4 py-2 text-left">Técnico</th>
                <th scope="col" class="px-4 py-2 text-left">Prioridad</th>
                <th scope="col" class="px-4 py-2 text-left">Estado</th>
                <th scope="col" class="px-4 py-2 text-left">Creada</th>
              </tr>
            </thead>
            <tbody>
              @for (ot of filtered(); track ot.ot_id) {
                <tr class="border-t border-gray-100 hover:bg-gray-50">
                  <td class="whitespace-nowrap px-4 py-2">
                    <button
                      type="button"
                      class="rounded font-mono text-blue-800 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
                      [attr.aria-label]="'Ver detalle de la OT ' + ot.numero_ot"
                      (click)="openDetail(ot)">
                      {{ ot.numero_ot }}
                    </button>
                  </td>
                  @if (tenant.isSuper()) {
                    <td class="px-4 py-2">{{ ot.empresa_nombre }}</td>
                  }
                  <td class="max-w-xs px-4 py-2">
                    <p class="line-clamp-2" [title]="ot.title">{{ ot.title }}</p>
                    <p class="text-xs text-gray-600">{{ tipo(ot.tipo) }}</p>
                  </td>
                  <td class="px-4 py-2">
                    <p>{{ ot.machine_name }}</p>
                    <p class="text-xs text-gray-600">{{ ot.plant_name }}</p>
                  </td>
                  <td class="px-4 py-2">{{ ot.tecnico_nombre || 'Sin asignar' }}</td>
                  <td class="px-4 py-2">
                    <span class="rounded-full px-2.5 py-1 text-xs font-medium" [class]="priority(ot.priority).badge">
                      {{ priority(ot.priority).label }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-4 py-2">
                    <app-ot-status-select [order]="ot" (changeRequested)="requestChange($event)" />
                  </td>
                  <td class="whitespace-nowrap px-4 py-2 text-gray-700">{{ ot.created_at | date: 'dd/MM/yyyy HH:mm' }}</td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="tenant.isSuper() ? 8 : 7" class="py-6 text-center text-gray-600">
                    {{ orders().length ? 'Ninguna orden coincide con el filtro.' : 'No hay órdenes registradas' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (detail(); as ot) {
      <app-ot-detail-sheet [order]="ot" (closed)="closeDetail()" (changeRequested)="requestChange($event)" />
    }

    @if (pending(); as req) {
      <app-ot-status-change-dialog
        [order]="req.order"
        [to]="req.to"
        [submitting]="submitting()"
        [error]="changeError()"
        (confirmed)="confirmChange($event)"
        (closed)="pending.set(null)" />
    }
  `,
})
export class WorkOrdersListComponent implements OnInit {
  private readonly workOrdersService = inject(WorkOrdersService);
  private readonly toast = inject(ToastService);
  protected readonly permissions = inject(PermissionsService);
  protected readonly tenant = inject(TenantContextService);

  protected readonly orders = signal<WorkOrder[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly isCreateModalOpen = signal(false);

  protected readonly statusFilter = signal<WorkOrderStatus>('');
  protected readonly search = signal('');

  /** OT abierta en el panel de detalle. */
  protected readonly detail = signal<WorkOrder | null>(null);
  /** Cambio de estado pendiente de confirmación. */
  protected readonly pending = signal<StatusChangeRequest | null>(null);
  protected readonly submitting = signal(false);
  protected readonly changeError = signal<string | null>(null);

  protected readonly canChangeStatus = computed(() => this.permissions.canPerform('cambiar_estado_ot'));

  protected readonly counts = computed(() => {
    const counts: Record<string, number> = { all: this.orders().length };
    for (const ot of this.orders()) {
      const group = filterGroup(ot.estado);
      counts[group] = (counts[group] ?? 0) + 1;
    }
    return counts;
  });

  protected readonly filtered = computed(() => {
    const status = this.statusFilter();
    const term = this.search().trim().toLowerCase();
    return this.orders().filter(ot => {
      if (status && filterGroup(ot.estado) !== status) return false;
      if (!term) return true;
      return [ot.numero_ot, ot.title, ot.machine_name, ot.tecnico_nombre, ot.plant_name]
        .some(field => (field ?? '').toLowerCase().includes(term));
    });
  });

  protected readonly priority = priorityMeta;
  protected readonly tipo = tipoLabel;

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.workOrdersService.getAll().subscribe({
      next: data => {
        this.orders.set(Array.isArray(data) ? data : []);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(apiErrorMessage(err, 'No se pudieron cargar las órdenes de trabajo.'));
        this.loading.set(false);
      },
    });
  }

  protected onOtCreated(order: WorkOrder): void {
    this.orders.update(current => [order, ...current]);
    this.isCreateModalOpen.set(false);
  }

  // ---------------------------------------------------------------------------
  // Detalle
  // ---------------------------------------------------------------------------

  protected openDetail(order: WorkOrder): void {
    this.detail.set(order);
    // El listado no trae el historial: se pide el detalle completo.
    this.workOrdersService.getByNumber(order.numero_ot).subscribe({
      next: full => {
        if (this.detail()?.numero_ot === full.numero_ot) this.detail.set(full);
      },
      error: err => this.toast.error(apiErrorMessage(err, 'No se pudo cargar el historial de la OT.')),
    });
  }

  protected closeDetail(): void {
    // ESC con el diálogo de confirmación abierto solo debe cerrar el diálogo.
    if (!this.pending()) this.detail.set(null);
  }

  // ---------------------------------------------------------------------------
  // Cambio de estado
  // ---------------------------------------------------------------------------

  protected requestChange(request: StatusChangeRequest): void {
    this.changeError.set(null);
    this.pending.set(request);
  }

  protected confirmChange(comment: string): void {
    const request = this.pending();
    if (!request || this.submitting()) return;

    this.submitting.set(true);
    this.changeError.set(null);
    this.workOrdersService.updateStatus(request.order.numero_ot, request.to, comment).subscribe({
      next: updated => {
        this.orders.update(list => list.map(ot => (ot.numero_ot === updated.numero_ot ? updated : ot)));
        if (this.detail()?.numero_ot === updated.numero_ot) this.detail.set(updated);
        this.toast.success(
          `${updated.numero_ot}: ${statusMeta(request.order.estado).label} → ${statusMeta(updated.estado).label}`,
        );
        this.submitting.set(false);
        this.pending.set(null);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const message = apiErrorMessage(err, 'No se pudo actualizar el estado de la OT.');
        const status = err instanceof HttpErrorResponse ? err.status : 0;
        if ([403, 404, 409].includes(status)) {
          // Otro usuario cambió la OT o cambiaron los permisos: se informa y se refresca para mostrar el estado real.
          this.pending.set(null);
          this.toast.error(message);
          this.refreshOrder(request.order.numero_ot);
        } else {
          // Error de red o del servidor: el diálogo sigue abierto para reintentar.
          this.changeError.set(message);
        }
      },
    });
  }

  private refreshOrder(numeroOt: string): void {
    this.workOrdersService.getByNumber(numeroOt).subscribe({
      next: fresh => {
        this.orders.update(list => list.map(ot => (ot.numero_ot === fresh.numero_ot ? fresh : ot)));
        if (this.detail()?.numero_ot === fresh.numero_ot) this.detail.set(fresh);
      },
      error: () => this.load(),
    });
  }
}
