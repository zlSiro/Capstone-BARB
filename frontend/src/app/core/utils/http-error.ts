import { HttpErrorResponse } from '@angular/common/http';

/**
 * Extrae el mensaje legible de un error del backend (`{ "detail": "..." }`).
 * FastAPI devuelve una lista en `detail` cuando falla la validación (422).
 */
export function apiErrorMessage(err: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (err instanceof HttpErrorResponse) {
    const detail = err.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail.map((d: { msg?: string }) => d.msg ?? '').filter(Boolean).join('. ') || fallback;
    }
    if (err.status === 0) return 'No hay conexión con el servidor.';
  }
  return fallback;
}
