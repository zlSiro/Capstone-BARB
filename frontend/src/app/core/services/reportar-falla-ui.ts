import { Service, signal } from '@angular/core';

import { Aviso } from '../models';

/**
 * Acceso global a «Reportar falla»: el botón fijo de la navegación (en cualquier pantalla) y el de la bandeja abren
 * el mismo diálogo, que vive en el layout. Cuando se envía un aviso, la bandeja se entera por `creado`.
 */
@Service()
export class ReportarFallaUi {
  readonly abierto = signal(false);
  /** Último aviso enviado desde el diálogo (la bandeja lo agrega a su lista sin volver a pedirla). */
  readonly creado = signal<Aviso | null>(null);

  abrir(): void {
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  notificarCreado(aviso: Aviso): void {
    this.creado.set(aviso);
  }
}
