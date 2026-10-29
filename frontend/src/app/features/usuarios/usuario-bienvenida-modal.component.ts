import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { ToastService } from '../../core/services/toast.service';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';

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
  imports: [ModalComponent],
  providers: [DatePipe],
  template: `
    <app-modal
      title="Usuario creado"
      subtitle="Copia este mensaje y envíalo por correo al nuevo usuario."
      (closed)="closed.emit()">
      <label for="bienvenida-texto" class="fld-label">Mensaje para el nuevo usuario</label>
      <textarea
        id="bienvenida-texto"
        data-testid="bienvenida-texto"
        readonly
        rows="9"
        class="fld-input w-full codigo text-sm"
        [value]="mensaje()"></textarea>
      <p class="mt-2 text-sm text-tinta-suave">
        La contraseña no se vuelve a mostrar una vez que cierres esta ventana.
      </p>
      <div class="flex justify-end gap-2 pt-4">
        <button type="button" data-testid="bienvenida-copiar" class="btn-secondary" (click)="copiar()">
          {{ copiado() ? 'Copiado ✓' : 'Copiar mensaje' }}
        </button>
        <button type="button" data-testid="bienvenida-cerrar" class="btn-primary" (click)="closed.emit()">Cerrar</button>
      </div>
    </app-modal>
  `,
})
export class UsuarioBienvenidaModalComponent {
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
      this.toast.error('No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.');
    }
  }
}
