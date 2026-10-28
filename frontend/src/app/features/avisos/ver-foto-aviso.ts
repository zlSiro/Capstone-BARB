import { Component, DestroyRef, OnInit, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

import { Aviso } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';

/** Visor de la foto que adjuntó quien reportó la falla. Se descarga con la sesión del usuario (el backend valida la visibilidad). */
@Component({
  selector: 'app-ver-foto-aviso',
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" (click)="cerrar()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ver-foto-title"
        class="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="ver-foto-title" class="text-lg font-bold text-slate-100">Foto de la falla</h2>
            <p class="font-mono text-xs text-slate-400">{{ aviso().numero_aviso }} · {{ aviso().machine_name }}</p>
          </div>
          <button type="button" (click)="cerrar()" class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Cerrar">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div class="flex min-h-48 items-center justify-center overflow-auto p-4">
          @if (src(); as url) {
            <img [src]="url" [alt]="'Foto de la falla del aviso ' + aviso().numero_aviso" class="max-h-[70vh] max-w-full rounded object-contain" />
          } @else if (error()) {
            <p role="alert" class="text-sm text-red-400">{{ error() }}</p>
          } @else {
            <p role="status" class="text-sm text-slate-400">Cargando foto…</p>
          }
        </div>
      </div>
    </div>
  `,
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class VerFotoAviso implements OnInit {
  private readonly api = inject(AvisosApi);
  private readonly sanitizer = inject(DomSanitizer);

  readonly aviso = input.required<Aviso>();
  readonly closed = output<void>();

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
      error: () => this.error.set('La foto ya no está disponible.'),
    });
  }

  protected cerrar(): void {
    this.closed.emit();
  }
}
