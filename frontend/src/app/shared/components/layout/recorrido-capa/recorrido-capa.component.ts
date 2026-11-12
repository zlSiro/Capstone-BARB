import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import { I18nService } from '../../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { claveRecorrido } from '../../../../features/ayuda/ayuda-contenido';
import { RecorridosService } from '../../../../features/ayuda/recorridos.service';
import { Icon } from '../../ui/icon/icon';

const MARGEN = 12;
const ANCHO_BURBUJA = 360;
const SEPARACION = 14;
const ALTO_ESTIMADO = 300;
/** Debajo de este ancho (px) la burbuja va abajo, sobre la barra inferior del celular. */
const ANCHO_MOVIL = 768;
const CONTROLES = new Set(['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'A', 'LABEL']);

/** El ancestro que realmente se desplaza (en BARB, el `<main>` del layout), o la página si ninguno lo hace. */
function contenedorConScroll(el: HTMLElement): Element {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const overflow = getComputedStyle(n).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement ?? document.documentElement;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Capa del recorrido guiado (se monta en `main-layout`): oscurece la pantalla, resalta el elemento del paso con un borde
 * y muestra la burbuja con el paso, el texto y los botones.
 *
 * - El velo y el resaltado no capturan clics (`pointer-events-none`): el usuario puede usar el elemento resaltado de
 *   verdad (p. ej. cambiar el estado de una OT) o avanzar sin tocar nada.
 * - El resaltado no depende solo del color: lleva borde grueso y el texto del paso. Respeta `prefers-reduced-motion`.
 * - `Esc` cierra el recorrido; el foco entra en la burbuja al empezar y vuelve al botón que lo inició al salir.
 * - Cada cambio de paso se anuncia en una región `aria-live`. No avanza solo ni tiene límite de tiempo.
 */
@Component({
  selector: 'app-recorrido-capa',
  imports: [Icon, TranslatePipe],
  host: { '(document:keydown.escape)': 'alEscape()', '(window:resize)': 'medir()' },
  template: `
    @if (r.activo(); as rec) {
      @if (marco(); as c) {
        <div
          class="pointer-events-none fixed z-[60] rounded-control border-[3px] border-senal"
          data-testid="recorrido-resaltado"
          [style.top.px]="c.top - 4"
          [style.left.px]="c.left - 4"
          [style.width.px]="c.width + 8"
          [style.height.px]="c.height + 8"
          [style.box-shadow]="'0 0 0 9999px var(--velo)'"></div>
      } @else {
        <div class="pointer-events-none fixed inset-0 z-[60] bg-velo" data-testid="recorrido-velo"></div>
      }

      <div
        #burbuja
        role="dialog"
        aria-modal="false"
        tabindex="-1"
        data-testid="recorrido-burbuja"
        [attr.aria-labelledby]="idTitulo"
        [class]="posicion().clase"
        [style.top.px]="posicion().top"
        [style.left.px]="posicion().left"
        [style.bottom.px]="posicion().bottom"
        [style.width.px]="posicion().ancho">
        <div class="flex items-start justify-between gap-3">
          <p class="text-sm font-semibold text-accion" data-testid="recorrido-paso">
            {{ 'ayuda.tour_paso' | translate: { v0: r.indice() + 1, v1: r.total() } }} · {{ tituloRecorrido() | translate }}
          </p>
          <button
            type="button"
            class="-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-tinta-suave hover:bg-superficie-2 hover:text-tinta"
            data-testid="recorrido-cerrar"
            [attr.aria-label]="'ayuda.tour_salir' | translate"
            (click)="r.salir()">
            <app-icon name="x" [size]="20" />
          </button>
        </div>

        <div
          class="mt-1 h-1.5 overflow-hidden rounded-full bg-borde"
          role="progressbar"
          aria-valuemin="0"
          [attr.aria-valuemax]="r.total()"
          [attr.aria-valuenow]="r.indice() + 1"
          [attr.aria-label]="'ayuda.tour_avance_aria' | translate">
          <div class="h-full bg-accion transition-[width] duration-200" [style.width.%]="((r.indice() + 1) / r.total()) * 100"></div>
        </div>

        <h2 [id]="idTitulo" class="mt-3 text-lg font-bold text-tinta" data-testid="recorrido-titulo">{{ claveTitulo() | translate }}</h2>
        <p class="mt-1 text-base text-tinta" data-testid="recorrido-texto">{{ claveTexto() | translate }}</p>

        @if (sugerirInteraccion()) {
          <p class="mt-3 rounded-control border-l-4 border-accion bg-accion-suave px-3 py-2 text-sm text-tinta" data-testid="recorrido-sugerencia">
            {{ 'ayuda.tour_sugerencia' | translate }}
          </p>
        }
        @if (r.sinElemento()) {
          <p class="mt-3 rounded-control border-l-4 border-senal bg-senal-suave px-3 py-2 text-sm text-tinta" role="status" data-testid="recorrido-sin-elemento">
            {{ 'ayuda.tour_sin_elemento' | translate }}
          </p>
        }

        <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button type="button" class="btn-ghost mr-auto" data-testid="recorrido-salir" (click)="r.salir()">{{ 'ayuda.tour_salir' | translate }}</button>
          <button type="button" class="btn-secondary" data-testid="recorrido-anterior" [disabled]="r.indice() === 0" (click)="r.anterior()">
            <app-icon name="atras" [size]="18" />
            {{ 'ayuda.tour_anterior' | translate }}
          </button>
          <button type="button" class="btn-primary" data-testid="recorrido-siguiente" (click)="r.siguiente()">
            {{ (ultimo() ? 'ayuda.tour_terminar' : 'ayuda.tour_siguiente') | translate }}
            @if (!ultimo()) {
              <app-icon name="adelante" [size]="18" />
            }
          </button>
        </div>
      </div>

      <div class="sr-only" role="status" aria-live="polite" data-testid="recorrido-anuncio">{{ anuncio() }}</div>
    }
  `,
})
export class RecorridoCapaComponent {
  protected readonly r = inject(RecorridosService);
  private readonly i18n = inject(I18nService);

  protected readonly idTitulo = 'recorrido-titulo-burbuja';
  private readonly burbuja = viewChild<ElementRef<HTMLElement>>('burbuja');

  protected readonly rect = signal<Rect | null>(null);
  private readonly movil = signal(false);
  /** Altura real de la burbuja (se mide); sirve para ubicarla sin que se salga de la pantalla. */
  private readonly alto = signal(ALTO_ESTIMADO);

  /** El borde de resaltado, recortado a lo que se ve en pantalla (un elemento muy alto no dibuja su borde fuera de ella). */
  protected readonly marco = computed(() => {
    const c = this.rect();
    if (!c) return null;
    const top = Math.max(c.top, 0);
    const bottom = Math.min(c.top + c.height, window.innerHeight);
    return bottom >= top ? { top, left: c.left, width: c.width, height: bottom - top } : null;
  });

  protected readonly ultimo = computed(() => this.r.indice() >= this.r.total() - 1);
  protected readonly tituloRecorrido = computed(() => claveRecorrido(this.r.activo()?.id ?? '', 'titulo'));
  protected readonly claveTitulo = computed(() => claveRecorrido(this.r.activo()?.id ?? '', `p${this.r.indice() + 1}_titulo`));
  protected readonly claveTexto = computed(() => claveRecorrido(this.r.activo()?.id ?? '', `p${this.r.indice() + 1}_texto`));

  /** Solo se invita a «hacerlo de verdad» cuando lo resaltado es un control (botón, selector, campo). */
  protected readonly sugerirInteraccion = computed(() => {
    const el = this.r.elemento();
    return !!el && CONTROLES.has(el.tagName);
  });

  /** Texto para lectores de pantalla: se actualiza en cada paso (y al cambiar de idioma). */
  protected readonly anuncio = computed(() =>
    this.i18n.tr('ayuda.tour_anuncio', {
      v0: this.r.indice() + 1,
      v1: this.r.total(),
      v2: this.i18n.tr(this.claveTitulo()),
    }),
  );

  /** Dónde va la burbuja: abajo, sobre la barra inferior, en el celular; junto al elemento (o centrada) en escritorio. */
  protected readonly posicion = computed(() => {
    const base =
      'panel fixed z-[61] flex max-h-[calc(100dvh-1.5rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-y-auto rounded-hoja border border-borde bg-superficie p-4 shadow-2xl outline-none';
    if (this.movil()) {
      return { clase: `${base} inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] max-h-[60dvh] overflow-y-auto`, top: null, left: null, bottom: null, ancho: null };
    }
    const c = this.rect();
    if (!c) {
      return { clase: `${base} left-1/2 top-1/2 w-[22.5rem] -translate-x-1/2 -translate-y-1/2`, top: null, left: null, bottom: null, ancho: null };
    }
    const ancho = Math.min(ANCHO_BURBUJA, window.innerWidth - 2 * MARGEN);
    const left = Math.max(MARGEN, Math.min(c.left, window.innerWidth - ancho - MARGEN));
    // Junto al elemento, del lado con más espacio y SIEMPRE dentro de la pantalla (con la altura real de la burbuja).
    const alto = Math.min(this.alto(), window.innerHeight - 2 * MARGEN);
    const debajo = c.top + c.height + SEPARACION;
    const espacioAbajo = window.innerHeight - debajo - MARGEN;
    const espacioArriba = c.top - SEPARACION - MARGEN;
    const preferida = espacioAbajo >= alto || espacioAbajo >= espacioArriba ? debajo : c.top - SEPARACION - alto;
    const top = Math.min(Math.max(preferida, MARGEN), window.innerHeight - alto - MARGEN);
    return { clase: base, top, left, bottom: null, ancho };
  });

  constructor() {
    // Mide al cambiar de paso o de elemento; y cada tanto, porque la pantalla puede moverse o redibujarse.
    effect(() => {
      this.r.elemento();
      this.r.activo();
      untracked(() => this.medir());
    });
    const intervalo = setInterval(() => {
      if (!this.r.activo()) return;
      this.r.reubicar();
      this.medir();
    }, 200);
    inject(DestroyRef).onDestroy(() => clearInterval(intervalo));

    // Cada vez que se resalta un elemento nuevo, se lo encuadra en la zona libre (ver `encuadrar`) una vez dibujada la burbuja.
    effect(() => {
      if (this.r.elemento()) untracked(() => setTimeout(() => this.encuadrar(), 0));
    });

    // El foco entra en la burbuja cuando empieza el recorrido (no en cada paso, para no sacarlo de los botones).
    let estabaActivo = false;
    effect(() => {
      const activo = !!this.r.activo();
      if (activo && !estabaActivo) setTimeout(() => this.burbuja()?.nativeElement.focus(), 0);
      estabaActivo = activo;
    });
  }

  protected alEscape(): void {
    if (this.r.activo()) this.r.salir();
  }

  /**
   * Deja el elemento resaltado a la vista, en la zona libre de la pantalla: debajo de la cabecera y, en el celular, sobre la
   * burbuja (que va abajo y lo taparía). Si ya se ve entero no hace nada; si no, desplaza el contenedor que lo contiene.
   */
  private encuadrar(): void {
    const el = this.r.elemento();
    if (!el) return;
    this.medir();
    const c = el.getBoundingClientRect();
    const cabecera = document.querySelector('app-header')?.getBoundingClientRect().bottom ?? 0;
    const arriba = Math.max(cabecera, 0) + MARGEN;
    let abajo = window.innerHeight - MARGEN;
    if (this.movil()) {
      const burbuja = this.burbuja()?.nativeElement;
      if (burbuja) abajo = Math.min(abajo, burbuja.getBoundingClientRect().top - SEPARACION);
    }
    if (c.top >= arriba && c.bottom <= abajo) return;
    // Al centro de la zona libre; si el elemento es más alto que ella, por arriba (se ve su comienzo).
    const libre = abajo - arriba;
    const destino = c.height >= libre ? arriba : arriba + (libre - c.height) / 2;
    contenedorConScroll(el).scrollBy?.({ top: c.top - destino, behavior: 'auto' });
    this.medir();
  }

  protected medir(): void {
    this.movil.set(window.innerWidth < ANCHO_MOVIL);
    const burbuja = this.burbuja()?.nativeElement;
    if (burbuja && burbuja.offsetHeight > 0 && burbuja.offsetHeight !== this.alto()) this.alto.set(burbuja.offsetHeight);
    const el = this.r.elemento();
    if (!el) {
      if (this.rect() !== null) this.rect.set(null);
      return;
    }
    const b = el.getBoundingClientRect();
    const actual = this.rect();
    if (!actual || actual.top !== b.top || actual.left !== b.left || actual.width !== b.width || actual.height !== b.height) {
      this.rect.set({ top: b.top, left: b.left, width: b.width, height: b.height });
    }
  }
}
