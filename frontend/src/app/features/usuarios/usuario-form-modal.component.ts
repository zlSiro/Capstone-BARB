import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, email, form, required, validate } from '@angular/forms/signals';

import { Empresa, Role, UserCreateRequest, UserUpdateRequest, UsuarioCreado, UsuarioPerfil } from '../../core/models';
import { ToastService } from '../../core/services/toast.service';
import { UsersAdminService } from '../../core/services/users-admin.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { BienvenidaUsuario, UsuarioBienvenidaModalComponent } from './usuario-bienvenida-modal.component';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { textoActual } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
// Con `get`: el nombre del rol se calcula al leerlo, así sigue el idioma elegido.
export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'admin', get label() { return textoActual('usuarios.administrador_de_empresa'); } },
  { value: 'gerente', get label() { return textoActual('usuarios.gerente'); } },
  { value: 'supervisor', get label() { return textoActual('usuarios.supervisor'); } },
  { value: 'engineer', get label() { return textoActual('usuarios.ingeniero'); } },
  { value: 'tecnico', get label() { return textoActual('usuarios.tecnico'); } },
  { value: 'operador', get label() { return textoActual('usuarios.operador'); } },
  { value: 'visitante', get label() { return textoActual('usuarios.visitante_solo_lectura'); } },
  { value: 'super_usuario', get label() { return textoActual('usuarios.super_usuario_plataforma_barb'); } },
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
  imports: [FormField, ModalComponent, UsuarioBienvenidaModalComponent, TranslatePipe],
  template: `
    @if (bienvenida(); as b) {
      <app-usuario-bienvenida-modal [datos]="b" (closed)="finalizar()" />
    } @else {
    <app-modal
      [title]="(isEdit() ? 'usuarios.editar_usuario' : 'usuarios.nuevo_usuario_2') | translate"
      [subtitle]="(isEdit() ? 'usuarios.modifica_el_perfil_el' : isSuper() ? 'usuarios.crea_el_usuario_gerente' : 'usuarios.crea_el_perfil_de') | translate"
      (closed)="closed.emit()">
      <form class="grid gap-4" (submit)="$event.preventDefault(); submit()" novalidate>
        @if (isSuper() && !isEdit()) {
          <div>
            <label for="usr-empresa" class="fld-label">{{ 'usuarios.empresa_2' | translate }}</label>
            <select id="usr-empresa" class="fld-input" [formField]="f.empresa_id">
              <option value="">{{ 'usuarios.selecciona_una_empresa' | translate }}</option>
              @for (e of empresas(); track e.empresa_id) {
                <option [value]="e.empresa_id">{{ e.nombre }}</option>
              }
            </select>
            @if (f.empresa_id().touched() && f.empresa_id().invalid()) {
              <p role="alert" class="fld-error">{{ f.empresa_id().errors()[0]?.message | translate }}</p>
            }
          </div>
        }

        <div>
          <label for="usr-nombre" class="fld-label">{{ 'usuarios.nombre' | translate }}</label>
          <input id="usr-nombre" type="text" class="fld-input" [formField]="f.nombre" />
          @if (f.nombre().touched() && f.nombre().invalid()) {
            <p role="alert" class="fld-error">{{ f.nombre().errors()[0]?.message | translate }}</p>
          }
        </div>

        <div>
          <label for="usr-email" class="fld-label">{{ 'usuarios.email' | translate }}</label>
          <input id="usr-email" type="email" autocomplete="off" class="fld-input" [formField]="f.email" />
          @if (f.email().touched() && f.email().invalid()) {
            <p role="alert" class="fld-error">{{ f.email().errors()[0]?.message | translate }}</p>
          }
        </div>

        <div>
          <label for="usr-pass" class="fld-label">
            {{ 'usuarios.contrasena' | translate: { v0: (isEdit() ? 'usuarios.vacio_no_cambiar' : 'usuarios.min_6_caracteres') | translate } }}
          </label>
          <input id="usr-pass" type="password" autocomplete="new-password" class="fld-input" [formField]="f.password" />
          @if (f.password().touched() && f.password().invalid()) {
            <p role="alert" class="fld-error">{{ f.password().errors()[0]?.message | translate }}</p>
          }
        </div>

        <div>
          <label for="usr-rol" class="fld-label">{{ 'usuarios.rol_2' | translate }}</label>
          <select id="usr-rol" class="fld-input" [formField]="f.rol">
            @for (r of roles(); track r.value) {
              <option [value]="r.value">{{ r.label }}</option>
            }
          </select>
        </div>

        <label class="flex items-center gap-2 text-sm text-tinta">
          <input type="checkbox" class="h-4 w-4" [formField]="f.activo" />
          {{ 'usuarios.usuario_activo_puede_iniciar' | translate }}
        </label>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" (click)="closed.emit()"
                  class="rounded-control border border-borde px-4 py-2 text-sm text-tinta hover:bg-superficie focus:outline-none focus:ring-2 focus:ring-accion">
            {{ 'usuarios.cancelar' | translate }}
          </button>
          <button type="submit" class="btn-primary" [disabled]="submitting()">
            {{ (submitting() ? 'usuarios.guardando' : isEdit() ? 'usuarios.guardar_cambios' : 'usuarios.crear_usuario') | translate }}
          </button>
        </div>
      </form>
    </app-modal>
    }
  `,
})
export class UsuarioFormModalComponent {
  private readonly i18n = inject(I18nService);
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
    required(p.nombre, { message: 'usuarios.ingresa_el_nombre' });
    validate(p.nombre, ({ value }) =>
      value().trim().length >= 2 ? undefined : { kind: 'minlength', message: 'usuarios.el_nombre_debe_tener' });
    required(p.email, { message: 'usuarios.ingresa_el_email' });
    email(p.email, { message: 'usuarios.email_invalido' });
    validate(p.password, ({ value }) => {
      const pass = value();
      if (!this.isEdit() && !pass) return { kind: 'required', message: 'usuarios.ingresa_una_contrasena' };
      return pass && pass.length < 6 ? { kind: 'minlength', message: 'usuarios.minimo_6_caracteres' } : undefined;
    });
    validate(p.empresa_id, ({ value }) =>
      this.isSuper() && !this.isEdit() && !value()
        ? { kind: 'required', message: 'usuarios.selecciona_una_empresa_2' }
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
          this.toast.success(this.i18n.tr('usuarios.usuario_actualizado'));
          this.saved.emit(saved);
        },
        error: (err) => this.onError(err),
      });
      return;
    }

    this.users.create(this.buildCreate(m)).subscribe({
      next: (creado: UsuarioCreado) => {
        this.toast.success(this.i18n.tr('usuarios.usuario_creado_2'));
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
    this.toast.error(apiErrorMessage(err, this.i18n.tr('usuarios.no_se_pudo_guardar')));
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
