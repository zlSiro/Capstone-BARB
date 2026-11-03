import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService, ParamsTexto } from './i18n.service';

/**
 * `{{ 'seccion.clave' | translate }}` o con parámetros: `{{ 'usuarios.titulo' | translate: { n: lista().length } }}`
 * (el texto lleva `{n}`). Es impuro a propósito: vuelve a evaluarse al cambiar de idioma.
 */
@Pipe({
  name: 'translate',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(path: string | null | undefined, params?: ParamsTexto): string {
    if (!path) return '';

    if (!this.i18n.has(path)) {
      console.warn(`[TranslatePipe] Clave no encontrada: "${path}"`);
    }
    return this.i18n.tr(path, params);
  }
}
