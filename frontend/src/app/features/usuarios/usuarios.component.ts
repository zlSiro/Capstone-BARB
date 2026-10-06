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
 * - Admin de empresa: gestiona solo los usuarios de su empresa (lo garantiza el backend).
 * - super_usuario: gestiona los de cualquier empresa (filtra con el selector de la cabecera).
 */
@Component({
  selector: 'app-usuarios',
  imports: [DatePipe, UsuarioFormModalComponent],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="usuarios-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="usuarios-title" class="text-2xl font-bold text-gray-800 dark:text-gray-100">
            Usuarios ({{ usuarios().length }})
          </h1>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            @if (isSuper()) {
              {{ tenant.empresaId() ? 'Usuarios de la empresa seleccionada.' : 'Usuarios de todas las empresas.' }}
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
          class="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          [value]="filtro()"
          (input)="filtro.set($any($event.target).value)" />
      </div>

      @if (loading()) {
        <div class="py-10 text-center text-gray-600" role="status">Cargando usuarios…</div>
      } @else if (error()) {
        <div class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {{ error() }} <button type="button" class="ml-2 underline" (click)="load()">Reintentar</button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm">
          <table class="w-full text-sm text-gray-800">
            <caption class="sr-only">Listado de usuarios</caption>
            <thead class="bg-gray-50 text-xs uppercase text-gray-600">
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
                <tr class="border-t border-gray-100 hover:bg-gray-50">
                  <td class="px-4 py-2">
                    <div class="font-medium">{{ u.nombre }}</div>
                    <div class="text-xs text-gray-600">{{ u.email }}</div>
                  </td>
                  <td class="px-4 py-2">
                    <span class="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">{{ rolLabel(u.rol) }}</span>
                  </td>
                  @if (isSuper()) {
                    <td class="px-4 py-2">{{ u.empresa_nombre ?? 'Plataforma BARB' }}</td>
                  }
                  <td class="px-4 py-2">
                    <span class="rounded px-2 py-1 text-xs font-medium"
                          [class]="u.activo ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'">
                      {{ u.activo ? 'Activo' : 'Inactivo' }}
                    </span>
                  </td>
                  <td class="px-4 py-2">{{ u.ultimo_login ? (u.ultimo_login | date: 'dd-MM-yyyy HH:mm') : 'Nunca' }}</td>
                  <td class="px-4 py-2">
                    <div class="flex flex-wrap gap-1">
                      <button type="button" class="btn-secondary" (click)="openEdit(u)" [attr.aria-label]="'Editar ' + u.nombre">Editar</button>
                      @if (!esYo(u)) {
                        <button type="button" class="btn-secondary" (click)="toggleActivo(u)"
                                [attr.aria-label]="(u.activo ? 'Desactivar ' : 'Activar ') + u.nombre">
                          {{ u.activo ? 'Desactivar' : 'Activar' }}
                        </button>
                        <button type="button" class="btn-danger" (click)="remove(u)" [attr.aria-label]="'Eliminar ' + u.nombre">Eliminar</button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="isSuper() ? 6 : 5" class="py-6 text-center text-gray-600">No hay usuarios que coincidan.</td>
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

  protected remove(u: UsuarioPerfil): void {
    if (!confirm(`¿Eliminar a ${u.nombre}? Si tiene OTs asociadas deberás desactivarlo en su lugar.`)) return;
    this.users.delete(u.usuario_id).subscribe({
      next: () => {
        this.toast.success('Usuario eliminado.');
        this.load();
      },
      error: (err) => this.toast.error(apiErrorMessage(err, 'No se pudo eliminar el usuario.')),
    });
  }
}
