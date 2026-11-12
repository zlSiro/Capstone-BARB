import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { FinancialStats } from '../../../core/models';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { CurrencyService } from '../../../core/services/currency.service';
import { MtbfUnitService } from '../../../core/services/mtbf-unit.service';
import { Icon } from '../../../shared/components/ui/icon/icon';
import { RangoResumen, construirResumen } from './explicame-resumen';

type Pestana = 'resumen' | 'como';

/**
 * «Explícame este dashboard»: botón de la cabecera y panel lateral (hoja inferior en el celular) con dos pestañas:
 *  - «Resumen»: frases armadas con plantillas fijas a partir de las cifras que el dashboard ya recibió (`construirResumen`).
 *  - «Cómo leerlo»: qué mide cada indicador, en palabras simples.
 * No usa IA ni llama al backend. Esc cierra el panel y el foco vuelve al botón.
 */
@Component({
  selector: 'app-explicame',
  imports: [Icon, RouterLink, TranslatePipe],
  template: `
    <button
      type="button"
      class="btn-secondary"
      data-testid="btn-explicame"
      aria-haspopup="dialog"
      [attr.aria-expanded]="abierto()"
      (click)="abrir()">
      <app-icon name="foco" [size]="18" />
      {{ 'ayuda.exp_boton' | translate }}
    </button>

    @if (abierto()) {
      <!-- En el celular el panel es una hoja inferior: el velo la separa de la pantalla. En escritorio no hay velo. -->
      <div class="fixed inset-0 z-50 bg-velo md:hidden" aria-hidden="true" (click)="cerrar()"></div>
      <aside
        #panel
        role="dialog"
        aria-modal="false"
        tabindex="-1"
        data-testid="explicame-panel"
        [attr.aria-labelledby]="'explicame-titulo'"
        class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-hoja border border-borde bg-superficie text-tinta shadow-2xl outline-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:border-y-0 md:border-r-0">
        <div class="flex items-start justify-between gap-3 border-b border-borde px-5 pb-3 pt-4">
          <div class="min-w-0">
            <p class="flex items-center gap-1.5 text-sm font-semibold text-accion">
              <app-icon name="ayuda" [size]="16" />
              {{ 'ayuda.exp_etiqueta' | translate }}
            </p>
            <h2 id="explicame-titulo" class="text-xl font-bold leading-tight">{{ 'ayuda.exp_titulo' | translate }}</h2>
          </div>
          <button
            type="button"
            class="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-tinta-suave hover:bg-superficie-2 hover:text-tinta"
            data-testid="explicame-cerrar"
            [attr.aria-label]="'ayuda.exp_cerrar' | translate"
            (click)="cerrar()">
            <app-icon name="x" [size]="22" />
          </button>
        </div>

        <div class="flex gap-5 border-b border-borde px-5" role="tablist" [attr.aria-label]="'ayuda.exp_tabs_aria' | translate">
          @for (p of pestanas; track p.id) {
            <button
              type="button"
              role="tab"
              class="-mb-px min-h-11 border-b-2 text-base font-semibold"
              [class]="pestana() === p.id ? 'border-accion text-accion' : 'border-transparent text-tinta-suave hover:text-tinta'"
              [attr.id]="'explicame-tab-' + p.id"
              [attr.aria-selected]="pestana() === p.id"
              [attr.aria-controls]="'explicame-panel-' + p.id"
              [attr.data-testid]="'explicame-tab-' + p.id"
              (click)="pestana.set(p.id)">
              {{ p.clave | translate }}
            </button>
          }
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          @if (pestana() === 'resumen') {
            <div role="tabpanel" id="explicame-panel-resumen" aria-labelledby="explicame-tab-resumen">
              @if (etiquetaRango()) {
                <p class="chip chip-neutro mb-3" data-testid="explicame-periodo">{{ 'ayuda.exp_periodo' | translate: { v0: etiquetaRango() } }}</p>
              }
              <ul class="flex flex-col" data-testid="explicame-frases">
                @for (f of frases(); track f.id) {
                  <li class="border-t border-borde py-3 first:border-t-0 first:pt-0" [attr.data-testid]="'frase-' + f.id">
                    <h3 class="text-base font-bold">{{ f.titulo }}</h3>
                    <p class="mt-0.5 text-base">
                      {{ f.texto }}
                      @if (f.enlace === 'costos') {
                        <button type="button" class="ml-1 font-semibold text-accion underline-offset-2 hover:underline" data-testid="explicame-ver-costos" (click)="verDetalleCostos()">
                          {{ 'ayuda.exp_ver_detalle' | translate }}
                        </button>
                      }
                    </p>
                  </li>
                } @empty {
                  <li class="text-base text-tinta-suave">{{ 'ayuda.exp_sin_datos' | translate }}</li>
                }
              </ul>
              <p class="mt-4 text-sm text-tinta-suave" data-testid="explicame-nota">{{ 'ayuda.exp_nota' | translate }}</p>
            </div>
          } @else {
            <div role="tabpanel" id="explicame-panel-como" aria-labelledby="explicame-tab-como">
              <ul class="flex flex-col" data-testid="explicame-como">
                @for (c of comoLeerlo(); track c.id) {
                  <li class="border-t border-borde py-3 first:border-t-0 first:pt-0" [attr.data-testid]="'como-' + c.id">
                    <h3 class="text-base font-bold">{{ c.titulo }}</h3>
                    <p class="mt-0.5 text-base">{{ c.texto }}</p>
                  </li>
                }
              </ul>
            </div>
          }
        </div>

        <div class="border-t border-borde px-5 py-3 pb-seguro">
          <a class="font-semibold text-accion underline-offset-2 hover:underline" routerLink="/ayuda" data-testid="explicame-abrir-ayuda" (click)="cerrar()">
            {{ 'ayuda.exp_abrir_ayuda' | translate }}
          </a>
        </div>
      </aside>
    }
  `,
  host: { '(document:keydown.escape)': 'alEscape()' },
})
export class ExplicameComponent {
  /** La respuesta que el dashboard ya tiene: de ahí salen todas las cifras del resumen. */
  readonly stats = input.required<FinancialStats>();
  readonly rango = input.required<RangoResumen>();
  /** Etiqueta del rango elegido, tal como la muestra el selector (ya traducida). */
  readonly etiquetaRango = input('');
  /** El usuario pidió ver el desglose de costos por máquina que ya existe en el dashboard. */
  readonly verCostos = output<void>();

  private readonly i18n = inject(I18nService);
  private readonly currency = inject(CurrencyService);
  private readonly mtbfUnit = inject(MtbfUnitService);

  protected readonly abierto = signal(false);
  protected readonly pestana = signal<Pestana>('resumen');
  protected readonly pestanas: { id: Pestana; clave: string }[] = [
    { id: 'resumen', clave: 'ayuda.exp_tab_resumen' },
    { id: 'como', clave: 'ayuda.exp_tab_como' },
  ];

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private origen: HTMLElement | null = null;

  /** Formato numérico del idioma activo: coma decimal en español, punto en inglés. */
  private readonly numero = (valor: number, decimales: number): string =>
    new Intl.NumberFormat(this.i18n.lang() === 'es' ? 'es-CL' : 'en-US', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(valor);

  protected readonly frases = computed(() => {
    const t = this.i18n.tree().financial;
    const sufijo = { horas: t.mtbfUnitShortHoras, dias: t.mtbfUnitShortDias, meses: t.mtbfUnitShortMeses }[this.mtbfUnit.unidad()];
    return construirResumen({
      stats: this.stats(),
      rango: this.rango(),
      idioma: this.i18n.lang(),
      t: (clave, params) => this.i18n.tr(clave, params),
      moneda: (valor) => this.currency.formatear(valor),
      mtbf: (horas) => `${this.numero(this.mtbfUnit.convertir(horas) ?? 0, 1)} ${sufijo}`,
      numero: this.numero,
      mtbfSinDatos: t.mtbfNeedData,
    });
  });

  /** «Cómo leerlo»: qué mide cada indicador. El costo solo aparece si el perfil tiene acceso a lo financiero. */
  protected readonly comoLeerlo = computed(() => {
    const t = this.i18n.tree().financial;
    const lista = [
      { id: 'salud', titulo: this.i18n.tr('ayuda.exp_t_salud'), texto: this.i18n.tr('ayuda.exp_como_salud') },
      { id: 'sla', titulo: t.efficiency, texto: this.i18n.tr('ayuda.exp_como_sla') },
      { id: 'disponibilidad', titulo: t.disponibilidadPlanta, texto: this.i18n.tr('ayuda.exp_como_disponibilidad') },
      { id: 'mttr', titulo: t.mttrGlobal, texto: this.i18n.tr('ayuda.exp_como_mttr') },
      { id: 'mtbf', titulo: t.mtbf, texto: this.i18n.tr('ayuda.exp_como_mtbf') },
    ];
    if (this.stats().financieros_visibles !== false) {
      lista.push({ id: 'costo', titulo: t.directCost, texto: this.i18n.tr('ayuda.exp_como_costo') });
    }
    return lista;
  });

  protected abrir(): void {
    this.origen = document.activeElement as HTMLElement | null;
    this.pestana.set('resumen');
    this.abierto.set(true);
    // El panel recién se dibuja: el foco entra en él en el siguiente ciclo.
    setTimeout(() => this.panel()?.nativeElement.focus(), 0);
  }

  protected cerrar(): void {
    this.abierto.set(false);
    const origen = this.origen;
    this.origen = null;
    if (origen && document.contains(origen)) origen.focus();
  }

  protected alEscape(): void {
    if (this.abierto()) this.cerrar();
  }

  protected verDetalleCostos(): void {
    this.cerrar();
    this.verCostos.emit();
  }
}
