import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, viewChild } from '@angular/core';

import { Icon } from '../icon/icon';

let nextId = 0;
/** Cantidad de diálogos abiertos: el scroll de la página solo se libera al cerrar el último. */
let abiertos = 0;

const FOCUSABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Contenedor de diálogo reutilizable y accesible.
 *
 * - En móvil es una **hoja inferior** (sube desde abajo, ocupa casi toda la pantalla); desde `md` es un diálogo centrado.
 * - El botón principal va en el **pie fijo** (`<div modal-footer>`): siempre visible, aunque el contenido haga scroll.
 * - role="dialog", aria-modal, cierre con ESC / clic en el velo, foco atrapado dentro mientras está abierto y devuelto
 *   al elemento que lo abrió al cerrar. El scroll de la página queda bloqueado detrás.
 * - En pantallas táctiles el foco inicial va al diálogo (no al primer campo) para que no salte el teclado.
 */
@Component({
  selector: 'app-modal',
  imports: [Icon],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div
      class="fixed inset-0 z-50 flex animate-[velo-aparece_160ms_ease-out] items-end justify-center bg-velo md:items-center md:p-6"
      (click)="closed.emit()">
      <div
        #dialog
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        [attr.aria-labelledby]="titleId"
        class="flex max-h-[92dvh] w-full animate-[hoja-sube_220ms_ease-out] flex-col overflow-hidden rounded-t-hoja border border-borde bg-superficie text-tinta shadow-2xl outline-none md:max-h-[88dvh] md:rounded-hoja"
        [class.md:max-w-lg]="size() === 'md'"
        [class.md:max-w-3xl]="size() === 'lg'"
        [class.md:max-w-5xl]="size() === 'xl'"
        (click)="$event.stopPropagation()"
        (keydown)="atraparFoco($event)">
        <div class="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-borde md:hidden" aria-hidden="true"></div>

        <div class="flex shrink-0 items-start justify-between gap-3 border-b border-borde px-5 pb-3 pt-3 md:pt-4">
          <div class="min-w-0">
            <h2 [id]="titleId" class="break-words text-xl font-bold leading-tight">{{ title() }}</h2>
            @if (subtitle()) {
              <p class="mt-0.5 text-sm text-tinta-suave">{{ subtitle() }}</p>
            }
          </div>
          <div class="flex shrink-0 items-start gap-2">
            @if (badge()) {
              <div class="rounded-control border border-accion bg-accion-suave px-2.5 py-1 text-right" data-testid="modal-badge">
                @if (badgeLabel()) {
                  <p class="text-xs font-medium leading-tight text-accion">{{ badgeLabel() }}</p>
                }
                <p class="codigo text-base leading-tight text-accion">{{ badge() }}</p>
              </div>
            }
            <button
              type="button"
              (click)="closed.emit()"
              class="-mr-2 -mt-1 inline-flex size-12 items-center justify-center rounded-control text-tinta-suave transition-colors hover:bg-superficie-2 hover:text-tinta md:size-10"
              aria-label="Cerrar">
              <app-icon name="x" [size]="22" />
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ng-content />
        </div>

        <div class="shrink-0 border-t border-borde bg-superficie px-5 pt-3 pb-seguro empty:hidden">
          <ng-content select="[modal-footer]" />
        </div>
      </div>
    </div>
  `,
})
export class ModalComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly size = input<'md' | 'lg' | 'xl'>('md');
  /** Identificador que se muestra en la esquina superior derecha (p. ej. el reporte de falla que originó la OT). */
  readonly badge = input<string | null>(null);
  /** Rótulo pequeño sobre la insignia. */
  readonly badgeLabel = input<string>('');
  readonly closed = output<void>();

  protected readonly titleId = `modal-title-${nextId++}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly previo = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  constructor() {
    abiertos += 1;
    if (typeof document !== 'undefined') document.body.style.overflow = 'hidden';

    afterNextRender(() => {
      const el = this.dialog().nativeElement;
      // Con puntero fino (escritorio) se enfoca el primer campo; en táctil, el diálogo, para no abrir el teclado.
      const fino = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
      const primero = fino ? el.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea') : null;
      (primero ?? el).focus();
    });

    inject(DestroyRef).onDestroy(() => {
      abiertos = Math.max(0, abiertos - 1);
      if (abiertos === 0 && typeof document !== 'undefined') document.body.style.overflow = '';
      // Devuelve el foco a quien abrió el diálogo, si sigue en pantalla.
      if (this.previo && document.contains(this.previo)) this.previo.focus();
    });
  }

  /** Mantiene Tab / Shift+Tab dentro del diálogo mientras está abierto. */
  protected atraparFoco(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const el = this.dialog().nativeElement;
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLES)).filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) {
      event.preventDefault();
      el.focus();
      return;
    }
    const primero = items[0];
    const ultimo = items[items.length - 1];
    const activo = document.activeElement;
    if (event.shiftKey && (activo === primero || activo === el)) {
      event.preventDefault();
      ultimo.focus();
    } else if (!event.shiftKey && activo === ultimo) {
      event.preventDefault();
      primero.focus();
    }
  }
}
