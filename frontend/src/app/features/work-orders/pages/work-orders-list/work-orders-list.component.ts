import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkOrdersService } from '../../../../core/services/work-orders.service';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { WorkOrder } from '../../../../core/models';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { CreateOtModalComponent } from '../../components/create-ot-modal/create-ot-modal.component';

@Component({
  selector: 'app-work-orders-list',
  standalone: true,
  imports: [CommonModule, CreateOtModalComponent],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gray-800">Órdenes de Trabajo ({{ orders().length }})</h1>
        @if (permissions.canPerform('crear_ot')) {
          <button
            (click)="isCreateModalOpen.set(true)"
            class="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded">
            + Crear OT
          </button>
        }
      </div>

      @if (isCreateModalOpen()) {
        <app-create-ot-modal
          (closed)="isCreateModalOpen.set(false)"
          (created)="onOtCreated($event)" />
      }

      @if (loading()) {
        <div class="text-center py-10 text-gray-500">Cargando órdenes...</div>
      } @else {
        <div class="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-600 uppercase text-xs">
              <tr>
                <th class="px-4 py-2 text-left">N° OT</th>
                @if (tenant.isSuper()) {
                  <th class="px-4 py-2 text-left">Empresa</th>
                }
                <th class="px-4 py-2 text-left">Máquina</th>
                <th class="px-4 py-2 text-left">Tipo</th>
                <th class="px-4 py-2 text-left">Estado</th>
                <th class="px-4 py-2 text-left">Prioridad</th>
              </tr>
            </thead>
            <tbody>
              @for (ot of orders(); track ot.ot_id) {
                <tr class="border-t border-gray-100 hover:bg-gray-50">
                  <td class="px-4 py-2 font-mono">{{ ot.numero_ot }}</td>
                  @if (tenant.isSuper()) {
                    <td class="px-4 py-2">{{ ot.empresa_nombre }}</td>
                  }
                  <td class="px-4 py-2">{{ ot.machine_name }}</td>
                  <td class="px-4 py-2">{{ ot.tipo }}</td>
                  <td class="px-4 py-2">
                    <span class="text-xs px-2 py-1 rounded bg-gray-100">{{ ot.estado }}</span>
                  </td>
                  <td class="px-4 py-2">{{ ot.priority }}</td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="tenant.isSuper() ? 6 : 5" class="text-center py-6 text-gray-500">No hay órdenes registradas</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `
})
export class WorkOrdersListComponent implements OnInit {
  private workOrdersService = inject(WorkOrdersService);
  permissions = inject(PermissionsService);
  tenant = inject(TenantContextService);

  orders = signal<WorkOrder[]>([]);
  loading = signal(true);
  isCreateModalOpen = signal(false);

  ngOnInit() {
    this.workOrdersService.getAll().subscribe({
      next: (data) => {
        this.orders.set(Array.isArray(data) ? data : []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  onOtCreated(order: WorkOrder) {
    this.orders.update(current => [order, ...current]);
    this.isCreateModalOpen.set(false);
  }
}
