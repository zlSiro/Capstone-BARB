import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponenteSalud, EstadoSalud, SaludOperacionalData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { MtbfUnitService } from '../../../../core/services/mtbf-unit.service';

/**
 * Tarjeta de Salud Operacional (CGBIDA-435).
 *
 * Es la pieza que Samuel pidió: un indicador fuerte, no un gráfico de líneas más.
 *
 * - **El anillo** muestra el índice 0-100 y se pinta con el color del estado. El número
 *   grande es lo primero que se lee.
 * - **Los tres componentes** (SLA, MTBF, backlog) van debajo del anillo: son la respuesta
 *   a "¿por qué este color?". Un semáforo sin desglose es otra caja negra.
 *
 * La tendencia de backlog que vivía al pie se quitó: con 14 puntos y valores de 1 a 4 se
 * veía como un electrocardiograma y no aportaba. El espacio que dejó se usa para agrandar
 * el anillo y centrar la tarjeta.
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
      class="relative flex h-full flex-col justify-center rounded-2xl border border-gray-200
             bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
      data-testid="salud-operacional"
    >
      <figcaption class="mb-1">
        <h3 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">
          {{ t().healthCardTitle }}
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ t().healthCardSub }}</p>
      </figcaption>

      <!--
        Anillo de 180 px con trazo de 16: el tamano lo vuelve el heroe de la tarjeta, y
        el trazo fino deja 64 px de radio libre para el texto del centro.
      -->
      <div class="flex justify-center">
        <svg
          [attr.viewBox]="'0 0 ' + LADO + ' ' + LADO"
          class="h-[180px] w-[180px]"
          role="img"
          [attr.aria-label]="t().healthCardTitle + ': ' + etiquetaEstado()"
          data-testid="anillo-salud"
        >
          <circle
            [attr.cx]="CENTRO" [attr.cy]="CENTRO" [attr.r]="RADIO"
            fill="none" [attr.stroke-width]="TRAZO"
            class="stroke-gray-200 dark:stroke-gray-700"
          />
          <circle
            [attr.cx]="CENTRO" [attr.cy]="CENTRO" [attr.r]="RADIO"
            fill="none" [attr.stroke-width]="TRAZO" stroke-linecap="round"
            [attr.stroke]="color()"
            [attr.stroke-dasharray]="arco()"
            [attr.transform]="'rotate(-90 ' + CENTRO + ' ' + CENTRO + ')'"
            data-testid="arco-salud"
          />
          <!--
            El texto va mas chico y mas separado del trazo. Antes era 38 px dentro de un
            radio libre de 53: "92.9%" lo tocaba y se veia apretado. Con 30 px y 64 px de
            radio libre quedan ~10 px de aire a cada lado, suficiente incluso para "100.0%".
          -->
          <text
            [attr.x]="CENTRO" [attr.y]="CENTRO - 2" text-anchor="middle"
            font-size="30" font-weight="800"
            [attr.fill]="color()"
            data-testid="indice-salud"
          >{{ textoIndice() }}</text>
          <text
            [attr.x]="CENTRO" [attr.y]="CENTRO + 24" text-anchor="middle"
            font-size="12" font-weight="600"
            class="fill-gray-500 dark:fill-gray-400"
            data-testid="estado-salud"
          >{{ etiquetaEstado() }}</text>
        </svg>
      </div>

      <!-- Desglose: por qué ese color. Tres sub-tarjetas con el estado en palabras. -->
      <ul class="mt-2 grid grid-cols-3 gap-2" data-testid="componentes-salud">
        @for (c of componentes(); track c.clave) {
          <li
            class="rounded-lg border border-gray-100 px-2 py-1.5 text-center
                   dark:border-gray-700"
            [attr.data-testid]="'componente-' + c.clave"
          >
            <p class="flex items-center justify-center gap-1 text-[10px] uppercase text-gray-500 dark:text-gray-400">
              <span
                class="inline-block h-2 w-2 shrink-0 rounded-full"
                [style.background]="c.color"
              ></span>
              {{ c.etiqueta }}
            </p>
            <p class="mt-1 text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">
              {{ c.valor }}
            </p>
            <p class="text-[10px] font-medium" [style.color]="c.color">{{ c.estadoTexto }}</p>
          </li>
        }
      </ul>

      @if (insuficiente()) {
        <p
          class="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700
                 dark:bg-amber-950 dark:text-amber-300"
          data-testid="salud-aviso"
        >{{ t().healthInsufficient }}</p>
      }

    </figure>
  `
})
export class SaludOperacionalComponent {
  private i18n = inject(I18nService);

  /** Unidad del MTBF compartida con la tarjeta de KPI (CGBIDA-435). */
  private mtbf = inject(MtbfUnitService);

  /** Semáforo compuesto que calcula el backend (CGBIDA-438). */
  readonly salud = input.required<SaludOperacionalData | null>();

  protected readonly t = computed(() => this.i18n.tree().financial);

  // Anillo de 180 px: r=72 con trazo de 16 deja 64 px de radio libre para el porcentaje,
  // que es lo que se mira primero. Antes era de 150 con el texto a 38 px y se tocaban.
  protected readonly LADO = 180;
  protected readonly CENTRO = 90;
  protected readonly RADIO = 72;
  protected readonly TRAZO = 16;
  private readonly CIRCUNFERENCIA = 2 * Math.PI * this.RADIO;

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
        estadoTexto: this.etiquetaDeEstado(c?.sla),
        color: colorDe(c?.sla),
      },
      {
        clave: 'mtbf',
        // La unidad la manda el servicio compartido: si el usuario elige días en la
        // tarjeta de KPI, aquí también se ven días. Es el mismo MTBF.
        etiqueta: t.healthComponentMtbf,
        valor: this.mtbf.formatear(c?.mtbf?.valor ?? null, this.sufijoMtbf()),
        estadoTexto: this.etiquetaDeEstado(c?.mtbf),
        color: colorDe(c?.mtbf),
      },
      {
        clave: 'backlog',
        etiqueta: t.healthComponentBacklog,
        valor: formatear(c?.backlog, (v) => `${v} ${t.healthWeeks}`),
        estadoTexto: this.etiquetaDeEstado(c?.backlog),
        color: colorDe(c?.backlog),
      },
    ];
  });

  /** Sufijo corto del MTBF en la unidad activa. */
  private readonly sufijoMtbf = computed(() => {
    const t = this.t();
    switch (this.mtbf.unidad()) {
      case 'horas':
        return t.mtbfUnitShortHoras;
      case 'meses':
        return t.mtbfUnitShortMeses;
      default:
        return t.mtbfUnitShortDias;
    }
  });

  /** Etiqueta del estado de UN componente, en palabras. */
  private etiquetaDeEstado(c: ComponenteSalud | undefined): string {
    const t = this.t();
    switch (c?.estado) {
      case 'verde':
        return t.healthEstadoVerde;
      case 'amarillo':
        return t.healthEstadoAmarillo;
      case 'rojo':
        return t.healthEstadoRojo;
      default:
        return t.healthEstadoInsuficiente;
    }
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





