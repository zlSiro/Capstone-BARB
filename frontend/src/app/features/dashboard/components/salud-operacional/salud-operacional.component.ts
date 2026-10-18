import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponenteSalud, EstadoSalud, SaludOperacionalData, TrendData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';

/**
 * Tarjeta de Salud Operacional (CGBIDA-435).
 *
 * Es la pieza que Samuel pidió: un indicador fuerte, no un gráfico de líneas más.
 *
 * - **El anillo** muestra el índice 0-100 y se pinta con el color del estado. El número
 *   grande es lo primero que se lee.
 * - **Los tres componentes** (SLA, MTBF, backlog) van debajo del anillo: son la respuesta
 *   a "¿por qué este color?". Un semáforo sin desglose es otra caja negra.
 * - **La tendencia de backlog** queda como minigráfico al pie. Reemplaza al gráfico de
 *   backlog suelto: el dato sigue visible sin ocupar una tarjeta entera, y el espacio
 *   ganado es lo que paga el indicador nuevo sin que el dashboard empiece a hacer scroll.
 *
 * Si el estado es `insuficiente` el anillo se dibuja en gris y con guion, nunca en verde:
 * el backend se niega a pintar verde lo que no puede medir, y la interfaz no lo contradice.
 */
@Component({
  selector: 'app-salud-operacional',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure
      class="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
      data-testid="salud-operacional"
    >
      <figcaption class="mb-3">
        <h3 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">
          {{ t().healthCardTitle }}
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ t().healthCardSub }}</p>
      </figcaption>

      <div class="flex items-center gap-5">
        <!-- Anillo del índice. El color sale del estado que calcula el backend. -->
        <svg
          viewBox="0 0 140 140"
          class="h-32 w-32 shrink-0"
          role="img"
          [attr.aria-label]="t().healthCardTitle + ': ' + etiquetaEstado()"
          data-testid="anillo-salud"
        >
          <circle
            cx="70" cy="70" [attr.r]="RADIO"
            fill="none" stroke-width="14"
            class="stroke-gray-200 dark:stroke-gray-700"
          />
          <circle
            cx="70" cy="70" [attr.r]="RADIO"
            fill="none" stroke-width="14" stroke-linecap="round"
            [attr.stroke]="color()"
            [attr.stroke-dasharray]="arco()"
            transform="rotate(-90 70 70)"
            data-testid="arco-salud"
          />
          <text
            x="70" y="68" text-anchor="middle" font-size="26" font-weight="800"
            [attr.fill]="color()"
            data-testid="indice-salud"
          >{{ textoIndice() }}</text>
          <text
            x="70" y="88" text-anchor="middle" font-size="11" font-weight="600"
            class="fill-gray-500 dark:fill-gray-400"
            data-testid="estado-salud"
          >{{ etiquetaEstado() }}</text>
        </svg>

        <!-- Desglose: por qué ese color. -->
        <ul class="flex min-w-0 flex-1 flex-col gap-2" data-testid="componentes-salud">
          @for (c of componentes(); track c.clave) {
            <li class="flex items-center justify-between gap-3 text-xs">
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="inline-block h-2 w-2 shrink-0 rounded-full"
                  [style.background]="c.color"
                ></span>
                <span class="truncate text-gray-600 dark:text-gray-300">{{ c.etiqueta }}</span>
              </span>
              <span class="shrink-0 font-semibold tabular-nums text-gray-800 dark:text-gray-100">
                {{ c.valor }}
              </span>
            </li>
          }
        </ul>
      </div>

      @if (insuficiente()) {
        <p
          class="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700
                 dark:bg-amber-950 dark:text-amber-300"
          data-testid="salud-aviso"
        >{{ t().healthInsufficient }}</p>
      }

      <!-- Tendencia de backlog, compacta. Conserva el dato del gráfico que reemplazó. -->
      @if (puntos().length > 0) {
        <div class="mt-3">
          <div class="mb-1 flex items-center justify-between">
            <p class="text-[11px] uppercase text-gray-500 dark:text-gray-400">
              {{ t().healthTrendTitle }}
            </p>
            <div class="flex gap-3 text-[11px] text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1">
                <span class="inline-block h-2 w-2 rounded-sm" [style.background]="COLOR_ABIERTAS"></span>
                {{ t().abiertas }}
              </span>
              <span class="flex items-center gap-1">
                <span class="inline-block h-2 w-2 rounded-sm" [style.background]="COLOR_CERRADAS"></span>
                {{ t().cerradas }}
              </span>
            </div>
          </div>
          <svg
            [attr.viewBox]="'0 0 ' + ANCHO_MINI + ' ' + ALTO_MINI"
            class="h-14 w-full"
            role="img"
            [attr.aria-label]="t().healthTrendTitle"
            data-testid="tendencia-salud"
          >
            <polyline
              [attr.points]="lineaAbiertas()"
              fill="none" [attr.stroke]="COLOR_ABIERTAS" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"
            />
            <polyline
              [attr.points]="lineaCerradas()"
              fill="none" [attr.stroke]="COLOR_CERRADAS" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"
            />
          </svg>
        </div>
      }
    </figure>
  `
})
export class SaludOperacionalComponent {
  private i18n = inject(I18nService);

  /** Semáforo compuesto que calcula el backend (CGBIDA-438). */
  readonly salud = input.required<SaludOperacionalData | null>();

  /** Tendencia de 14 días, para el minigráfico del pie. */
  readonly tendencia = input<TrendData[]>([]);

  protected readonly t = computed(() => this.i18n.tree().financial);

  // Geometría del anillo: r=54 con trazo de 14 deja un diámetro útil de 140.
  protected readonly RADIO = 54;
  private readonly CIRCUNFERENCIA = 2 * Math.PI * this.RADIO;

  protected readonly ANCHO_MINI = 600;
  protected readonly ALTO_MINI = 56;
  protected readonly COLOR_ABIERTAS = '#d97706';
  protected readonly COLOR_CERRADAS = '#059669';

  protected readonly puntos = computed(() => this.tendencia());

  private readonly estado = computed<EstadoSalud>(() => this.salud()?.estado ?? 'insuficiente');

  protected readonly insuficiente = computed(() => this.estado() === 'insuficiente');

  protected readonly color = computed(() => COLOR_POR_ESTADO[this.estado()]);

  protected readonly etiquetaEstado = computed(() => {
    const t = this.t();
    switch (this.estado()) {
      case 'verde':
        return t.healthEstadoVerde;
      case 'amarillo':
        return t.healthEstadoAmarillo;
      case 'rojo':
        return t.healthEstadoRojo;
      default:
        return t.healthEstadoInsuficiente;
    }
  });

  /** Texto del centro: el índice, o un guion cuando no se puede calcular. */
  protected readonly textoIndice = computed(() => {
    const i = this.salud()?.indice;
    return i === null || i === undefined ? '—' : `${i.toFixed(1)}%`;
  });

  /** Trazo del anillo. Sin índice se dibuja vacío, no al 100%. */
  protected readonly arco = computed(() => {
    const i = this.salud()?.indice ?? 0;
    const avance = (Math.max(0, Math.min(100, i)) / 100) * this.CIRCUNFERENCIA;
    return `${avance.toFixed(1)} ${this.CIRCUNFERENCIA.toFixed(1)}`;
  });

  protected readonly componentes = computed(() => {
    const c = this.salud()?.componentes;
    const t = this.t();
    return [
      {
        clave: 'sla',
        etiqueta: t.healthComponentSla,
        valor: formatear(c?.sla, (v) => `${v}%`),
        color: colorDe(c?.sla),
      },
      {
        clave: 'mtbf',
        etiqueta: t.healthComponentMtbf,
        valor: formatear(c?.mtbf, (v) => `${v} h`),
        color: colorDe(c?.mtbf),
      },
      {
        clave: 'backlog',
        etiqueta: t.healthComponentBacklog,
        valor: formatear(c?.backlog, (v) => `${v} ${t.healthWeeks}`),
        color: colorDe(c?.backlog),
      },
    ];
  });

  protected readonly lineaAbiertas = computed(() =>
    this.linea((p) => p.abiertas)
  );

  protected readonly lineaCerradas = computed(() =>
    this.linea((p) => p.cerradas)
  );

  /** Convierte una serie en puntos de la polilínea, normalizando al máximo de ambas. */
  private linea(selector: (p: TrendData) => number): string {
    const pts = this.puntos();
    if (pts.length === 0) return '';
    const maximo = Math.max(1, ...pts.map((p) => Math.max(p.abiertas, p.cerradas)));
    const paso = pts.length > 1 ? this.ANCHO_MINI / (pts.length - 1) : 0;
    return pts
      .map((p, i) => {
        const x = i * paso;
        const y = this.ALTO_MINI - (selector(p) / maximo) * (this.ALTO_MINI - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
}

function colorDe(componente: ComponenteSalud | undefined): string {
  if (!componente) return '#9ca3af';
  return COLOR_POR_ESTADO[componente.estado];
}

function formatear(
  componente: ComponenteSalud | undefined,
  formato: (valor: number) => string
): string {
  if (!componente || componente.valor === null || componente.valor === undefined) return '—';
  return formato(componente.valor);
}

const COLOR_POR_ESTADO: Record<EstadoSalud, string> = {
  verde: '#059669',
  amarillo: '#d97706',
  rojo: '#c0281e',
  insuficiente: '#9ca3af',
};

