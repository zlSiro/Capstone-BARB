import { Component, inject } from '@angular/core';

import { Toast, ToastService } from '../../../../core/services/toast.service';
import { Icon, IconName } from '../icon/icon';

/** Avisos breves. Llevan ícono y borde de color (no solo color) y, en móvil, quedan sobre la navegación inferior. */
@Component({
  selector: 'app-toast',
  imports: [Icon],
  template: `
    <div
      class="pointer-events-none fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:max-w-sm"
      role="status"
      aria-live="polite">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex animate-[hoja-sube_200ms_ease-out] items-start gap-3 rounded-control border border-borde border-l-4 bg-superficie px-4 py-3 text-base text-tinta shadow-lg md:text-sm"
          [class]="borde(toast.type)">
          <span [class]="colorIcono(toast.type)"><app-icon [name]="icono(toast.type)" [size]="22" /></span>
          <span class="flex-1">{{ toast.message }}</span>
          <button
            type="button"
            (click)="toastService.dismiss(toast.id)"
            class="-m-2 inline-flex size-11 items-center justify-center rounded-control text-tinta-suave hover:bg-superficie-2 hover:text-tinta"
            aria-label="Cerrar aviso">
            <app-icon name="x" [size]="18" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  toastService = inject(ToastService);

  borde(type: Toast['type']): string {
    switch (type) {
      case 'success':
        return 'border-l-ok';
      case 'error':
        return 'border-l-peligro';
      case 'warning':
        return 'border-l-media';
      default:
        return 'border-l-accion';
    }
  }

  colorIcono(type: Toast['type']): string {
    switch (type) {
      case 'success':
        return 'text-ok';
      case 'error':
        return 'text-peligro';
      case 'warning':
        return 'text-media';
      default:
        return 'text-accion';
    }
  }

  icono(type: Toast['type']): IconName {
    switch (type) {
      case 'success':
        return 'check-circulo';
      case 'error':
        return 'alerta';
      case 'warning':
        return 'alerta';
      default:
        return 'info';
    }
  }
}
