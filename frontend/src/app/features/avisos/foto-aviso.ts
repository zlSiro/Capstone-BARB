import { Component, DestroyRef, OnInit, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

import { Aviso } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
/** Foto que adjuntó quien reportó la falla. Se descarga con la sesión del usuario (el backend valida la visibilidad). */
@Component({
  imports: [TranslatePipe],
  selector: 'app-foto-aviso',
  template: `
    @if (src(); as url) {
      <img [src]="url" [alt]="'Foto de la falla del aviso ' + aviso().numero_aviso" class="max-h-[70dvh] max-w-full rounded-control object-contain" />
    } @else if (error()) {
      <p role="alert" class="text-base font-medium text-peligro">{{ error() }}</p>
    } @else {
      <p role="status" class="text-base text-tinta-suave">{{ 'avisos.cargando_foto' | translate }}</p>
    }
  `,
  host: { class: 'flex min-h-32 items-center justify-center' },
})
export class FotoAviso implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly api = inject(AvisosApi);
  private readonly sanitizer = inject(DomSanitizer);

  readonly aviso = input.required<Aviso>();

  protected readonly src = signal<SafeUrl | null>(null);
  protected readonly error = signal<string | null>(null);
  private objectUrl: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    });
  }

  ngOnInit(): void {
    this.api.foto(this.aviso().aviso_id).subscribe({
      next: (blob) => {
        this.objectUrl = URL.createObjectURL(blob);
        // URL de un blob que acabamos de crear nosotros: es seguro.
        this.src.set(this.sanitizer.bypassSecurityTrustUrl(this.objectUrl));
      },
      error: () => this.error.set(this.i18n.tr('avisos.la_foto_ya_no')),
    });
  }
}
