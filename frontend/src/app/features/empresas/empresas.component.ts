import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';

import { Empresa, EstadoEmpresa } from '../../core/models';
import { EmpresasService } from '../../core/services/empresas.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { EmpresaFormModalComponent } from './empresa-form-modal.component';

const ESTADO_LABEL: Record<EstadoEmpresa, string> = {
  active: 'Activa',
  demo: 'Demo',
  suspended: 'Suspendida',
  cancelled: 'Cancelada',
};

const ESTADO_STYLE: Record<EstadoEmpresa, string> = {
  active: 'bg-ok-suave text-ok',
  demo: 'bg-accion-suave text-accion',
  suspended: 'bg-media-suave text-media',
  cancelled: 'bg-peligro-suave text-peligro',
};

/** Mantenedor de empresas (solo super_usuario): alta, edición, suspensión/reactivación y acceso a sus gerentes. Por auditoría no se eliminan. */
@Component({
  selector: 'app-empresas',
  imports: [DatePipe, EmpresaFormModalComponent],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="empresas-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="empresas-title" class="text-2xl font-bold text-tinta ">
            Empresas ({{ empresas().length }})
          </h1>
          <p class="text-sm text-tinta-suave ">
            Clientes de la plataforma. Aquí se crean, suspenden y habilitan; cada empresa administra a sus propios usuarios.
          </p>
        </div>
        <button type="button" class="btn-primary" (click)="openCreate()">+ Nueva empresa</button>
      </div>

      <div>
        <label for="empresa-filtro" class="sr-only">Buscar empresa</label>
        <input
          id="empresa-filtro"
          type="search"
          placeholder="Buscar por nombre, RUT o industria…"
          class="w-full max-w-sm rounded-control border border-borde-control bg-superficie px-3 py-2 text-sm text-tinta focus:outline-none focus:ring-2 focus:ring-accion"
          [value]="filtro()"
          (input)="filtro.set($any($event.target).value)" />
      </div>

      @if (loading()) {
        <div class="py-10 text-center text-tinta-suave" role="status">Cargando empresas…</div>
      } @else if (error()) {
        <div class="rounded-control border border-peligro bg-peligro-suave px-4 py-3 text-sm text-peligro" role="alert">
          {{ error() }}
          <button type="button" class="ml-2 underline" (click)="load()">Reintentar</button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-control border border-borde bg-superficie ">
          <table class="tabla-apilada w-full text-sm text-tinta">
            <caption class="sr-only">Listado de empresas</caption>
            <thead class="bg-superficie-2 text-sm text-tinta-suave">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">Empresa</th>
                <th scope="col" class="px-4 py-2 text-left">Plan</th>
                <th scope="col" class="px-4 py-2 text-left">Estado</th>
                <th scope="col" class="px-4 py-2 text-right">Usuarios</th>
                <th scope="col" class="px-4 py-2 text-right">Docs</th>
                <th scope="col" class="px-4 py-2 text-right">OTs</th>
                <th scope="col" class="px-4 py-2 text-left">Licencia hasta</th>
                <th scope="col" class="px-4 py-2 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (e of filtradas(); track e.empresa_id) {
                <tr class="border-t border-borde hover:bg-superficie-2">
                  <td class="px-4 py-2" data-label="Empresa">
                    <div class="font-medium">{{ e.nombre }}</div>
                    <div class="text-sm text-tinta-suave">{{ e.rut || 'Sin RUT' }} · {{ e.industria || 'Sin industria' }}</div>
                  </td>
                  <td class="px-4 py-2 capitalize" data-label="Plan">{{ e.plan }}</td>
                  <td class="px-4 py-2" data-label="Estado">
                    <span class="rounded-control px-2 py-1 text-sm font-medium" [class]="estadoStyle(e.estado)">
                      {{ estadoLabel(e.estado) }}
                    </span>
                  </td>
                  <td class="px-4 py-2 text-right" [class.text-peligro]="e.usuarios_activos >= e.max_usuarios" data-label="Usuarios">
                    {{ e.usuarios_activos }} / {{ e.max_usuarios }}
                  </td>
                  <td class="px-4 py-2 text-right" data-label="Docs">{{ e.documentos }}</td>
                  <td class="px-4 py-2 text-right" data-label="OTs">{{ e.ordenes_trabajo }}</td>
                  <td class="px-4 py-2" data-label="Licencia hasta">{{ e.licencia_fin ? (e.licencia_fin | date: 'dd-MM-yyyy') : '—' }}</td>
                  <td class="px-4 py-2" data-label="Acciones">
                    <div class="flex flex-wrap gap-1">
                      <button type="button" class="btn-secondary" (click)="openEdit(e)" [attr.aria-label]="'Editar ' + e.nombre">Editar</button>
                      <button type="button" class="btn-secondary" (click)="goToUsuarios(e)" [attr.aria-label]="'Gerentes de ' + e.nombre">Gerentes</button>
                      @if (e.estado === 'suspended' || e.estado === 'cancelled') {
                        <button type="button" class="btn-secondary" (click)="setEstado(e, 'active')" [attr.aria-label]="'Reactivar ' + e.nombre">Reactivar</button>
                      } @else {
                        <button type="button" class="btn-secondary" (click)="setEstado(e, 'suspended')" [attr.aria-label]="'Suspender ' + e.nombre">Suspender</button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="py-6 text-center text-tinta-suave">No hay empresas que coincidan.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (modalOpen()) {
      <app-empresa-form-modal [empresa]="editing()" (closed)="closeModal()" (saved)="onSaved()" />
    }
  `,
})
export class EmpresasComponent {
  private readonly service = inject(EmpresasService);
  private readonly toast = inject(ToastService);
  private readonly tenant = inject(TenantContextService);
  private readonly router = inject(Router);

  protected readonly empresas = signal<Empresa[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly filtro = signal('');
  protected readonly modalOpen = signal(false);
  protected readonly editing = signal<Empresa | null>(null);

  protected readonly filtradas = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return this.empresas();
    return this.empresas().filter(e =>
      [e.nombre, e.rut, e.industria].some(v => (v ?? '').toLowerCase().includes(q)));
  });

  constructor() {
    this.load();
  }

  protected estadoLabel = (s: EstadoEmpresa) => ESTADO_LABEL[s];
  protected estadoStyle = (s: EstadoEmpresa) => ESTADO_STYLE[s];

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.getAll().subscribe({
      next: (data) => {
        this.empresas.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'No se pudieron cargar las empresas.'));
        this.loading.set(false);
      },
    });
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(e: Empresa): void {
    this.editing.set(e);
    this.modalOpen.set(true);
  }

  protected closeModal(): void {
    this.modalOpen.set(false);
  }

  protected onSaved(): void {
    this.modalOpen.set(false);
    this.load();
  }

  /** Filtra el mantenedor de usuarios por la empresa y lo abre (el super_usuario solo gestiona gerentes). */
  protected goToUsuarios(e: Empresa): void {
    this.tenant.select(e.empresa_id);
    this.router.navigateByUrl('/usuarios');
  }

  protected setEstado(e: Empresa, estado: EstadoEmpresa): void {
    const accion = estado === 'active' ? 'reactivar' : 'suspender';
    const aviso = estado === 'active' ? '' : ' Sus usuarios perderán el acceso y se cerrarán sus sesiones.';
    if (!confirm(`¿Seguro que quieres ${accion} "${e.nombre}"?${aviso}`)) return;

    this.service.update(e.empresa_id, { estado }).subscribe({
      next: () => {
        this.toast.success(`Empresa ${estado === 'active' ? 'reactivada' : 'suspendida'}.`);
        this.load();
      },
      error: (err) => this.toast.error(apiErrorMessage(err, 'No se pudo cambiar el estado.')),
    });
  }
}
