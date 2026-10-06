import { Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';

let nextId = 0;

/**
 * Contenedor de diálogo reutilizable (accesible): role="dialog", aria-modal,
 * cierre con ESC / clic en el fondo y foco inicial en el primer control.
 */
@Component({
  selector: 'app-modal',
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" (click)="closed.emit()">
      <div
        #dialog
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        class="max-h-full w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        [class.max-w-lg]="size() === 'md'"
        [class.max-w-3xl]="size() === 'lg'"
        (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 [id]="titleId" class="text-xl font-bold text-slate-100">{{ title() }}</h2>
            @if (subtitle()) {
              <p class="text-sm text-slate-400">{{ subtitle() }}</p>
            }
          </div>
          <button
            type="button"
            (click)="closed.emit()"
            class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Cerrar">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div class="px-6 py-5">
          <ng-content />
        </div>
      </div>
    </div>
  `,
})
export class ModalComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly size = input<'md' | 'lg'>('md');
  readonly closed = output<void>();

  protected readonly titleId = `modal-title-${nextId++}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  constructor() {
    afterNextRender(() => {
      const first = this.dialog().nativeElement.querySelector<HTMLElement>('input, select, textarea');
      first?.focus();
    });
  }
}
