import { Component, inject } from '@angular/core';
import { ToastService, Toast } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="flex items-start gap-3 px-4 py-3 rounded shadow-lg text-sm text-white animate-slide-in"
          [class]="bgClass(toast.type)">

          <span class="text-lg leading-none">{{ icon(toast.type) }}</span>

          <span class="flex-1">{{ toast.message }}</span>

          <button
            (click)="toastService.dismiss(toast.id)"
            class="text-white/70 hover:text-white text-lg leading-none">
            ✕
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes slideIn {
      from { opacity: 0; transform: translateX(20px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .animate-slide-in {
      animation: slideIn 0.25s ease-out;
    }
  `]
})
export class ToastComponent {
  toastService = inject(ToastService);

  bgClass(type: Toast['type']): string {
    switch (type) {
      case 'success': return 'bg-green-600';
      case 'error':   return 'bg-red-600';
      case 'warning': return 'bg-amber-600';
      default:        return 'bg-gray-800';
    }
  }

  icon(type: Toast['type']): string {
    switch (type) {
      case 'success': return '✓';
      case 'error':   return '✕';
      case 'warning': return '⚠';
      default:        return 'ℹ';
    }
  }
}
