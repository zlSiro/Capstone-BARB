import { Component, computed, input } from '@angular/core';

import { GraficoBarras } from '../../../core/models';

/** Barras horizontales con el valor escrito: no dependen del color para entenderse y se imprimen bien. */
@Component({
  selector: 'app-grafico-barras',
  template: `
    <figure class="flex flex-col gap-2" [attr.data-testid]="'grafico-' + grafico().id">
      <figcaption class="text-base font-semibold text-tinta">{{ grafico().titulo }}</figcaption>
      @if (grafico().items.length) {
        <ul class="flex flex-col gap-1.5">
          @for (i of grafico().items; track i.etiqueta) {
            <li class="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 text-sm">
              <span class="truncate text-tinta" [attr.title]="i.etiqueta">{{ i.etiqueta }}</span>
              <span class="h-3 overflow-hidden rounded-full bg-borde" aria-hidden="true">
                <span class="block h-full rounded-full bg-accion [print-color-adjust:exact]" [style.width.%]="ancho(i.valor)"></span>
              </span>
              <span class="codigo text-tinta">{{ i.texto }}</span>
            </li>
          }
        </ul>
      }
      @if (grafico().nota) {
        <p class="text-sm text-tinta-suave">{{ grafico().nota }}</p>
      }
    </figure>
  `,
})
export class GraficoBarrasComponent {
  readonly grafico = input.required<GraficoBarras>();
  private readonly maximo = computed(() => Math.max(1, ...this.grafico().items.map((i) => i.valor)));
  protected ancho(valor: number): number {
    return Math.max(valor > 0 ? 2 : 0, Math.round((100 * valor) / this.maximo()));
  }
}
