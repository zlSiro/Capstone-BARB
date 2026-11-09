import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';

import { environment } from '../../../../../environments/environment';
import { WorkOrder, WorkOrderStatus } from '../../../../core/models';
import { PermissionsService } from '../../../../core/permissions/permissions.service';
import { AuthService } from '../../../../core/services/auth.service';
import { OtLiveSimulatorService } from '../../../../core/services/ot-live-simulator.service';
import { OtRealtimeEvent, OtRealtimeService } from '../../../../core/services/ot-realtime.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { ToastService } from '../../../../core/services/toast.service';
import { WorkOrdersService } from '../../../../core/services/work-orders.service';
import { apiErrorMessage } from '../../../../core/utils/http-error';
import { CreateOtModalComponent } from '../../components/create-ot-modal/create-ot-modal.component';
import { OtDetailSheetComponent } from '../../components/ot-detail-sheet/ot-detail-sheet.component';
import { OtFilterBarComponent } from '../../components/ot-filter-bar/ot-filter-bar.component';
import { OtLiveIndicatorComponent } from '../../components/ot-live-indicator/ot-live-indicator.component';
import { OtStatusChangeDialogComponent } from '../../components/ot-status-change-dialog/ot-status-change-dialog.component';
import { OtStatusSelectComponent, StatusChangeRequest } from '../../components/ot-status-select/ot-status-select.component';
import { filterGroup, priorityMeta, statusMeta, tipoLabel } from '../../utils/work-order-labels';

import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { I18nService } from '../../../../core/i18n/i18n.service';
@Component({
  selector: 'app-work-orders-list',
  imports: [DatePipe,
    CreateOtModalComponent,
    OtDetailSheetComponent,
    OtFilterBarComponent,
    OtLiveIndicatorComponent,
    OtStatusChangeDialogComponent,
    OtStatusSelectComponent,TranslatePipe],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="ot-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-3">
            <h1 id="ot-title" class="text-2xl font-bold text-tinta ">{{ 'ot.ordenes_de_trabajo' | translate: { v0: orders().length } }}</h1>
            @if (liveEnabled) {
              <app-ot-live-indicator [state]="simulationEnabled ? simulator.connection() : realtime.connection()" [simulated]="simulationEnabled" />
            }
          </div>
          <p class="text-sm text-tinta-suave ">
            @if (canChangeStatus()) {
              {{ 'ot.usa_la_columna_estado' | translate }}
            } @else if (canStartOwn()) {
              {{ 'ot.aqui_ves_las_ordenes' | translate }}
            } @else {
              {{ 'ot.consulta_el_estado_de' | translate }}
            }
          </p>
        </div>
        @if (permissions.canPerform('crear_ot')) {
          <button type="button" class="btn-primary" (click)="isCreateModalOpen.set(true)">{{ 'ot.crear_ot' | translate }}</button>
        }
      </div>

      @if (isCreateModalOpen()) {
        <app-create-ot-modal (closed)="isCreateModalOpen.set(false)" (created)="onOtCreated($event)" />
      }

      @if (loading()) {
        <div class="py-10 text-center text-tinta-suave " role="status">{{ 'ot.cargando_ordenes' | translate }}</div>
      } @else if (error()) {
        <div class="rounded-control border border-peligro bg-peligro-suave px-4 py-3 text-sm text-peligro" role="alert">
          {{ error() }} <button type="button" class="ml-2 underline" (click)="load()">{{ 'ot.reintentar' | translate }}</button>
        </div>
      } @else {
        <app-ot-filter-bar [counts]="counts()" [(status)]="statusFilter" [(search)]="search" />

        <div class="overflow-x-auto rounded-control border border-borde bg-superficie ">
          <table class="tabla-apilada w-full text-sm text-tinta">
            <caption class="sr-only">{{ 'ot.listado_de_ordenes_de' | translate }}</caption>
            <thead class="bg-superficie-2 text-sm text-tinta-suave">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">{{ 'ot.n_ot' | translate }}</th>
                @if (tenant.isSuper()) {
                  <th scope="col" class="px-4 py-2 text-left">{{ 'ot.empresa' | translate }}</th>
                }
                <th scope="col" class="px-4 py-2 text-left">{{ 'ot.descripcion' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'ot.maquina' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'ot.tecnico' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'ot.prioridad' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'ot.estado' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'ot.creada' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (ot of filtered(); track ot.ot_id) {
                <tr
                  class="border-t border-borde transition-colors hover:bg-superficie-2"
                  [class.bg-media-suave]="recentlyChanged().has(ot.numero_ot)">
                  <td class="whitespace-nowrap px-4 py-2" [attr.data-label]="'ot.n_ot' | translate">
                    <button
                      type="button"
                      class="rounded-control codigo text-accion underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-accion"
                      [attr.aria-label]="'ot.ver_detalle_de_la' | translate: { v0: ot.numero_ot }"
                      (click)="openDetail(ot)">
                      {{ ot.numero_ot }}
                    </button>
                  </td>
                  @if (tenant.isSuper()) {
                    <td class="px-4 py-2" [attr.data-label]="'ot.empresa' | translate">{{ ot.empresa_nombre }}</td>
                  }
                  <td class="max-w-xs px-4 py-2" [attr.data-label]="'ot.descripcion' | translate">
                    <p class="line-clamp-2" [title]="ot.title">{{ ot.title }}</p>
                    <p class="text-sm text-tinta-suave">{{ tipo(ot.tipo) }}</p>
                  </td>
                  <td class="px-4 py-2" [attr.data-label]="'ot.maquina' | translate">
                    <p>{{ ot.machine_name }}</p>
                    <p class="text-sm text-tinta-suave">{{ ot.plant_name }}</p>
                  </td>
                  <td class="px-4 py-2" [attr.data-label]="'ot.tecnico' | translate">{{ ot.tecnico_nombre || ('ot.sin_asignar' | translate) }}</td>
                  <td class="px-4 py-2" [attr.data-label]="'ot.prioridad' | translate">
                    <span class="rounded-full px-2.5 py-1 text-sm font-medium" [class]="priority(ot.priority).badge">
                      {{ priority(ot.priority).label }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-4 py-2" [attr.data-label]="'ot.estado' | translate">
                    <app-ot-status-select [order]="ot" (changeRequested)="requestChange($event)" />
                  </td>
                  <td class="whitespace-nowrap px-4 py-2 text-tinta" [attr.data-label]="'ot.creada' | translate">{{ ot.created_at | date: 'dd/MM/yyyy HH:mm' }}</td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="tenant.isSuper() ? 8 : 7" class="py-6 text-center text-tinta-suave">
                    {{ (orders().length ? 'ot.ninguna_orden_coincide_con' : 'ot.no_hay_ordenes_registradas') | translate }}
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
  private readonly i18n = inject(I18nService);
  private readonly workOrdersService = inject(WorkOrdersService);
  private readonly toast = inject(ToastService);
  protected readonly permissions = inject(PermissionsService);
  protected readonly tenant = inject(TenantContextService);
  protected readonly simulator = inject(OtLiveSimulatorService);
  protected readonly realtime = inject(OtRealtimeService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  /** Demo con cambios falsos (apagada por defecto). Tiene prioridad sobre el canal real si alguien la enciende. */
  protected readonly simulationEnabled = environment.liveSimulation;
  /** Cambios reales de otros usuarios, por SSE. */
  protected readonly realtimeEnabled = environment.liveRealtime && !environment.liveSimulation;
  protected readonly liveEnabled = this.simulationEnabled || this.realtimeEnabled;
  /** Filas con un cambio en vivo reciente (resaltadas ~2 s). */
  protected readonly recentlyChanged = signal<ReadonlySet<string>>(new Set());

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
  /** El técnico no cambia estados en general: solo inicia las OT que tiene asignadas. */
  protected readonly canStartOwn = computed(() => this.permissions.canPerform('iniciar_ot_asignada'));

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
    if (this.simulationEnabled) this.startLive();
    else if (this.realtimeEnabled) this.startRealtime();
  }

  private startRealtime(): void {
    this.realtime.start();
    this.destroyRef.onDestroy(() => this.realtime.stop());
    this.realtime.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => this.onRealtimeEvent(event));
  }

  /** Cambios hechos por OTROS usuarios. Lo que hace este usuario ya se refleja con la respuesta de su propia petición. */
  private onRealtimeEvent(event: OtRealtimeEvent): void {
    if (event.type === 'resync') {
      this.reloadSilently();
      return;
    }
    if (event.usuario_id !== null && event.usuario_id === Number(this.auth.user()?.id)) return;

    if (event.type === 'status_changed') {
      const previous = this.orders().find(ot => ot.numero_ot === event.numero_ot);
      if (!previous) return;
      this.refreshOrder(event.numero_ot, true);
      this.toast.info(
        `${event.numero_ot}: ${statusMeta(event.estado_anterior).label} → ${statusMeta(event.estado_nuevo).label}`,
      );
    } else if (event.type === 'created') {
      this.reloadSilently();
      this.toast.info(this.i18n.tr('ot.nueva_ot_creada', { v0: event.numero_ot }));
    } else {
      this.orders.update(list => list.filter(ot => ot.numero_ot !== event.numero_ot));
      if (this.detail()?.numero_ot === event.numero_ot) this.detail.set(null);
    }
  }

  /** Vuelve a pedir la lista sin mostrar el esqueleto de carga ni borrar lo que se ve si falla. */
  private reloadSilently(): void {
    this.workOrdersService.getAll().subscribe({
      next: data => {
        if (Array.isArray(data)) this.orders.set(data);
      },
    });
  }

  private highlight(numeroOt: string): void {
    this.recentlyChanged.update(set => new Set(set).add(numeroOt));
    setTimeout(
      () =>
        this.recentlyChanged.update(set => {
          const next = new Set(set);
          next.delete(numeroOt);
          return next;
        }),
      2000,
    );
  }

  private startLive(): void {
    this.simulator.start(() => this.orders());
    this.destroyRef.onDestroy(() => this.simulator.stop());
    this.simulator.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(updated => this.applyLiveChange(updated));
  }

  private applyLiveChange(updated: WorkOrder): void {
    const previous = this.orders().find(ot => ot.numero_ot === updated.numero_ot);
    if (!previous) return;

    this.orders.update(list => list.map(ot => (ot.numero_ot === updated.numero_ot ? updated : ot)));
    if (this.detail()?.numero_ot === updated.numero_ot) this.detail.set(updated);
    this.toast.info(`${updated.numero_ot}: ${statusMeta(previous.estado).label} → ${statusMeta(updated.estado).label}`);
    this.highlight(updated.numero_ot);
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
        this.error.set(apiErrorMessage(err, this.i18n.tr('ot.no_se_pudieron_cargar')));
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
      error: err => this.toast.error(apiErrorMessage(err, this.i18n.tr('ot.no_se_pudo_cargar'))),
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
        const message = apiErrorMessage(err, this.i18n.tr('ot.no_se_pudo_actualizar'));
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

  private refreshOrder(numeroOt: string, destacar = false): void {
    this.workOrdersService.getByNumber(numeroOt).subscribe({
      next: fresh => {
        this.orders.update(list => list.map(ot => (ot.numero_ot === fresh.numero_ot ? fresh : ot)));
        if (this.detail()?.numero_ot === fresh.numero_ot) this.detail.set(fresh);
        if (destacar) this.highlight(fresh.numero_ot);
      },
      error: () => this.load(),
    });
  }
}
