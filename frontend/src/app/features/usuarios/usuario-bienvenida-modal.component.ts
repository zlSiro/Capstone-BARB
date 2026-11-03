import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { ToastService } from '../../core/services/toast.service';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
/** Datos necesarios para redactar el aviso de bienvenida de un usuario recién creado. */
export interface BienvenidaUsuario {
  nombre: string;
  /** Etiqueta legible del rol (p. ej. "Gerente"). */
  rol: string;
  /** ISO 8601 de creación del usuario. */
  fecha: string | null;
  password: string;
  creadorNombre: string;
  creadorEmail: string;
}

/**
 * Se muestra tras crear cualquier usuario: el texto está listo para copiarlo y
 * enviarlo por correo al nuevo usuario (la contraseña solo se conoce en este momento).
 */
@Component({
  selector: 'app-usuario-bienvenida-modal',
  imports: [ModalComponent, TranslatePipe],
  providers: [DatePipe],
  template: `
    <app-modal
      [title]="'usuarios.usuario_creado' | translate"
      [subtitle]="'usuarios.copia_este_mensaje_y' | translate"
      (closed)="closed.emit()">
      <label for="bienvenida-texto" class="fld-label">{{ 'usuarios.mensaje_para_el_nuevo' | translate }}</label>
      <textarea
        id="bienvenida-texto"
        data-testid="bienvenida-texto"
        readonly
        rows="9"
        class="fld-input w-full codigo text-sm"
        [value]="mensaje()"></textarea>
      <p class="mt-2 text-sm text-tinta-suave">
        {{ 'usuarios.la_contrasena_no_se' | translate }}
      </p>
      <div class="flex justify-end gap-2 pt-4">
        <button type="button" data-testid="bienvenida-copiar" class="btn-secondary" (click)="copiar()">
          {{ (copiado() ? 'usuarios.copiado' : 'usuarios.copiar_mensaje') | translate }}
        </button>
        <button type="button" data-testid="bienvenida-cerrar" class="btn-primary" (click)="closed.emit()">{{ 'usuarios.cerrar' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class UsuarioBienvenidaModalComponent {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly datePipe = inject(DatePipe);

  readonly datos = input.required<BienvenidaUsuario>();
  readonly closed = output<void>();

  protected readonly copiado = signal(false);

  /** Formato acordado del aviso; no modificar el texto sin acordarlo con negocio. */
  readonly mensaje = computed(() => {
    const d = this.datos();
    // `created_at` llega en UTC desde la API; se muestra en hora local del navegador.
    const fecha = (d.fecha && this.datePipe.transform(d.fecha, 'dd-MM-yyyy HH:mm')) || '';
    return [
      `Estimado(a) ${d.nombre}`,
      `Informamos que con fecha ${fecha}, hemos habilitado su usuario para poder operar en BARB con rol ${d.rol}.`,
      `Su contraseña es ${d.password}.`,
      '',
      `Cualquier duda, favor comunicarse con ${d.creadorNombre} al correo ${d.creadorEmail}`,
    ].join('\n');
  });

  protected async copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.mensaje());
      this.copiado.set(true);
    } catch {
      this.toast.error(this.i18n.tr('usuarios.no_se_pudo_copiar'));
    }
  }
}
