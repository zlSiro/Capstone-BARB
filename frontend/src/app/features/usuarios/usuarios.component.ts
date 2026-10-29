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

/**
 * Mantenedor de perfiles de usuario.
 * - Gerente/admin de empresa: gestiona solo los usuarios de su empresa (lo garantiza el backend).
 * - super_usuario: solo crea y gestiona usuarios con perfil gerente de cualquier empresa.
 * Por auditoría los usuarios no se eliminan: solo se activan o desactivan.
 */
@Component({
  selector: 'app-usuarios',
  imports: [DatePipe, UsuarioFormModalComponent],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="usuarios-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="usuarios-title" class="text-2xl font-bold text-tinta ">
            {{ isSuper() ? 'Gerentes' : 'Usuarios' }} ({{ usuarios().length }})
          </h1>
          <p class="text-sm text-tinta-suave ">
            @if (isSuper()) {
              Gerentes de las empresas{{ tenant.empresaId() ? ' (filtrado por la empresa seleccionada)' : '' }}.
              @if (tenant.empresaId()) {
                <button type="button" class="ml-1 underline" (click)="clearEmpresaFilter()">Ver todas</button>
              }
            } @else {
              Perfiles de los miembros de {{ auth.user()?.empresa_nombre }}.
            }
          </p>
        </div>
        <button type="button" class="btn-primary" (click)="openCreate()">+ Nuevo usuario</button>
      </div>

      <div>
        <label for="usuario-filtro" class="sr-only">Buscar usuario</label>
        <input
          id="usuario-filtro"
          type="search"
          placeholder="Buscar por nombre, email o rol…"
          class="w-full max-w-sm rounded-control border border-borde-control bg-superficie px-3 py-2 text-sm text-tinta focus:outline-none focus:ring-2 focus:ring-accion"
          [value]="filtro()"
          (input)="filtro.set($any($event.target).value)" />
      </div>

      @if (loading()) {
        <div class="py-10 text-center text-tinta-suave" role="status">Cargando usuarios…</div>
      } @else if (error()) {
        <div class="rounded-control border border-peligro bg-peligro-suave px-4 py-3 text-sm text-peligro" role="alert">
          {{ error() }} <button type="button" class="ml-2 underline" (click)="load()">Reintentar</button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-control border border-borde bg-superficie ">
          <table class="tabla-apilada w-full text-sm text-tinta">
            <caption class="sr-only">Listado de usuarios</caption>
            <thead class="bg-superficie-2 text-sm text-tinta-suave">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">Usuario</th>
                <th scope="col" class="px-4 py-2 text-left">Rol</th>
                @if (isSuper()) {
                  <th scope="col" class="px-4 py-2 text-left">Empresa</th>
                }
                <th scope="col" class="px-4 py-2 text-left">Estado</th>
                <th scope="col" class="px-4 py-2 text-left">Último acceso</th>
                <th scope="col" class="px-4 py-2 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (u of filtrados(); track u.usuario_id) {
                <tr class="border-t border-borde hover:bg-superficie-2">
                  <td class="px-4 py-2" data-label="Usuario">
                    <div class="font-medium">{{ u.nombre }}</div>
                    <div class="text-sm text-tinta-suave">{{ u.email }}</div>
                  </td>
                  <td class="px-4 py-2" data-label="Rol">
                    <span class="rounded-control bg-accion-suave px-2 py-1 text-sm font-medium text-accion">{{ rolLabel(u.rol) }}</span>
                  </td>
                  @if (isSuper()) {
                    <td class="px-4 py-2" data-label="Empresa">{{ u.empresa_nombre ?? 'Plataforma BARB' }}</td>
                  }
                  <td class="px-4 py-2" data-label="Estado">
                    <span class="rounded-control px-2 py-1 text-sm font-medium"
                          [class]="u.activo ? 'bg-ok-suave text-ok' : 'bg-borde text-tinta'">
                      {{ u.activo ? 'Activo' : 'Inactivo' }}
                    </span>
                  </td>
                  <td class="px-4 py-2" data-label="Último acceso">{{ u.ultimo_login ? (u.ultimo_login | date: 'dd-MM-yyyy HH:mm') : 'Nunca' }}</td>
                  <td class="px-4 py-2" data-label="Acciones">
                    <div class="flex flex-wrap gap-1">
                      <button type="button" class="btn-secondary" (click)="openEdit(u)" [attr.aria-label]="'Editar ' + u.nombre">Editar</button>
                      @if (!esYo(u)) {
                        <button type="button" class="btn-secondary" (click)="toggleActivo(u)"
                                [attr.aria-label]="(u.activo ? 'Desactivar ' : 'Activar ') + u.nombre">
                          {{ u.activo ? 'Desactivar' : 'Activar' }}
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="isSuper() ? 6 : 5" class="py-6 text-center text-tinta-suave">No hay usuarios que coincidan.</td>
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
        this.error.set(apiErrorMessage(err, 'No se pudieron cargar los usuarios.'));
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
        this.toast.success(u.activo ? 'Usuario desactivado.' : 'Usuario activado.');
        this.load();
      },
      error: (err) => this.toast.error(apiErrorMessage(err, 'No se pudo cambiar el estado.')),
    });
  }
}
