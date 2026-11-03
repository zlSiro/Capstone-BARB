import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Empresa, UsuarioPerfil } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { EmpresasService } from '../../core/services/empresas.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { ToastService } from '../../core/services/toast.service';
import { UsersAdminService } from '../../core/services/users-admin.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ROLE_OPTIONS, UsuarioFormModalComponent } from './usuario-form-modal.component';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
/**
 * Mantenedor de perfiles de usuario.
 * - Gerente/admin de empresa: gestiona solo los usuarios de su empresa (lo garantiza el backend).
 * - super_usuario: solo crea y gestiona usuarios con perfil gerente de cualquier empresa.
 * Por auditoría los usuarios no se eliminan: solo se activan o desactivan.
 */
@Component({
  selector: 'app-usuarios',
  imports: [DatePipe, UsuarioFormModalComponent, TranslatePipe],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="usuarios-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="usuarios-title" class="text-2xl font-bold text-tinta ">
            {{ (isSuper() ? 'usuarios.gerentes' : 'usuarios.usuarios') | translate }} ({{ usuarios().length }})
          </h1>
          <p class="text-sm text-tinta-suave ">
            @if (isSuper()) {
              {{ 'usuarios.gerentes_de_las_empresas' | translate: { v0: tenant.empresaId() ? (' ' + ('usuarios.filtrado_por_la_empresa' | translate)) : '' } }}
              @if (tenant.empresaId()) {
                <button type="button" class="ml-1 underline" (click)="clearEmpresaFilter()">{{ 'usuarios.ver_todas' | translate }}</button>
              }
            } @else {
              {{ 'usuarios.perfiles_de_los_miembros' | translate: { v0: auth.user()?.empresa_nombre } }}
            }
          </p>
        </div>
        <button type="button" class="btn-primary" (click)="openCreate()">{{ 'usuarios.nuevo_usuario' | translate }}</button>
      </div>

      <div>
        <label for="usuario-filtro" class="sr-only">{{ 'usuarios.buscar_usuario' | translate }}</label>
        <input
          id="usuario-filtro"
          type="search"
          [attr.placeholder]="'usuarios.buscar_por_nombre_email' | translate"
          class="w-full max-w-sm rounded-control border border-borde-control bg-superficie px-3 py-2 text-sm text-tinta focus:outline-none focus:ring-2 focus:ring-accion"
          [value]="filtro()"
          (input)="filtro.set($any($event.target).value)" />
      </div>

      @if (loading()) {
        <div class="py-10 text-center text-tinta-suave" role="status">{{ 'usuarios.cargando_usuarios' | translate }}</div>
      } @else if (error()) {
        <div class="rounded-control border border-peligro bg-peligro-suave px-4 py-3 text-sm text-peligro" role="alert">
          {{ error() }} <button type="button" class="ml-2 underline" (click)="load()">{{ 'usuarios.reintentar' | translate }}</button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-control border border-borde bg-superficie ">
          <table class="tabla-apilada w-full text-sm text-tinta">
            <caption class="sr-only">{{ 'usuarios.listado_de_usuarios' | translate }}</caption>
            <thead class="bg-superficie-2 text-sm text-tinta-suave">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">{{ 'usuarios.usuario' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'usuarios.rol' | translate }}</th>
                @if (isSuper()) {
                  <th scope="col" class="px-4 py-2 text-left">{{ 'usuarios.empresa' | translate }}</th>
                }
                <th scope="col" class="px-4 py-2 text-left">{{ 'usuarios.estado' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'usuarios.ultimo_acceso' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'usuarios.acciones' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (u of filtrados(); track u.usuario_id) {
                <tr class="border-t border-borde hover:bg-superficie-2">
                  <td class="px-4 py-2" [attr.data-label]="'usuarios.usuario' | translate">
                    <div class="font-medium">{{ u.nombre }}</div>
                    <div class="text-sm text-tinta-suave">{{ u.email }}</div>
                  </td>
                  <td class="px-4 py-2" [attr.data-label]="'usuarios.rol' | translate">
                    <span class="rounded-control bg-accion-suave px-2 py-1 text-sm font-medium text-accion">{{ rolLabel(u.rol) }}</span>
                  </td>
                  @if (isSuper()) {
                    <td class="px-4 py-2" [attr.data-label]="'usuarios.empresa' | translate">{{ u.empresa_nombre ?? ('usuarios.plataforma_barb' | translate) }}</td>
                  }
                  <td class="px-4 py-2" [attr.data-label]="'usuarios.estado' | translate">
                    <span class="rounded-control px-2 py-1 text-sm font-medium"
                          [class]="u.activo ? 'bg-ok-suave text-ok' : 'bg-borde text-tinta'">
                      {{ (u.activo ? 'usuarios.activo' : 'usuarios.inactivo') | translate }}
                    </span>
                  </td>
                  <td class="px-4 py-2" [attr.data-label]="'usuarios.ultimo_acceso' | translate">{{ u.ultimo_login ? (u.ultimo_login | date: 'dd-MM-yyyy HH:mm') : ('usuarios.nunca' | translate) }}</td>
                  <td class="px-4 py-2" [attr.data-label]="'usuarios.acciones' | translate">
                    <div class="flex flex-wrap gap-1">
                      <button type="button" class="btn-secondary" (click)="openEdit(u)" [attr.aria-label]="'usuarios.editar_2' | translate: { v0: u.nombre }">{{ 'usuarios.editar' | translate }}</button>
                      @if (!esYo(u)) {
                        <button type="button" class="btn-secondary" (click)="toggleActivo(u)"
                                [attr.aria-label]="(u.activo ? 'usuarios.desactivar' : 'usuarios.activar') | translate: { v0: u.nombre }">
                          {{ (u.activo ? 'usuarios.desactivar_2' : 'usuarios.activar_2') | translate }}
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="isSuper() ? 6 : 5" class="py-6 text-center text-tinta-suave">{{ 'usuarios.no_hay_usuarios_que' | translate }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (modalOpen()) {
      <app-usuario-form-modal
        [usuario]="editing()"
        [isSuper]="isSuper()"
        [soloOperativos]="soloOperativos()"
        [empresas]="empresas()"
        [defaultEmpresaId]="tenant.empresaId()"
        (closed)="modalOpen.set(false)"
        (saved)="onSaved()" />
    }
  `,
})
export class UsuariosComponent {
  private readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  protected readonly tenant = inject(TenantContextService);
  private readonly users = inject(UsersAdminService);
  private readonly empresasService = inject(EmpresasService);
  private readonly toast = inject(ToastService);

  protected readonly isSuper = this.tenant.isSuper;
  /** El administrador de empresa solo gestiona roles operativos (no gerentes ni otros administradores). */
  protected readonly soloOperativos = computed(() => this.auth.user()?.role === 'admin');
  protected readonly usuarios = signal<UsuarioPerfil[]>([]);
  protected readonly empresas = signal<Empresa[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly filtro = signal('');
  protected readonly modalOpen = signal(false);
  protected readonly editing = signal<UsuarioPerfil | null>(null);

  protected readonly filtrados = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return this.usuarios();
    return this.usuarios().filter(u =>
      [u.nombre, u.email, u.rol, u.empresa_nombre].some(v => (v ?? '').toLowerCase().includes(q)));
  });

  constructor() {
    this.load();
    // El super_usuario necesita la lista de empresas para asignar el usuario a una.
    if (this.isSuper()) {
      this.empresasService.getAll().subscribe({ next: (e) => this.empresas.set(e) });
    }
  }

  /** Quita el filtro por empresa que dejó el atajo "Gerentes" del mantenedor de empresas. */
  protected clearEmpresaFilter(): void {
    this.tenant.select(null);
    this.load();
  }

  protected rolLabel(rol: string): string {
    return ROLE_OPTIONS.find(r => r.value === rol)?.label ?? rol;
  }

  protected esYo(u: UsuarioPerfil): boolean {
    return String(u.usuario_id) === String(this.auth.user()?.id);
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.users.getAll().subscribe({
      next: (data) => {
        this.usuarios.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, this.i18n.tr('usuarios.no_se_pudieron_cargar')));
        this.loading.set(false);
      },
    });
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(u: UsuarioPerfil): void {
    this.editing.set(u);
    this.modalOpen.set(true);
  }

  protected onSaved(): void {
    this.modalOpen.set(false);
    this.load();
  }

  protected toggleActivo(u: UsuarioPerfil): void {
    this.users.update(u.usuario_id, { activo: !u.activo }).subscribe({
      next: () => {
        this.toast.success(this.i18n.tr(u.activo ? 'usuarios.usuario_desactivado' : 'usuarios.usuario_activado'));
        this.load();
      },
      error: (err) => this.toast.error(apiErrorMessage(err, this.i18n.tr('usuarios.no_se_pudo_cambiar'))),
    });
  }
}
