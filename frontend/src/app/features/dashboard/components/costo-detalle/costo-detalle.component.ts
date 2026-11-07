import { Component, HostListener, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MachineData } from '../../../../core/models';
import { CurrencyService } from '../../../../core/services/currency.service';
import { I18nService } from '../../../../core/i18n/i18n.service';

/**
 * Modal de costos desglosados (CGBIDA-518).
 *
 * Abre desde el botón "Ver detalle" de la tarjeta de Costo Directo. Muestra el costo real
 * del período por máquina, ordenado de mayor a menor, con el porcentaje que representa
 * cada una sobre el total.
 *
 * Decisiones:
 * - **Overlay oscurecido** con `bg-black/60`: el contenido del dashboard queda visible
 *   pero en segundo plano, que es lo que se espera de un modal y no de una página nueva.
 * - **Cierre por X, por ESC y por clic en el overlay**: las tres formas que la gente
 *   intenta. `document:keydown.escape` se usa solo cuando está abierto.
 * - Los datos salen de `machines_por_costo` de la MISMA respuesta de stats: no hay un
 *   segundo request ni datos mock, así el desglose siempre coincide con el total que se
 *   muestra en la tarjeta.
 */
@Component({
  selector: 'app-costo-detalle',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (abierto()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="t().costDetailTitle"
        data-testid="modal-costos"
      >
        <!-- Overlay: clic fuera cierra. -->
        <div
          class="absolute inset-0 bg-black/60"
          (click)="cerrar.emit()"
          data-testid="overlay-costos"
        ></div>

        <div
          class="relative z-10 flex max-h-[80vh] w-full max-w-3xl flex-col rounded-control
                 border border-borde bg-superficie shadow-2xl"
        >
          <header class="flex items-start justify-between gap-6 border-b border-borde p-5">
            <div>
              <h2 class="text-lg font-extrabold text-tinta ">{{ t().costDetailTitle }}</h2>
              <p class="text-sm text-tinta-suave ">{{ t().costDetailSub }}</p>
            </div>
            <button
              type="button"
              (click)="cerrar.emit()"
              [attr.aria-label]="t().costDetailClose"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border
                     border-borde-control text-lg leading-none text-tinta-suave transition-colors
                     hover:border-peligro hover:text-peligro focus:border-peligro
                     focus:text-peligro focus:outline-none"
              data-testid="cerrar-costos"
            >✕</button>
          </header>

          <div class="overflow-auto p-5">
            @if (filas().length === 0) {
              <p class="py-6 text-center text-sm text-tinta-suave " data-testid="costos-vacio">
                {{ t().costDetailEmpty }}
              </p>
            } @else {
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-borde text-tinta-suave ">
                    <th class="py-2 pr-2 font-semibold ">{{ t().costDetailMachine }}</th>
                    <th class="py-2 pr-2 text-right font-semibold ">{{ t().costDetailOts }}</th>
                    <th class="py-2 pr-2 text-right font-semibold ">{{ t().costDetailCost }}</th>
                    <th class="py-2 text-right font-semibold ">{{ t().costDetailShare }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of filas(); track f.id) {
                    <tr class="border-b border-borde/60 " [attr.data-testid]="'costo-fila-' + f.id">
                      <td class="py-2 pr-2 text-tinta ">{{ f.name }}</td>
                      <td class="py-2 pr-2 text-right tabular-nums text-tinta-suave ">{{ f.total }}</td>
                      <td class="py-2 pr-2 text-right tabular-nums text-tinta ">{{ f.costo }}</td>
                      <td class="py-2 text-right tabular-nums text-tinta-suave ">{{ f.share }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="font-bold text-tinta ">
                    <td class="py-2 pr-2 " colspan="2">{{ t().costDetailTotal }}</td>
                    <td class="py-2 pr-2 text-right tabular-nums" data-testid="costo-total">
                      {{ total() }}
                    </td>
                    <td class="py-2 text-right tabular-nums text-tinta-suave ">100 %</td>
                  </tr>
                </tfoot>
              </table>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class CostoDetalleComponent {
  private i18n = inject(I18nService);
  private currency = inject(CurrencyService);

  /** Visibilidad del modal. Lo controla el dashboard. */
  readonly abierto = input.required<boolean>();

  /** Filas de `machines_por_costo` de la respuesta de stats. */
  readonly maquinas = input.required<MachineData[]>();

  /** Se emite al cerrar por X, ESC o clic en el overlay. */
  readonly cerrar = output<void>();

  protected readonly t = computed(() => this.i18n.tree().financial);

  /** Filas ordenadas por costo real descendente, con su porcentaje del total. */
  protected readonly filas = computed(() => {
    const ms = this.maquinas();
    const total = ms.reduce((acc, m) => acc + (m.costo_total ?? 0), 0);
    return [...ms]
      .sort((a, b) => (b.costo_total ?? 0) - (a.costo_total ?? 0))
      .map((m) => ({
        id: m.id,
        name: m.name,
        total: m.total,
        costo: this.currency.formatear(m.costo_total ?? 0),
        share: total > 0 ? `${(((m.costo_total ?? 0) / total) * 100).toFixed(1)} %` : '—',
      }));
  });

  /** Total del período en la moneda activa. */
  protected readonly total = computed(() =>
    this.currency.formatear(this.maquinas().reduce((acc, m) => acc + (m.costo_total ?? 0), 0))
  );

  /** ESC cierra el modal. Solo escucha cuando está abierto. */
  @HostListener('document:keydown.escape')
  protected alPresionarEscape(): void {
    if (this.abierto()) this.cerrar.emit();
  }
}
