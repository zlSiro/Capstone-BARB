import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';

@Pipe({
  name: 'translate',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(path: string): string {
    if (!path) return '';

    const parts = path.split('.');
    if (parts.length !== 2) {
      console.warn(`[TranslatePipe] Path inválido: "${path}". Formato esperado: "seccion.clave"`);
      return path;
    }

    const section = parts[0] as string;
    const key = parts[1] as string;

    const sectionTree = (this.i18n.tree() as Record<string, Record<string, unknown>>)[section];

    if (!sectionTree) {
      console.warn(`[TranslatePipe] Sección no encontrada: "${section}"`);
      return path;
    }

    const value = sectionTree[key];

    if (value === undefined) {
      console.warn(`[TranslatePipe] Clave no encontrada: "${path}"`);
      return path;
    }

    return String(value);
  }
}
