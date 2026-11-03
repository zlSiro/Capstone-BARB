import { HttpErrorResponse } from '@angular/common/http';
import { textoActual } from '../i18n/i18n.service';

/**
 * Extrae el mensaje legible de un error del backend (`{ "detail": "..." }`).
 * FastAPI devuelve una lista en `detail` cuando falla la validación (422).
 */
export function apiErrorMessage(err: unknown, fallback = textoActual('sistema.ocurrio_un_error_inesperado')): string {
  if (err instanceof HttpErrorResponse) {
    const detail = err.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail.map((d: { msg?: string }) => d.msg ?? '').filter(Boolean).join('. ') || fallback;
    }
    if (err.status === 0) return textoActual('sistema.no_hay_conexion_con');
  }
  return fallback;
}
