import { Injectable, computed, signal } from '@angular/core';

/**
 * Unidad en la que se muestra el MTBF (CGBIDA-435).
 *
 * El backend entrega **horas** y no se toca: la conversión es de presentación. El estado
 * es compartido a propósito, porque el mismo MTBF aparece en dos lugares —la tarjeta de
 * KPI y el desglose del semáforo— y verlo en unidades distintas en la misma pantalla se
 * lee como un error.
 */
export type UnidadMtbf = 'horas' | 'dias' | 'meses';

const CLAVE = 'barb.mtbfUnit';

/** Horas que tiene un mes operativo, por convención del equipo. */
export const HORAS_POR_MES = 730;

export const HORAS_POR_DIA = 24;

/**
 * Servicio de unidad del MTBF.
 *
 * Persiste la elección en `localStorage` para que sobreviva a la navegación, igual que
 * la moneda y el tema.
 */
@Injectable({ providedIn: 'root' })
export class MtbfUnitService {
  private readonly _unidad = signal<UnidadMtbf>(leerUnidad());

  readonly unidad = this._unidad.asReadonly();

  /** Divisor que corresponde a la unidad activa. */
  readonly divisor = computed(() => {
    switch (this._unidad()) {
      case 'dias':
        return HORAS_POR_DIA;
      case 'meses':
        return HORAS_POR_MES;
      default:
        return 1;
    }
  });

  setUnidad(unidad: UnidadMtbf): void {
    if (unidad === this._unidad()) return;
    this._unidad.set(unidad);
    window.localStorage.setItem(CLAVE, unidad);
  }

  /**
   * Convierte horas del backend a la unidad activa.
   *
   * Sin MTBF (null) devuelve null: el componente decide si muestra el aviso o un guion.
   */
  convertir(horas: number | null): number | null {
    if (horas === null || horas === undefined) return null;
    return horas / this.divisor();
  }

  /**
   * Formatea el MTBF para mostrarlo.
   *
   * El sufijo lo pasa quien llama, porque vive en i18n: el servicio no debe saber de
   * idiomas. Un decimal basta en las tres unidades.
   */
  formatear(horas: number | null, sufijo: string): string {
    const valor = this.convertir(horas);
    if (valor === null) return '—';
    return `${valor.toFixed(1)} ${sufijo}`;
  }
}

function leerUnidad(): UnidadMtbf {
  const guardada = window.localStorage.getItem(CLAVE);
  if (guardada === 'horas' || guardada === 'meses') return guardada;
  // Por defecto días: es la unidad que se aprobó en la Sub C (CGBIDA-434).
  return 'dias';
}
