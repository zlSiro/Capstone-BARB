// frontend/src/app/features/chat/image-attachment.component.ts
// CGBIDA-278 — Componente de carga de imagen para el chat multimodal (HU-05).
// Convierte un File en data URL validada (formato/tamaño) y la emite al padre;
// el padre (DocChat) decide cómo mostrarla y enviarla.

import { Component, computed, inject, input, output } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';

/** Formatos permitidos por el contrato del backend (docs/contrato_api_chat_multimedia.md). */
const ALLOWED_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Igual que MULTIMODAL_MAX_IMAGE_MB del backend: el backend revalida igual. */
const MAX_IMAGE_MB = 5;

@Component({
  selector: 'app-image-attachment',
  template: `
    <button
      type="button"
      (click)="fileInput.click()"
      [disabled]="disabled()"
      [attr.aria-label]="attachLabel()"
      [attr.title]="attachLabel()"
      class="p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400
             hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-blue-600 dark:hover:text-blue-400
             focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-lg
             disabled:opacity-50 disabled:cursor-not-allowed"
    >
      📎
    </button>
    <!-- Input oculto: lo dispara el botón (patrón accesible estándar, no interactuable por teclado). -->
    <input
      #fileInput
      type="file"
      [accept]="acceptTypes"
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      (change)="onFileSelected($event)"
    />
  `,
})
export class ImageAttachmentComponent {
  private readonly i18n = inject(I18nService);

  /** Deshabilitado mientras llega una respuesta del asistente. */
  readonly disabled = input(false);

  /** Emite la imagen lista como data URL (data:image/...;base64,...). */
  readonly imageSelected = output<string>();

  /** Emite el mensaje de validación (formato/tamaño/lectura) ya traducido. */
  readonly imageError = output<string>();

  readonly acceptTypes = ALLOWED_IMAGE_TYPES.join(',');

  readonly attachLabel = computed(() => this.i18n.t('docChat').attachImage);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Resetear para permitir re-seleccionar el mismo archivo (p. ej. tras quitarlo).
    input.value = '';
    if (!file) return;

    const t = this.i18n.t('docChat');

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      this.imageError.emit(t.imageInvalidFormat);
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      this.imageError.emit(t.imageTooLarge.replace('{mb}', String(MAX_IMAGE_MB)));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        this.imageSelected.emit(result);
      } else {
        this.imageError.emit(t.imageReadError);
      }
    };
    reader.onerror = () => this.imageError.emit(t.imageReadError);
    reader.readAsDataURL(file);
  }
}
