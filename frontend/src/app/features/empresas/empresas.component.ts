import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Empresa, EstadoEmpresa } from '../../core/models';
import { EmpresasService } from '../../core/services/empresas.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { EmpresaFormModalComponent } from './empresa-form-modal.component';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { textoActual } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
// Con `get`: el texto se calcula al leerlo, así sigue el idioma elegido.
const ESTADO_LABEL: Record<EstadoEmpresa, string> = {
  get active() { return textoActual('empresas.activa'); },
  get suspended() { return textoActual('empresas.suspendida'); },
  get cancelled() { return textoActual('empresas.cancelada'); },
};

const ESTADO_STYLE: Record<EstadoEmpresa, string> = {
  active: 'bg-ok-suave text-ok',
  suspended: 'bg-media-suave text-media',
  cancelled: 'bg-peligro-suave text-peligro',
};

/** Mantenedor de empresas (solo super_usuario): alta, edición, suspensión/reactivación y acceso a sus gerentes. Por auditoría no se eliminan. */
@Component({
  selector: 'app-empresas',
  imports: [EmpresaFormModalComponent, TranslatePipe],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="empresas-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="empresas-title" class="text-2xl font-bold text-tinta ">
            {{ 'empresas.empresas' | translate: { v0: empresas().length } }}
          </h1>
          <p class="text-sm text-tinta-suave ">
            {{ 'empresas.clientes_de_la_plataforma' | translate }}
          </p>
        </div>
        <button type="button" class="btn-primary" (click)="openCreate()">{{ 'empresas.nueva_empresa' | translate }}</button>
      </div>

      <div>
        <label for="empresa-filtro" class="sr-only">{{ 'empresas.buscar_empresa' | translate }}</label>
        <input
          id="empresa-filtro"
          type="search"
          [attr.placeholder]="'empresas.buscar_por_nombre_rut' | translate"
          class="w-full max-w-sm rounded-control border border-borde-control bg-superficie px-3 py-2 text-sm text-tinta focus:outline-none focus:ring-2 focus:ring-accion"
          [value]="filtro()"
          (input)="filtro.set($any($event.target).value)" />
      </div>

      @if (loading()) {
        <div class="py-10 text-center text-tinta-suave" role="status">{{ 'empresas.cargando_empresas' | translate }}</div>
      } @else if (error()) {
        <div class="rounded-control border border-peligro bg-peligro-suave px-4 py-3 text-sm text-peligro" role="alert">
          {{ error() }}
          <button type="button" class="ml-2 underline" (click)="load()">{{ 'empresas.reintentar' | translate }}</button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-control border border-borde bg-superficie ">
          <table class="tabla-apilada w-full text-sm text-tinta">
            <caption class="sr-only">{{ 'empresas.listado_de_empresas' | translate }}</caption>
            <thead class="bg-superficie-2 text-sm text-tinta-suave">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">{{ 'empresas.empresa' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'empresas.estado' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-right">{{ 'empresas.usuarios' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-right">{{ 'empresas.docs' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-right">{{ 'empresas.ots' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'empresas.acciones' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (e of filtradas(); track e.empresa_id) {
                <tr class="border-t border-borde hover:bg-superficie-2">
                  <td class="px-4 py-2" [attr.data-label]="'empresas.empresa' | translate">
                    <div class="font-medium">{{ e.nombre }}</div>
                    <div class="text-sm text-tinta-suave">{{ e.rut || ('empresas.sin_rut' | translate) }} · {{ e.industria || ('empresas.sin_industria' | translate) }}</div>
                  </td>
                  <td class="px-4 py-2" [attr.data-label]="'empresas.estado' | translate">
                    <span class="rounded-control px-2 py-1 text-sm font-medium" [class]="estadoStyle(e.estado)">
                      {{ estadoLabel(e.estado) }}
                    </span>
                  </td>
                  <td class="px-4 py-2 text-right" [class.text-peligro]="e.usuarios_activos >= e.max_usuarios" [attr.data-label]="'empresas.usuarios' | translate">
                    {{ e.usuarios_activos }} / {{ e.max_usuarios }}
                  </td>
                  <td class="px-4 py-2 text-right" [attr.data-label]="'empresas.docs' | translate">{{ e.documentos }}</td>
                  <td class="px-4 py-2 text-right" [attr.data-label]="'empresas.ots' | translate">{{ e.ordenes_trabajo }}</td>
                  <td class="px-4 py-2" [attr.data-label]="'empresas.acciones' | translate">
                    <div class="flex flex-wrap gap-1">
                      <button type="button" class="btn-secondary" (click)="openEdit(e)" [attr.aria-label]="'empresas.editar_2' | translate: { v0: e.nombre }">{{ 'empresas.editar' | translate }}</button>
                      <button type="button" class="btn-secondary" (click)="goToUsuarios(e)" [attr.aria-label]="'empresas.gerentes_de' | translate: { v0: e.nombre }">{{ 'empresas.gerentes' | translate }}</button>
                      @if (e.estado === 'suspended' || e.estado === 'cancelled') {
                        <button type="button" class="btn-secondary" (click)="setEstado(e, 'active')" [attr.aria-label]="'empresas.reactivar_2' | translate: { v0: e.nombre }">{{ 'empresas.reactivar' | translate }}</button>
                      } @else {
                        <button type="button" class="btn-secondary" (click)="setEstado(e, 'suspended')" [attr.aria-label]="'empresas.suspender_2' | translate: { v0: e.nombre }">{{ 'empresas.suspender' | translate }}</button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="py-6 text-center text-tinta-suave">{{ 'empresas.no_hay_empresas_que' | translate }}</td>
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
  private readonly i18n = inject(I18nService);
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
        this.error.set(apiErrorMessage(err, this.i18n.tr('empresas.no_se_pudieron_cargar')));
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
    const pregunta = estado === 'active'
      ? this.i18n.tr('empresas.seguro_que_quieres_reactivar', { v0: e.nombre })
      : this.i18n.tr('empresas.seguro_que_quieres_suspender', { v0: e.nombre });
    if (!confirm(pregunta)) return;

    this.service.update(e.empresa_id, { estado }).subscribe({
      next: () => {
        this.toast.success(this.i18n.tr(estado === 'active' ? 'empresas.empresa_reactivada' : 'empresas.empresa_suspendida'));
        this.load();
      },
      error: (err) => this.toast.error(apiErrorMessage(err, this.i18n.tr('empresas.no_se_pudo_cambiar'))),
    });
  }
}
