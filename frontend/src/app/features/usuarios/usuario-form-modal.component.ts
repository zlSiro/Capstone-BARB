import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, email, form, required, validate } from '@angular/forms/signals';

import { Empresa, Role, UserCreateRequest, UserUpdateRequest, UsuarioCreado, UsuarioPerfil } from '../../core/models';
import { ToastService } from '../../core/services/toast.service';
import { UsersAdminService } from '../../core/services/users-admin.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { BienvenidaUsuario, UsuarioBienvenidaModalComponent } from './usuario-bienvenida-modal.component';

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

/** El super_usuario (contraparte comercial de BARB) solo crea usuarios con perfil gerente. */
const SUPER_ROLE_OPTIONS = ROLE_OPTIONS.filter(r => r.value === 'gerente');

/**
 * El administrador gobierna el sistema pero no se otorga ni otorga privilegios de decisión: solo gestiona
 * usuarios operativos. Gerentes y administradores los gestiona el gerente (el backend también lo exige).
 */
const ADMIN_ROLE_OPTIONS = ROLE_OPTIONS.filter(r => ['operador', 'tecnico', 'supervisor', 'engineer', 'visitante'].includes(r.value));

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
  imports: [FormField, ModalComponent, UsuarioBienvenidaModalComponent],
  template: `
    @if (bienvenida(); as b) {
      <app-usuario-bienvenida-modal [datos]="b" (closed)="finalizar()" />
    } @else {
    <app-modal
      [title]="isEdit() ? 'Editar usuario' : 'Nuevo usuario'"
      [subtitle]="isEdit() ? 'Modifica el perfil, el rol o la contraseña.' : isSuper() ? 'Crea el usuario gerente de la empresa.' : 'Crea el perfil de un miembro de la empresa.'"
      (closed)="closed.emit()">
      <form class="grid gap-4" (submit)="$event.preventDefault(); submit()" novalidate>
        @if (isSuper() && !isEdit()) {
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

        <label class="flex items-center gap-2 text-sm text-tinta">
          <input type="checkbox" class="h-4 w-4" [formField]="f.activo" />
          Usuario activo (puede iniciar sesión)
        </label>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" (click)="closed.emit()"
                  class="rounded-control border border-borde px-4 py-2 text-sm text-tinta hover:bg-superficie focus:outline-none focus:ring-2 focus:ring-accion">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" [disabled]="submitting()">
            {{ submitting() ? 'Guardando…' : isEdit() ? 'Guardar cambios' : 'Crear usuario' }}
          </button>
        </div>
      </form>
    </app-modal>
    }
  `,
})
export class UsuarioFormModalComponent {
  private readonly users = inject(UsersAdminService);
  private readonly toast = inject(ToastService);

  /** Usuario a editar; null = alta. */
  readonly usuario = input<UsuarioPerfil | null>(null);
  readonly isSuper = input(false);
  /** El usuario que gestiona es un administrador de empresa: solo puede asignar roles operativos. */
  readonly soloOperativos = input(false);
  /** Empresas disponibles para el selector (solo super_usuario). */
  readonly empresas = input<Empresa[]>([]);
  /** Empresa preseleccionada (la que el super_usuario tiene activa en la cabecera). */
  readonly defaultEmpresaId = input<number | null>(null);

  readonly closed = output<void>();
  readonly saved = output<UsuarioPerfil>();

  protected readonly submitting = signal(false);
  /** Aviso de bienvenida (con la contraseña) que se muestra tras crear un usuario. */
  protected readonly bienvenida = signal<BienvenidaUsuario | null>(null);
  private creado: UsuarioPerfil | null = null;
  protected readonly isEdit = computed(() => this.usuario() !== null);
  // El super_usuario solo asigna gerente; el resto de la empresa nunca puede asignar super_usuario
  // (el backend también lo rechaza).
  protected readonly roles = computed(() => {
    if (this.isSuper()) return SUPER_ROLE_OPTIONS;
    if (this.soloOperativos()) return ADMIN_ROLE_OPTIONS;
    return ROLE_OPTIONS.filter(r => r.value !== 'super_usuario');
  });

  protected readonly model = linkedSignal<UsuarioFormModel>(() => {
    const u = this.usuario();
    return {
      nombre: u?.nombre ?? '',
      email: u?.email ?? '',
      password: '',
      rol: u?.rol ?? (this.isSuper() ? 'gerente' : 'tecnico'),
      activo: u?.activo ?? true,
      empresa_id: this.defaultEmpresaId() ? String(this.defaultEmpresaId()) : '',
    };
  });

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
    validate(p.empresa_id, ({ value }) =>
      this.isSuper() && !this.isEdit() && !value()
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

    if (current) {
      this.users.update(current.usuario_id, this.buildUpdate(m, current)).subscribe({
        next: (saved) => {
          this.toast.success('Usuario actualizado.');
          this.saved.emit(saved);
        },
        error: (err) => this.onError(err),
      });
      return;
    }

    this.users.create(this.buildCreate(m)).subscribe({
      next: (creado: UsuarioCreado) => {
        this.toast.success('Usuario creado.');
        this.creado = creado;
        this.bienvenida.set({
          nombre: creado.nombre,
          rol: ROLE_OPTIONS.find(r => r.value === creado.rol)?.label ?? creado.rol,
          fecha: creado.created_at,
          password: m.password,
          creadorNombre: creado.creado_por.nombre,
          creadorEmail: creado.creado_por.email,
        });
      },
      error: (err) => this.onError(err),
    });
  }

  /** Cierra el aviso de bienvenida y devuelve el control al listado. */
  protected finalizar(): void {
    if (this.creado) this.saved.emit(this.creado);
  }

  private onError(err: unknown): void {
    this.submitting.set(false);
    this.toast.error(apiErrorMessage(err, 'No se pudo guardar el usuario.'));
  }

  private buildCreate(m: UsuarioFormModel): UserCreateRequest {
    const payload: UserCreateRequest = {
      nombre: m.nombre.trim(),
      email: m.email.trim(),
      password: m.password,
      rol: m.rol,
      activo: m.activo,
    };
    // Solo el super_usuario elige empresa; para el resto el backend usa la suya.
    if (this.isSuper()) payload.empresa_id = Number(m.empresa_id);
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
