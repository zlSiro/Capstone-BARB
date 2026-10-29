/**
 * Ayudas para pruebas de tema. Desde HU-24 el modo claro/oscuro lo resuelven los tokens de color (`bg-superficie`,
 * `text-tinta`, `border-borde`…), que cambian solos con la clase `.dark` del <html>; ya no se escribe `dark:` en cada vista.
 */
const TOKEN = '(?:fondo|superficie|superficie-2|tinta|tinta-suave|borde|borde-control|accion|accion-hover|accion-suave|peligro|peligro-suave|ok|ok-suave|media|media-suave|alerta|alerta-suave|neutro|neutro-suave|senal|senal-suave|sobre-accion|sobre-senal)';
const CON_TOKEN = new RegExp(String.raw`(?:^|[\s:])(?:bg|text|border|fill|stroke|divide|ring)-${TOKEN}(?![\w-])`);
const COLOR_FIJO = /(?:^|[\s:])(?:bg|text|border|fill|stroke|divide|ring)-(?:white|black|gray|slate|zinc|neutral|stone)(?:-\d{2,3})?(?![\w-])/;

/** ¿La clase usa al menos un color del tema (que se adapta al modo claro/oscuro)? */
export const siguelTema = (clase: string | null | undefined): boolean => CON_TOKEN.test(clase ?? '');

/** ¿Tiene un color neutro fijo (blanco, gris…) que NO cambiaría con el tema? */
export const tieneColorFijo = (clase: string | null | undefined): boolean => COLOR_FIJO.test(clase ?? '');
