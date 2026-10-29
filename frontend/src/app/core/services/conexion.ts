import { DestroyRef, Service, inject, signal } from '@angular/core';

/** ¿Hay conexión? En faena la señal es irregular: la interfaz avisa en vez de fallar en silencio. */
@Service()
export class Conexion {
  readonly enLinea = signal(typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  constructor() {
    if (typeof window === 'undefined') return;
    const alVolver = () => this.enLinea.set(true);
    const alPerder = () => this.enLinea.set(false);
    window.addEventListener('online', alVolver);
    window.addEventListener('offline', alPerder);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', alVolver);
      window.removeEventListener('offline', alPerder);
    });
  }
}
