import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, email, form, required, validate } from '@angular/forms/signals';

import { Empresa, Role, UserCreateRequest, UserUpdateRequest, UsuarioPerfil } from '../../core/models';
import { ToastService } from '../../core/services/toast.service';
import { UsersAdminService } from '../../core/services/users-admin.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Administrador de empresa' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'engineer', label: 'Ingeniero' },
  { value: 'tecnico', label: 'Técnico' },
  { value: 'operador', label: 'Operador' },
  { value: 'visitante', label: 'Visitante (solo lectura)' },
  { value: 'super_usuario', label: 'Super usuario (plataforma BARB)' },
];

interface UsuarioFormModel {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  activo: boolean;
  empresa_id: string; // '' = sin seleccionar (select nativo trabaja con strings)
}

/** Alta y edición del perfil de un usuario. */
@Component({
  selector: 'app-usuario-form-modal',
  imports: [FormField, ModalComponent],
  template: `
    <app-modal
      [title]="isEdit() ? 'Editar usuario' : 'Nuevo usuario'"
      [subtitle]="isEdit() ? 'Modifica el perfil, el rol o la contraseña.' : 'Crea el perfil de un miembro de la empresa.'"
      (closed)="closed.emit()">
      <form class="grid gap-4" (submit)="$event.preventDefault(); submit()" novalidate>
        @if (isSuper() && !isEdit() && !esSuperRol()) {
          <div>
            <label for="usr-empresa" class="fld-label">Empresa *</label>
            <select id="usr-empresa" class="fld-input" [formField]="f.empresa_id">
              <option value="">Selecciona una empresa</option>
              @for (e of empresas(); track e.empresa_id) {
                <option [value]="e.empresa_id">{{ e.nombre }}</option>
              }
            </select>
            @if (f.empresa_id().touched() && f.empresa_id().invalid()) {
              <p role="alert" class="fld-error">{{ f.empresa_id().errors()[0]?.message }}</p>
            }
          </div>
        }

        <div>
          <label for="usr-nombre" class="fld-label">Nombre *</label>
          <input id="usr-nombre" type="text" class="fld-input" [formField]="f.nombre" />
          @if (f.nombre().touched() && f.nombre().invalid()) {
            <p role="alert" class="fld-error">{{ f.nombre().errors()[0]?.message }}</p>
          }
        </div>

        <div>
          <label for="usr-email" class="fld-label">Email *</label>
          <input id="usr-email" type="email" autocomplete="off" class="fld-input" [formField]="f.email" />
          @if (f.email().touched() && f.email().invalid()) {
            <p role="alert" class="fld-error">{{ f.email().errors()[0]?.message }}</p>
          }
        </div>

        <div>
          <label for="usr-pass" class="fld-label">
            Contraseña {{ isEdit() ? '(vacío = no cambiar)' : '* (mín. 6 caracteres)' }}
          </label>
          <input id="usr-pass" type="password" autocomplete="new-password" class="fld-input" [formField]="f.password" />
          @if (f.password().touched() && f.password().invalid()) {
            <p role="alert" class="fld-error">{{ f.password().errors()[0]?.message }}</p>
          }
        </div>

        <div>
          <label for="usr-rol" class="fld-label">Rol *</label>
          <select id="usr-rol" class="fld-input" [formField]="f.rol">
            @for (r of roles(); track r.value) {
              <option [value]="r.value">{{ r.label }}</option>
            }
          </select>
        </div>

        <label class="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" class="h-4 w-4" [formField]="f.activo" />
          Usuario activo (puede iniciar sesión)
        </label>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" (click)="closed.emit()"
                  class="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" [disabled]="submitting()">
            {{ submitting() ? 'Guardando…' : isEdit() ? 'Guardar cambios' : 'Crear usuario' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class UsuarioFormModalComponent {
  private readonly users = inject(UsersAdminService);
  private readonly toast = inject(ToastService);

  /** Usuario a editar; null = alta. */
  readonly usuario = input<UsuarioPerfil | null>(null);
  readonly isSuper = input(false);
  /** Empresas disponibles para el selector (solo super_usuario). */
  readonly empresas = input<Empresa[]>([]);
  /** Empresa preseleccionada (la que el super_usuario tiene activa en la cabecera). */
  readonly defaultEmpresaId = input<number | null>(null);

  readonly closed = output<void>();
  readonly saved = output<UsuarioPerfil>();

  protected readonly submitting = signal(false);
  protected readonly isEdit = computed(() => this.usuario() !== null);
  // Un admin de empresa no puede asignar el rol super_usuario (el backend también lo rechaza).
  protected readonly roles = computed(() =>
    this.isSuper() ? ROLE_OPTIONS : ROLE_OPTIONS.filter(r => r.value !== 'super_usuario'));

  protected readonly model = linkedSignal<UsuarioFormModel>(() => {
    const u = this.usuario();
    return {
      nombre: u?.nombre ?? '',
      email: u?.email ?? '',
      password: '',
      rol: u?.rol ?? 'tecnico',
      activo: u?.activo ?? true,
      empresa_id: this.defaultEmpresaId() ? String(this.defaultEmpresaId()) : '',
    };
  });
  protected readonly esSuperRol = computed(() => this.model().rol === 'super_usuario');

  protected readonly f = form(this.model, (p) => {
    required(p.nombre, { message: 'Ingresa el nombre.' });
    validate(p.nombre, ({ value }) =>
      value().trim().length >= 2 ? undefined : { kind: 'minlength', message: 'El nombre debe tener al menos 2 caracteres.' });
    required(p.email, { message: 'Ingresa el email.' });
    email(p.email, { message: 'Email inválido.' });
    validate(p.password, ({ value }) => {
      const pass = value();
      if (!this.isEdit() && !pass) return { kind: 'required', message: 'Ingresa una contraseña.' };
      return pass && pass.length < 6 ? { kind: 'minlength', message: 'Mínimo 6 caracteres.' } : undefined;
    });
    validate(p.empresa_id, ({ value, valueOf }) =>
      this.isSuper() && !this.isEdit() && valueOf(p.rol) !== 'super_usuario' && !value()
        ? { kind: 'required', message: 'Selecciona una empresa.' }
        : undefined);
  });

  protected submit(): void {
    if (this.submitting()) return;
    this.f().markAsTouched();
    if (!this.f().valid()) return;

    const m = this.model();
    const current = this.usuario();
    this.submitting.set(true);

    const request$ = current
      ? this.users.update(current.usuario_id, this.buildUpdate(m, current))
      : this.users.create(this.buildCreate(m));

    request$.subscribe({
      next: (saved) => {
        this.toast.success(current ? 'Usuario actualizado.' : 'Usuario creado.');
        this.saved.emit(saved);
      },
      error: (err) => {
        this.submitting.set(false);
        this.toast.error(apiErrorMessage(err, 'No se pudo guardar el usuario.'));
      },
    });
  }

  private buildCreate(m: UsuarioFormModel): UserCreateRequest {
    const payload: UserCreateRequest = {
      nombre: m.nombre.trim(),
      email: m.email.trim(),
      password: m.password,
      rol: m.rol,
      activo: m.activo,
    };
    // Solo el super_usuario elige empresa; para el admin el backend usa la suya.
    if (this.isSuper() && m.rol !== 'super_usuario') payload.empresa_id = Number(m.empresa_id);
    return payload;
  }

  /** Solo envía lo que cambió, para no pisar datos ni forzar un cambio de contraseña. */
  private buildUpdate(m: UsuarioFormModel, current: UsuarioPerfil): UserUpdateRequest {
    const changes: UserUpdateRequest = {};
    if (m.nombre.trim() !== current.nombre) changes.nombre = m.nombre.trim();
    if (m.email.trim().toLowerCase() !== current.email.toLowerCase()) changes.email = m.email.trim();
    if (m.rol !== current.rol) changes.rol = m.rol;
    if (m.activo !== current.activo) changes.activo = m.activo;
    if (m.password) changes.password = m.password;
    return changes;
  }
}
