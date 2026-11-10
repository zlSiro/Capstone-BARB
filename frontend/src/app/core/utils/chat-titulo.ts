// frontend/src/app/core/utils/chat-titulo.ts
//
// Títulos cortos para el historial de conversaciones.
//
// El backend ya crea las sesiones nuevas con un título corto (primera frase,
// máx. 48 caracteres), pero las sesiones antiguas guardaron el prompt completo.
// Este helper acorta también esas filas al mostrarlas, sin tocar la base.

/** Primera frase del título, recortada a 48 caracteres. */
export function tituloCorto(titulo: string | null | undefined): string {
  const t = (titulo ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '—';

  const finFrase = t.search(/[.!?](\s|$)/);
  const frase = finFrase > 0 ? t.slice(0, finFrase).trim() : t;

  return frase.length > 48 ? `${frase.slice(0, 45).trimEnd()}…` : frase;
}
