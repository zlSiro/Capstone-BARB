import { Service, effect, inject, linkedSignal, untracked } from '@angular/core';

import { AuthService } from '../../core/services/auth.service';
import { ReportarFallaUi } from '../../core/services/reportar-falla-ui';

const PREFIJO = 'barb.ayuda.progreso.';

/**
 * Avance de los primeros pasos de «Aprende BARB». Guarda los recorridos terminados en el navegador, con una clave por
 * usuario (`barb.ayuda.progreso.<id>`): no hay backend, así que si el usuario cambia de equipo empieza de nuevo.
 *
 * Toda lectura y escritura de `localStorage` va protegida: si no está disponible, viene vacío o corrupto, el avance parte
 * de cero y la ayuda sigue funcionando (nunca se rompe la vista).
 */
@Service()
export class AyudaProgresoService {
  private readonly auth = inject(AuthService);
  private readonly reportarUi = inject(ReportarFallaUi);

  /** Ids de los recorridos que el usuario ya terminó. Se recarga al cambiar de usuario (login / logout). */
  readonly hechos = linkedSignal<string[]>(() => this.leer(this.auth.user()?.id));

  constructor() {
    // Si la app ya avisa que ocurrió la acción (un aviso creado desde «Reportar falla»), se marca sin pedir más.
    effect(() => {
      if (this.reportarUi.creado()) untracked(() => this.marcar('reportar_falla'));
    });
  }

  esHecho(recorridoId: string): boolean {
    return this.hechos().includes(recorridoId);
  }

  /** Marca un recorrido como terminado (idempotente). */
  marcar(recorridoId: string): void {
    if (this.hechos().includes(recorridoId)) return;
    const siguiente = [...this.hechos(), recorridoId];
    this.hechos.set(siguiente);
    this.guardar(this.auth.user()?.id, siguiente);
  }

  private clave(usuarioId: string | number | undefined): string | null {
    return usuarioId === undefined || usuarioId === null ? null : `${PREFIJO}${usuarioId}`;
  }

  private leer(usuarioId: string | number | undefined): string[] {
    const clave = this.clave(usuarioId);
    if (!clave) return [];
    try {
      const crudo = localStorage.getItem(clave);
      if (!crudo) return [];
      const dato: unknown = JSON.parse(crudo);
      return Array.isArray(dato) ? dato.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private guardar(usuarioId: string | number | undefined, hechos: string[]): void {
    const clave = this.clave(usuarioId);
    if (!clave) return;
    try {
      localStorage.setItem(clave, JSON.stringify(hechos));
    } catch {
      // Sin almacenamiento (modo privado, cuota llena): el avance vale solo en esta sesión.
    }
  }
}
