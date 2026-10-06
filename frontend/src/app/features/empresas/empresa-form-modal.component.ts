import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, email, form, min, required, validate } from '@angular/forms/signals';

import { Empresa, EmpresaPayload, EstadoEmpresa, PlanEmpresa } from '../../core/models';
import { EmpresasService } from '../../core/services/empresas.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';

interface EmpresaFormModel {
  nombre: string;
  rut: string;
  pais: string;
  industria: string;
  contacto_nombre: string;
  contacto_email: string;
  contacto_telefono: string;
  plan: PlanEmpresa;
  estado: EstadoEmpresa;
  max_usuarios: number;
  max_plantas: number;
  licencia_inicio: string;
  licencia_fin: string;
  notas: string;
  // Solo al crear: primer administrador de la empresa
  crearAdmin: boolean;
  adminNombre: string;
  adminEmail: string;
  adminPassword: string;
}

const PLANES: { value: PlanEmpresa; label: string }[] = [
  { value: 'trial', label: 'Trial' },
  { value: 'starter', label: 'Starter' },
  { value: 'professional', label: 'Professional' },
  { value: 'enterprise', label: 'Enterprise' },
];

const ESTADOS: { value: EstadoEmpresa; label: string }[] = [
  { value: 'active', label: 'Activa' },
  { value: 'demo', label: 'Demo' },
  { value: 'suspended', label: 'Suspendida' },
  { value: 'cancelled', label: 'Cancelada' },
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
    plan: e?.plan ?? 'trial',
    estado: e?.estado ?? 'active',
    max_usuarios: e?.max_usuarios ?? 10,
    max_plantas: e?.max_plantas ?? 1,
    licencia_inicio: e?.licencia_inicio ?? '',
    licencia_fin: e?.licencia_fin ?? '',
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
  imports: [FormField, ModalComponent],
  template: `
    <app-modal
      [title]="isEdit() ? 'Editar empresa' : 'Nueva empresa'"
      [subtitle]="isEdit() ? 'Actualiza los datos y la licencia de la empresa.' : 'Registra una empresa cliente en la solución.'"
      size="lg"
      (closed)="closed.emit()">
      <form class="grid gap-4 md:grid-cols-2" (submit)="$event.preventDefault(); submit()" novalidate>
        <div class="md:col-span-2">
          <label for="emp-nombre" class="fld-label">Nombre *</label>
          <input id="emp-nombre" type="text" class="fld-input" [formField]="f.nombre"
                 [attr.aria-invalid]="f.nombre().touched() && f.nombre().invalid()"
                 [attr.aria-describedby]="f.nombre().touched() && f.nombre().invalid() ? 'emp-nombre-err' : null" />
          @if (f.nombre().touched() && f.nombre().invalid()) {
            <p id="emp-nombre-err" role="alert" class="fld-error">{{ f.nombre().errors()[0]?.message }}</p>
          }
        </div>

        <div>
          <label for="emp-rut" class="fld-label">RUT / ID fiscal</label>
          <input id="emp-rut" type="text" class="fld-input" [formField]="f.rut" placeholder="76.000.000-0" />
        </div>
        <div>
          <label for="emp-pais" class="fld-label">País</label>
          <input id="emp-pais" type="text" class="fld-input" [formField]="f.pais" />
        </div>
        <div>
          <label for="emp-industria" class="fld-label">Industria</label>
          <input id="emp-industria" type="text" class="fld-input" [formField]="f.industria" placeholder="Minería, Manufactura…" />
        </div>
        <div>
          <label for="emp-plan" class="fld-label">Plan</label>
          <select id="emp-plan" class="fld-input" [formField]="f.plan">
            @for (p of planes; track p.value) {
              <option [value]="p.value">{{ p.label }}</option>
            }
          </select>
        </div>

        <div>
          <label for="emp-cnombre" class="fld-label">Contacto</label>
          <input id="emp-cnombre" type="text" class="fld-input" [formField]="f.contacto_nombre" />
        </div>
        <div>
          <label for="emp-cemail" class="fld-label">Email de contacto</label>
          <input id="emp-cemail" type="email" class="fld-input" [formField]="f.contacto_email"
                 [attr.aria-invalid]="f.contacto_email().touched() && f.contacto_email().invalid()"
                 [attr.aria-describedby]="f.contacto_email().touched() && f.contacto_email().invalid() ? 'emp-cemail-err' : null" />
          @if (f.contacto_email().touched() && f.contacto_email().invalid()) {
            <p id="emp-cemail-err" role="alert" class="fld-error">{{ f.contacto_email().errors()[0]?.message }}</p>
          }
        </div>

        <div>
          <label for="emp-maxu" class="fld-label">Máx. usuarios (licencia)</label>
          <input id="emp-maxu" type="number" class="fld-input" [formField]="f.max_usuarios" />
          @if (f.max_usuarios().touched() && f.max_usuarios().invalid()) {
            <p role="alert" class="fld-error">{{ f.max_usuarios().errors()[0]?.message }}</p>
          }
        </div>
        <div>
          <label for="emp-maxp" class="fld-label">Máx. plantas</label>
          <input id="emp-maxp" type="number" class="fld-input" [formField]="f.max_plantas" />
          @if (f.max_plantas().touched() && f.max_plantas().invalid()) {
            <p role="alert" class="fld-error">{{ f.max_plantas().errors()[0]?.message }}</p>
          }
        </div>

        <div>
          <label for="emp-lini" class="fld-label">Licencia desde</label>
          <input id="emp-lini" type="date" class="fld-input" [formField]="f.licencia_inicio" />
        </div>
        <div>
          <label for="emp-lfin" class="fld-label">Licencia hasta</label>
          <input id="emp-lfin" type="date" class="fld-input" [formField]="f.licencia_fin" />
          @if (f.licencia_fin().touched() && f.licencia_fin().invalid()) {
            <p role="alert" class="fld-error">{{ f.licencia_fin().errors()[0]?.message }}</p>
          }
        </div>

        @if (isEdit()) {
          <div class="md:col-span-2">
            <label for="emp-estado" class="fld-label">Estado</label>
            <select id="emp-estado" class="fld-input" [formField]="f.estado">
              @for (s of estados; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
            <p class="mt-1 text-xs text-slate-400">
              Una empresa suspendida o cancelada pierde el acceso a la solución (sus sesiones se cierran).
            </p>
          </div>
        }

        <div class="md:col-span-2">
          <label for="emp-notas" class="fld-label">Notas internas</label>
          <textarea id="emp-notas" rows="2" class="fld-input" [formField]="f.notas"></textarea>
        </div>

        @if (!isEdit()) {
          <fieldset class="md:col-span-2 rounded-lg border border-slate-700 p-4">
            <legend class="px-2 text-xs font-semibold uppercase tracking-wide text-slate-300">Administrador inicial</legend>
            <label class="mb-3 flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" [formField]="f.crearAdmin" class="h-4 w-4" />
              Crear un administrador para la empresa
            </label>
            @if (model().crearAdmin) {
              <div class="grid gap-3 md:grid-cols-2">
                <div>
                  <label for="adm-nombre" class="fld-label">Nombre *</label>
                  <input id="adm-nombre" type="text" class="fld-input" [formField]="f.adminNombre" />
                  @if (f.adminNombre().touched() && f.adminNombre().invalid()) {
                    <p role="alert" class="fld-error">{{ f.adminNombre().errors()[0]?.message }}</p>
                  }
                </div>
                <div>
                  <label for="adm-email" class="fld-label">Email *</label>
                  <input id="adm-email" type="email" class="fld-input" [formField]="f.adminEmail" />
                  @if (f.adminEmail().touched() && f.adminEmail().invalid()) {
                    <p role="alert" class="fld-error">{{ f.adminEmail().errors()[0]?.message }}</p>
                  }
                </div>
                <div class="md:col-span-2">
                  <label for="adm-pass" class="fld-label">Contraseña inicial * (mín. 6 caracteres)</label>
                  <input id="adm-pass" type="password" autocomplete="new-password" class="fld-input" [formField]="f.adminPassword" />
                  @if (f.adminPassword().touched() && f.adminPassword().invalid()) {
                    <p role="alert" class="fld-error">{{ f.adminPassword().errors()[0]?.message }}</p>
                  }
                </div>
              </div>
            }
          </fieldset>
        }

        <div class="md:col-span-2 flex justify-end gap-2 pt-2">
          <button type="button" (click)="closed.emit()"
                  class="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" [disabled]="submitting()">
            {{ submitting() ? 'Guardando…' : isEdit() ? 'Guardar cambios' : 'Crear empresa' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class EmpresaFormModalComponent {
  private readonly empresas = inject(EmpresasService);
  private readonly toast = inject(ToastService);

  /** Empresa a editar; null = alta. */
  readonly empresa = input<Empresa | null>(null);
  readonly closed = output<void>();
  readonly saved = output<Empresa>();

  protected readonly planes = PLANES;
  protected readonly estados = ESTADOS;
  protected readonly submitting = signal(false);
  protected readonly isEdit = () => this.empresa() !== null;

  protected readonly model = linkedSignal(() => toModel(this.empresa()));
  protected readonly f = form(this.model, (p) => {
    required(p.nombre, { message: 'Ingresa el nombre de la empresa.' });
    validate(p.nombre, ({ value }) =>
      value().trim() ? undefined : { kind: 'blank', message: 'Ingresa el nombre de la empresa.' });
    email(p.contacto_email, { message: 'Email de contacto inválido.' });
    min(p.max_usuarios, 1, { message: 'Debe ser al menos 1.' });
    min(p.max_plantas, 1, { message: 'Debe ser al menos 1.' });
    validate(p.licencia_fin, ({ value, valueOf }) => {
      const ini = valueOf(p.licencia_inicio);
      return ini && value() && value() < ini
        ? { kind: 'range', message: 'La licencia no puede terminar antes de empezar.' }
        : undefined;
    });
    // Admin inicial: solo se valida si se eligió crearlo
    required(p.adminNombre, { message: 'Ingresa el nombre del administrador.', when: ({ valueOf }) => valueOf(p.crearAdmin) });
    required(p.adminEmail, { message: 'Ingresa el email del administrador.', when: ({ valueOf }) => valueOf(p.crearAdmin) });
    email(p.adminEmail, { message: 'Email inválido.' });
    validate(p.adminPassword, ({ value, valueOf }) =>
      valueOf(p.crearAdmin) && value().length < 6
        ? { kind: 'minlength', message: 'La contraseña debe tener al menos 6 caracteres.' }
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
      plan: m.plan,
      estado: m.estado,
      max_usuarios: Number(m.max_usuarios),
      max_plantas: Number(m.max_plantas),
      licencia_inicio: m.licencia_inicio || null,
      licencia_fin: m.licencia_fin || null,
      notas: nullable(m.notas),
    };

    const current = this.empresa();
    const request$ = current
      ? this.empresas.update(current.empresa_id, payload)
      : this.empresas.create({
          ...payload,
          admin: m.crearAdmin
            ? { nombre: m.adminNombre.trim(), email: m.adminEmail.trim(), password: m.adminPassword }
            : null,
        });

    this.submitting.set(true);
    request$.subscribe({
      next: (saved) => {
        this.toast.success(current ? 'Empresa actualizada.' : 'Empresa creada.');
        this.saved.emit(saved);
      },
      error: (err) => {
        this.submitting.set(false);
        this.toast.error(apiErrorMessage(err, 'No se pudo guardar la empresa.'));
      },
    });
  }
}
