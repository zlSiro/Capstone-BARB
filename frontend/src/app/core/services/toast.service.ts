import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private counter = 0;

  show(message: string, type: ToastType = 'info', duration = 3500): void {
    const id = ++this.counter;
    const toast: Toast = { id, type, message, duration };

    this._toasts.update(prev => [...prev, toast]);

    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
  }

  success(message: string, duration = 3500) { this.show(message, 'success', duration); }
  error(message: string, duration = 4500)   { this.show(message, 'error', duration); }
  info(message: string, duration = 3000)    { this.show(message, 'info', duration); }
  warning(message: string, duration = 4000) { this.show(message, 'warning', duration); }

  dismiss(id: number): void {
    this._toasts.update(prev => prev.filter(t => t.id !== id));
  }

  clear(): void {
    this._toasts.set([]);
  }
}
