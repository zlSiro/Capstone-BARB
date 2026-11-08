import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TopMtbfData, TopMttrData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { MtbfUnitService, UnidadMtbf } from '../../../../core/services/mtbf-unit.service';

/**
 * Top 5 de máquinas por peor MTTR y peor MTBF (CGBIDA-516 y 517).
 *
 * Dos listas compactas, una al lado de la otra:
 * - **Peor MTTR**: las que más tardan en repararse (mayor tiempo promedio).
 * - **Peor MTBF**: las que menos aguantan sin fallar (menor tiempo entre fallas).
 *
 * Los datos llegan como `input` desde el dashboard: son `top_5_peor_mttr` y
 * `top_5_peor_mtbf` de la MISMA respuesta de stats, así que no hay un segundo request ni
 * el riesgo de que las listas no coincidan con los KPIs de arriba.
 *
 * El MTBF se muestra en la unidad que eligió el usuario (horas/días/meses) usando el
 * servicio compartido, para no leer "796 h" arriba y "33 d" acá.
 */
@Component({
  selector: 'app-top-maquinas',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure
      class="flex h-full flex-col rounded-control border border-borde bg-superficie p-5 "
      data-testid="top-maquinas"
    >
      <figcaption class="mb-3">
        <h2 class="text-sm font-extrabold text-tinta ">{{ t().topPeorTitle }}</h2>
        <p class="text-sm text-tinta-suave ">{{ t().topPeorSub }}</p>
      </figcaption>

      <div class="grid flex-1 gap-4 sm:grid-cols-2">
        <!-- Peor MTTR -->
        <section data-testid="top-mttr">
          <h3 class="mb-1 text-sm font-semibold text-tinta-suave ">{{ t().topPeorMttr }}</h3>
          @if (peorMttr().length === 0) {
            <p class="py-2 text-sm text-tinta-suave " data-testid="top-mttr-vacio">
              {{ t().topPeorMttrEmpty }}
            </p>
          } @else {
            <ol class="flex flex-col">
              @for (m of peorMttr(); track m.id; let i = $index) {
                <li
                  class="flex items-center justify-between gap-2 border-b border-borde/60 py-1.5"
                  data-testid="top-mttr-fila"
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <span
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
                             bg-peligro-suave text-sm font-bold text-peligro "
                    >{{ i + 1 }}</span>
                    <span class="truncate text-sm text-tinta ">{{ m.name }}</span>
                  </span>
                  <span class="shrink-0 text-sm font-semibold tabular-nums text-tinta ">
                    {{ m.valor }}
                  </span>
                </li>
              }
            </ol>
          }
        </section>

        <!-- Peor MTBF -->
        <section data-testid="top-mtbf">
          <h3 class="mb-1 text-sm font-semibold text-tinta-suave ">{{ t().topPeorMtbf }}</h3>
          @if (peorMtbf().length === 0) {
            <p class="py-2 text-sm text-tinta-suave " data-testid="top-mtbf-vacio">
              {{ t().topPeorMtbfEmpty }}
            </p>
          } @else {
            <ol class="flex flex-col">
              @for (m of peorMtbf(); track m.id; let i = $index) {
                <li
                  class="flex items-center justify-between gap-2 border-b border-borde/60 py-1.5"
                  data-testid="top-mtbf-fila"
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <span
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
                             bg-peligro-suave text-sm font-bold text-peligro "
                    >{{ i + 1 }}</span>
                    <span class="min-w-0">
                      <span class="block truncate text-sm text-tinta ">{{ m.name }}</span>
                      <span class="block text-sm text-tinta-suave ">
                        {{ m.fallas }} {{ t().topPeorFallas }}
                      </span>
                    </span>
                  </span>
                  <span class="shrink-0 text-sm font-semibold tabular-nums text-tinta ">
                    {{ m.valor }}
                  </span>
                </li>
              }
            </ol>
          }
        </section>
      </div>
    </figure>
  `,
})
export class TopMaquinasComponent {
  private i18n = inject(I18nService);
  private mtbfService = inject(MtbfUnitService);

  /** Top 5 con peor MTTR: las que más tardan en repararse. */
  readonly mttr = input.required<TopMttrData[]>();

  /** Top 5 con peor MTBF: las que menos aguantan sin fallar. */
  readonly mtbf = input.required<TopMtbfData[]>();

  protected readonly t = computed(() => this.i18n.tree().financial);

  /** Filas de MTTR, formateadas en minutos. */
  protected readonly peorMttr = computed(() =>
    this.mttr().map((m) => ({
      id: m.id,
      name: m.name,
      valor: `${m.mttr.toFixed(0)} ${this.t().topPeorMin}`,
    }))
  );

  /** Filas de MTBF, convertidas a la unidad activa (horas/días/meses). */
  protected readonly peorMtbf = computed(() => {
    const sufijo = this.sufijoMtbf();
    return this.mtbf().map((m) => ({
      id: m.id,
      name: m.name,
      fallas: m.fallas,
      valor: this.mtbfService.formatear(m.mtbf_hours, sufijo),
    }));
  });

  /** Sufijo corto de la unidad de MTBF activa. */
  private sufijoMtbf(): string {
    const t = this.t();
    const unidad: UnidadMtbf = this.mtbfService.unidad();
    switch (unidad) {
      case 'horas':
        return t.mtbfUnitShortHoras;
      case 'meses':
        return t.mtbfUnitShortMeses;
      default:
        return t.mtbfUnitShortDias;
    }
  }
}
