import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, email, form, min, required, validate } from '@angular/forms/signals';

import { Empresa, EmpresaCreada, EmpresaPayload, EstadoEmpresa } from '../../core/models';
import { EmpresasService } from '../../core/services/empresas.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { BienvenidaUsuario, UsuarioBienvenidaModalComponent } from '../usuarios/usuario-bienvenida-modal.component';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { textoActual } from '../../core/i18n/i18n.service';
import { I18nService } from '../../core/i18n/i18n.service';
interface EmpresaFormModel {
  nombre: string;
  rut: string;
  pais: string;
  industria: string;
  contacto_nombre: string;
  contacto_email: string;
  contacto_telefono: string;
  estado: EstadoEmpresa;
  max_usuarios: number;
  notas: string;
  // Solo al crear: primer usuario (gerente) de la empresa
  crearAdmin: boolean;
  adminNombre: string;
  adminEmail: string;
  adminPassword: string;
}

const ESTADOS: { value: EstadoEmpresa; label: string }[] = [
  { value: 'active', get label() { return textoActual('empresas.activa'); } },
  { value: 'suspended', get label() { return textoActual('empresas.suspendida'); } },
  { value: 'cancelled', get label() { return textoActual('empresas.cancelada'); } },
];

function toModel(e: Empresa | null): EmpresaFormModel {
  return {
    nombre: e?.nombre ?? '',
    rut: e?.rut ?? '',
    pais: e?.pais ?? 'Chile',
    industria: e?.industria ?? '',
    contacto_nombre: e?.contacto_nombre ?? '',
    contacto_email: e?.contacto_email ?? '',
    contacto_telefono: e?.contacto_telefono ?? '',
    estado: e?.estado ?? 'active',
    max_usuarios: e?.max_usuarios ?? 10,
    notas: e?.notas ?? '',
    crearAdmin: !e,
    adminNombre: '',
    adminEmail: '',
    adminPassword: '',
  };
}

/** Alta y edición de una empresa (con administrador inicial opcional al crear). */
@Component({
  selector: 'app-empresa-form-modal',
  imports: [FormField, ModalComponent, UsuarioBienvenidaModalComponent, TranslatePipe],
  template: `
    @if (bienvenida(); as b) {
      <app-usuario-bienvenida-modal [datos]="b" (closed)="finalizar()" />
    } @else {
    <app-modal
      [title]="(isEdit() ? 'empresas.editar_empresa' : 'empresas.nueva_empresa_2') | translate"
      [subtitle]="(isEdit() ? 'empresas.actualiza_los_datos_y' : 'empresas.registra_una_empresa_cliente') | translate"
      size="lg"
      (closed)="closed.emit()">
      <form class="grid gap-4 md:grid-cols-2" (submit)="$event.preventDefault(); submit()" novalidate>
        <div class="md:col-span-2">
          <label for="emp-nombre" class="fld-label">{{ 'empresas.nombre' | translate }}</label>
          <input id="emp-nombre" type="text" class="fld-input" [formField]="f.nombre"
                 [attr.aria-invalid]="f.nombre().touched() && f.nombre().invalid()"
                 [attr.aria-describedby]="f.nombre().touched() && f.nombre().invalid() ? 'emp-nombre-err' : null" />
          @if (f.nombre().touched() && f.nombre().invalid()) {
            <p id="emp-nombre-err" role="alert" class="fld-error">{{ f.nombre().errors()[0]?.message | translate }}</p>
          }
        </div>

        <div>
          <label for="emp-rut" class="fld-label">{{ 'empresas.rut_id_fiscal' | translate }}</label>
          <input id="emp-rut" type="text" class="fld-input" [formField]="f.rut" placeholder="76.000.000-0" />
        </div>
        <div>
          <label for="emp-pais" class="fld-label">{{ 'empresas.pais' | translate }}</label>
          <input id="emp-pais" type="text" class="fld-input" [formField]="f.pais" />
        </div>
        <div>
          <label for="emp-industria" class="fld-label">{{ 'empresas.industria' | translate }}</label>
          <input id="emp-industria" type="text" class="fld-input" [formField]="f.industria" [attr.placeholder]="'empresas.mineria_manufactura' | translate" />
        </div>

        <div>
          <label for="emp-cnombre" class="fld-label">{{ 'empresas.contacto' | translate }}</label>
          <input id="emp-cnombre" type="text" class="fld-input" [formField]="f.contacto_nombre" />
        </div>
        <div>
          <label for="emp-cemail" class="fld-label">{{ 'empresas.email_de_contacto' | translate }}</label>
          <input id="emp-cemail" type="email" class="fld-input" [formField]="f.contacto_email"
                 [attr.aria-invalid]="f.contacto_email().touched() && f.contacto_email().invalid()"
                 [attr.aria-describedby]="f.contacto_email().touched() && f.contacto_email().invalid() ? 'emp-cemail-err' : null" />
          @if (f.contacto_email().touched() && f.contacto_email().invalid()) {
            <p id="emp-cemail-err" role="alert" class="fld-error">{{ f.contacto_email().errors()[0]?.message | translate }}</p>
          }
        </div>

        <div>
          <label for="emp-maxu" class="fld-label">{{ 'empresas.max_usuarios_licencia' | translate }}</label>
          <input id="emp-maxu" type="number" class="fld-input" [formField]="f.max_usuarios" />
          @if (f.max_usuarios().touched() && f.max_usuarios().invalid()) {
            <p role="alert" class="fld-error">{{ f.max_usuarios().errors()[0]?.message | translate }}</p>
          }
        </div>

        @if (isEdit()) {
          <div class="md:col-span-2">
            <label for="emp-estado" class="fld-label">{{ 'empresas.estado' | translate }}</label>
            <select id="emp-estado" class="fld-input" [formField]="f.estado">
              @for (s of estados; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
            <p class="mt-1 text-sm text-tinta-suave">
              {{ 'empresas.una_empresa_suspendida_o' | translate }}
            </p>
          </div>
        }

        <div class="md:col-span-2">
          <label for="emp-notas" class="fld-label">{{ 'empresas.notas_internas' | translate }}</label>
          <textarea id="emp-notas" rows="2" class="fld-input" [formField]="f.notas"></textarea>
        </div>

        @if (!isEdit()) {
          <fieldset class="md:col-span-2 rounded-control border border-borde p-4">
            <legend class="px-2 text-sm font-semibold text-tinta-suave">{{ 'empresas.gerente_de_la_empresa' | translate }}</legend>
            <label class="mb-3 flex items-center gap-2 text-sm text-tinta">
              <input type="checkbox" [formField]="f.crearAdmin" class="h-4 w-4" />
              {{ 'empresas.crear_el_usuario_gerente' | translate }}
            </label>
            @if (model().crearAdmin) {
              <div class="grid gap-3 md:grid-cols-2">
                <div>
                  <label for="adm-nombre" class="fld-label">{{ 'empresas.nombre' | translate }}</label>
                  <input id="adm-nombre" type="text" class="fld-input" [formField]="f.adminNombre" />
                  @if (f.adminNombre().touched() && f.adminNombre().invalid()) {
                    <p role="alert" class="fld-error">{{ f.adminNombre().errors()[0]?.message | translate }}</p>
                  }
                </div>
                <div>
                  <label for="adm-email" class="fld-label">{{ 'empresas.email' | translate }}</label>
                  <input id="adm-email" type="email" class="fld-input" [formField]="f.adminEmail" />
                  @if (f.adminEmail().touched() && f.adminEmail().invalid()) {
                    <p role="alert" class="fld-error">{{ f.adminEmail().errors()[0]?.message | translate }}</p>
                  }
                </div>
                <div class="md:col-span-2">
                  <label for="adm-pass" class="fld-label">{{ 'empresas.contrasena_inicial_min_6' | translate }}</label>
                  <input id="adm-pass" type="password" autocomplete="new-password" class="fld-input" [formField]="f.adminPassword" />
                  @if (f.adminPassword().touched() && f.adminPassword().invalid()) {
                    <p role="alert" class="fld-error">{{ f.adminPassword().errors()[0]?.message | translate }}</p>
                  }
                </div>
              </div>
            }
          </fieldset>
        }

        <div class="md:col-span-2 flex justify-end gap-2 pt-2">
          <button type="button" (click)="closed.emit()"
                  class="rounded-control border border-borde px-4 py-2 text-sm text-tinta hover:bg-superficie focus:outline-none focus:ring-2 focus:ring-accion">
            {{ 'empresas.cancelar' | translate }}
          </button>
          <button type="submit" class="btn-primary" [disabled]="submitting()">
            {{ (submitting() ? 'empresas.guardando' : isEdit() ? 'empresas.guardar_cambios' : 'empresas.crear_empresa') | translate }}
          </button>
        </div>
      </form>
    </app-modal>
    }
  `,
})
export class EmpresaFormModalComponent {
  private readonly i18n = inject(I18nService);
  private readonly empresas = inject(EmpresasService);
  private readonly toast = inject(ToastService);

  /** Empresa a editar; null = alta. */
  readonly empresa = input<Empresa | null>(null);
  readonly closed = output<void>();
  readonly saved = output<Empresa>();

  protected readonly estados = ESTADOS;
  protected readonly submitting = signal(false);
  /** Aviso de bienvenida del gerente creado junto con la empresa (incluye su contraseña). */
  protected readonly bienvenida = signal<BienvenidaUsuario | null>(null);
  private creada: Empresa | null = null;

  /** Cierra el aviso de bienvenida y devuelve el control al listado. */
  protected finalizar(): void {
    if (this.creada) this.saved.emit(this.creada);
  }
  protected readonly isEdit = () => this.empresa() !== null;

  protected readonly model = linkedSignal(() => toModel(this.empresa()));
  protected readonly f = form(this.model, (p) => {
    required(p.nombre, { message: 'empresas.ingresa_el_nombre_de' });
    validate(p.nombre, ({ value }) =>
      value().trim() ? undefined : { kind: 'blank', message: 'empresas.ingresa_el_nombre_de' });
    email(p.contacto_email, { message: 'empresas.email_de_contacto_invalido' });
    min(p.max_usuarios, 1, { message: 'empresas.debe_ser_al_menos' });
    // Gerente inicial: solo se valida si se eligió crearlo
    required(p.adminNombre, { message: 'empresas.ingresa_el_nombre_del', when: ({ valueOf }) => valueOf(p.crearAdmin) });
    required(p.adminEmail, { message: 'empresas.ingresa_el_email_del', when: ({ valueOf }) => valueOf(p.crearAdmin) });
    email(p.adminEmail, { message: 'empresas.email_invalido' });
    validate(p.adminPassword, ({ value, valueOf }) =>
      valueOf(p.crearAdmin) && value().length < 6
        ? { kind: 'minlength', message: 'empresas.la_contrasena_debe_tener' }
        : undefined);
  });

  protected submit(): void {
    if (this.submitting()) return;
    this.f().markAsTouched();
    if (!this.f().valid()) return;

    const m = this.model();
    const nullable = (v: string) => v.trim() || null;
    const payload: EmpresaPayload = {
      nombre: m.nombre.trim(),
      rut: nullable(m.rut),
      pais: m.pais.trim() || 'Chile',
      industria: nullable(m.industria),
      contacto_nombre: nullable(m.contacto_nombre),
      contacto_email: nullable(m.contacto_email),
      contacto_telefono: nullable(m.contacto_telefono),
      estado: m.estado,
      max_usuarios: Number(m.max_usuarios),
      notas: nullable(m.notas),
    };

    const current = this.empresa();
    const request$ = current
      ? this.empresas.update(current.empresa_id, payload)
      : this.empresas.create({
          ...payload,
          gerente: m.crearAdmin
            ? { nombre: m.adminNombre.trim(), email: m.adminEmail.trim(), password: m.adminPassword }
            : null,
        });

    this.submitting.set(true);
    request$.subscribe({
      next: (saved: EmpresaCreada) => {
        this.toast.success(this.i18n.tr(current ? 'empresas.empresa_actualizada' : 'empresas.empresa_creada'));
        // Si se creó un gerente junto con la empresa, se muestra su aviso de bienvenida antes de cerrar.
        if (!current && saved.gerente && saved.creado_por) {
          this.creada = saved;
          this.bienvenida.set({
            nombre: saved.gerente.nombre,
            rol: 'Gerente',
            fecha: saved.gerente.created_at,
            password: m.adminPassword,
            creadorNombre: saved.creado_por.nombre,
            creadorEmail: saved.creado_por.email,
          });
          return;
        }
        this.saved.emit(saved);
      },
      error: (err) => {
        this.submitting.set(false);
        this.toast.error(apiErrorMessage(err, this.i18n.tr('empresas.no_se_pudo_guardar')));
      },
    });
  }
}
