/** Desde este tamaño se reduce la foto antes de enviarla: en faena la señal es lenta y una foto de celular pesa varios MB. */
export const UMBRAL_REDUCCION_BYTES = 1.5 * 1024 * 1024;
const LADO_MAXIMO_PX = 1600;
const CALIDAD_JPEG = 0.82;

/**
 * Devuelve una versión liviana de la foto (JPEG de hasta 1600 px por lado) si la original es grande.
 * Si el navegador no puede procesarla, o el resultado no queda más liviano, devuelve la original sin tocarla:
 * reducir es una ayuda, nunca debe impedir el envío.
 */
export async function reducirImagen(archivo: File): Promise<File> {
  if (archivo.size <= UMBRAL_REDUCCION_BYTES) return archivo;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return archivo;

  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MAXIMO_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', CALIDAD_JPEG));
    if (!blob || blob.size >= archivo.size) return archivo;
    return new File([blob], archivo.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return archivo;
  }
}
