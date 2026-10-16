import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MachineData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';

/** Métricas que ofrece el selector, en el orden del legacy. */
export type MetricaRanking = 'ots' | 'mttr' | 'ahorro';

/** Campos numéricos de un equipo. Acota `keyof MachineData` a los que se pueden graficar. */
type CampoNumerico = 'total' | 'mttr' | 'ahorroGenerado';

/** Claves del bloque i18n `financial` que etiquetan cada métrica. */
type ClaveEtiqueta = 'rankingMetricOts' | 'rankingMetricMttr' | 'rankingMetricAhorro';

/** Cuántos caracteres entran en el eje Y antes de truncar. */
export const MAX_CARACTERES_NOMBRE = 16;

/**
 * Qué campo, qué etiqueta y cómo se formatea cada métrica.
 *
 * El legacy resolvía esto con un ternario encadenado que caía a `mttr` en cualquier caso
 * no previsto (`FinancialDashboard.jsx:207`). Acá es un mapa explícito con los 3 casos:
 * no hay rama muerta.
 */
const METRICAS: Record<MetricaRanking, { campo: CampoNumerico; etiqueta: ClaveEtiqueta }> = {
  ots: { campo: 'total', etiqueta: 'rankingMetricOts' },
  mttr: { campo: 'mttr', etiqueta: 'rankingMetricMttr' },
  ahorro: { campo: 'ahorroGenerado', etiqueta: 'rankingMetricAhorro' },
};

/** Paleta del legacy (`FinancialDashboard.jsx:22`), con los hex resueltos. */
const COLORES = ['#2563eb', '#059669', '#d97706', '#6d28d9', '#c0281e', '#0e7490'];

const MIL = new Intl.NumberFormat('es-CL');

/**
 * Ranking de equipos por métrica (HU-16 / CGBIDA-394).
 *
 * Réplica visual del `BarChart layout="vertical"` del legacy
 * (`FinancialDashboard.jsx:196-215`): barras horizontales, una por máquina, color rotativo
 * según la POSICIÓN en el ranking, cuadrícula solo horizontal y eje numérico oculto.
 *
 * SVG a mano, sin dependencias (decisión (a) de CGBIDA-391).
 *
 * DESVÍOS DELIBERADOS DEL LEGACY (aprobados, documentados):
 *  1. Animación: transición CSS de 200 ms en vez de la animación por defecto de Recharts
 *     (~1500 ms). El cambio de métrica debe sentirse inmediato.
 *  2. Tooltip: nombre de la métrica desde i18n y valor formateado. El legacy mostraba la
 *     clave cruda del `dataKey` (`ahorroGenerado`) y el número sin formato (`638000`).
 *  3. Tres métricas con mapa explícito. El fallthrough muerto a `mttr` era un bug.
 *  4. Colores en hex con variantes oscuras. El legacy usaba `var(--cyan)`, token que falta
 *     en `:root` y dejaba la 6.ª barra sin color.
 *  5. Nombre del equipo truncado con elipsis y `title` con el nombre completo. El legacy
 *     desbordaba el eje de 90 px.
 *  6. Cinco equipos. El legacy cortaba en 8 (`slice(0, 8)`); el backend nuevo ya limita a 5.
 *
 * Igual que el resto del dashboard, los datos vienen acotados a la empresa del usuario.
 */
@Component({
  selector: 'app-machine-ranking',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (maquinas().length > 0) {
      <figure
        class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
        data-testid="machine-ranking"
      >
        <figcaption class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">{{ t().topMachinesTitle }}</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t().topMachinesSubtitle }}</p>
          </div>

          <!-- Selector de metrica: replica del filter-select del legacy. -->
          <select
            class="rounded-lg border border-gray-300 bg-white px-3 py-[7px] text-xs text-gray-800
                   outline-none transition-colors focus:border-blue-600
                   dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400"
            data-testid="selector-metrica"
            [value]="metrica()"
            (change)="cambiarMetrica($event)"
          >
            <option value="ots">{{ t().viewOts }}</option>
            <option value="mttr">{{ t().viewMttr }}</option>
            <option value="ahorro">{{ t().viewAhorro }}</option>
          </select>
        </figcaption>

        <svg
          [attr.viewBox]="'0 0 ' + ANCHO + ' ' + ALTO"
          class="w-full"
          role="img"
          [attr.aria-label]="t().topMachinesTitle"
          (mouseleave)="indiceActivo.set(null)"
        >
          <!-- Cuadrícula: solo horizontal (el legacy usa vertical={false}). -->
          @for (g of guias(); track g.x) {
            <line
              [attr.x1]="g.x" [attr.y1]="PAD_SUP"
              [attr.x2]="g.x" [attr.y2]="ALTO - PAD_ABAJO"
              class="stroke-gray-200 dark:stroke-gray-700"
              stroke-dasharray="3 3"
            />
          }

          @for (fila of filas(); track fila.id) {
            <!-- Nombre del equipo: alineado a la derecha contra el eje. -->
            <text
              [attr.x]="PAD_IZQ - 8" [attr.y]="fila.y + 4"
              text-anchor="end" font-size="10"
              class="fill-gray-800 dark:fill-gray-200"
              [attr.data-testid]="'nombre-' + fila.id"
            >
              {{ fila.nombreVisible }}
              @if (fila.truncado) {
                <title>{{ fila.name }}</title>
              }
            </text>

            <!-- Barra horizontal, redondeada solo a la derecha.
                 La transicion de 200 ms es el desvio 1: el legacy anima ~1500 ms. -->
            <rect
              [attr.x]="PAD_IZQ" [attr.y]="fila.y - ALTURA_BARRA / 2"
              [attr.width]="fila.ancho" [attr.height]="ALTURA_BARRA"
              rx="4" ry="4"
              [attr.fill]="fila.color"
              [style.transition]="'width 200ms ease-out'"
              [attr.data-testid]="'barra-' + fila.id"
              [attr.data-ancho]="fila.ancho"
            />

            <!-- Zona de hover para el tooltip. -->
            <rect
              [attr.x]="PAD_IZQ" [attr.y]="fila.y - ALTURA_FILA / 2"
              [attr.width]="ANCHO - PAD_IZQ - PAD_DER" [attr.height]="ALTURA_FILA"
              fill="transparent"
              [attr.data-testid]="'zona-' + fila.id"
              (mouseenter)="indiceActivo.set($index)"
            />
          }
        </svg>

        @if (seleccionada(); as m) {
          <div
            class="mt-2 inline-block rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs
                   shadow-sm dark:border-gray-700 dark:bg-gray-800"
            data-testid="ranking-tooltip"
          >
            <p class="mb-1 flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
              <span class="inline-block h-2 w-2 rounded-full" [style.background]="m.color"></span>
              {{ m.name }}
            </p>
            <p class="text-gray-600 dark:text-gray-300">
              {{ t()[etiquetaMetrica()] }}: <strong>{{ m.valorFormateado }}</strong>
            </p>
          </div>
        }
      </figure>
    } @else {
      <p class="text-sm text-gray-500 dark:text-gray-400" data-testid="ranking-vacio">
        {{ t().rankingEmpty }}
      </p>
    }
  `
})
export class MachineRankingComponent {
  private i18n = inject(I18nService);

  /** Equipos del endpoint. Ya vienen limitados a 5 por el backend. */
  readonly maquinas = input.required<MachineData[]>();

  /** Métrica activa. Por defecto `ots`, como el legacy (`FinancialDashboard.jsx:63`). */
  protected readonly metrica = signal<MetricaRanking>('ots');

  /** Índice del equipo bajo el cursor, o `null`. */
  protected readonly indiceActivo = signal<number | null>(null);

  protected readonly t = computed(() => this.i18n.tree().financial);

  // Geometría del viewBox. Proporciones del legacy: 220 px de alto útil, barra de 16.
  protected readonly ANCHO = 420;
  protected readonly ALTO = 240;
  protected readonly PAD_IZQ = 150; // Espacio para los nombres (el legacy usaba 90 px).
  protected readonly PAD_DER = 16;
  protected readonly PAD_SUP = 18;
  protected readonly PAD_ABAJO = 12;
  protected readonly ALTURA_BARRA = 16;
  protected readonly ALTURA_FILA = 38;

  protected readonly etiquetaMetrica = computed(() => METRICAS[this.metrica()].etiqueta);

  private readonly anchoUtil = this.ANCHO - this.PAD_IZQ - this.PAD_DER;

  /**
   * Equipos ordenados por la métrica activa, descendente.
   *
   * `Array.prototype.sort` es estable desde ES2019, así que los empates conservan el orden
   * que mandó el backend. Es un comportamiento del que dependemos: hay un test que lo fija.
   */
  private readonly ordenadas = computed(() => {
    const campo = METRICAS[this.metrica()].campo;
    return [...this.maquinas()].sort((a, b) => {
      const va = Number(a[campo] ?? 0);
      const vb = Number(b[campo] ?? 0);
      return vb - va;
    });
  });

  /** Máximo de la métrica activa. Piso de 1 para no dividir por cero si todo es 0. */
  private readonly maximo = computed(() => {
    const campo = METRICAS[this.metrica()].campo;
    return Math.max(1, ...this.maquinas().map((m) => Number(m[campo] ?? 0)));
  });

  /** Guías verticales del eje numérico, que en el legacy van ocultas. */
  protected readonly guias = computed(() =>
    [0, 0.5, 1].map((f) => ({ x: this.PAD_IZQ + this.anchoUtil * f }))
  );

  protected readonly filas = computed(() =>
    this.ordenadas().map((m, i) => {
      const campo = METRICAS[this.metrica()].campo;
      const valor = Number(m[campo] ?? 0);
      return {
        id: m.id,
        name: m.name,
        nombreVisible: this.truncar(m.name),
        truncado: this.esTruncado(m.name),
        valor,
        valorFormateado: this.formatear(valor),
        // Color por POSICIÓN en el ranking, no por equipo: si al cambiar de métrica un
        // equipo sube o baja, cambia de color. Es el comportamiento del legacy.
        color: COLORES[i % COLORES.length],
        y: this.yDeFila(i),
        ancho: (this.anchoUtil * valor) / this.maximo(),
      };
    })
  );

  /** Fila del tooltip, ya resuelta. */
  protected readonly seleccionada = computed(() => {
    const i = this.indiceActivo();
    if (i === null) return null;
    return this.filas()[i] ?? null;
  });

  protected cambiarMetrica(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value as MetricaRanking;
    if (valor in METRICAS) {
      this.metrica.set(valor);
      this.indiceActivo.set(null);
    }
  }

  /** Reparte las filas en el alto disponible. */
  private yDeFila(i: number): number {
    const n = this.ordenadas().length;
    const util = this.ALTO - this.PAD_SUP - this.PAD_ABAJO;
    if (n <= 1) return this.PAD_SUP + util / 2;
    return this.PAD_SUP + (util * (i + 0.5)) / n;
  }

  /**
   * Trunca por puntos de código, no por unidades UTF-16.
   *
   * Se usa `Array.from` para que un carácter fuera del BMP (por ejemplo un emoji) cuente
   * como uno. La elipsis es un solo carácter `…`.
   */
  private truncar(nombre: string): string {
    const caracteres = Array.from(nombre);
    if (caracteres.length <= MAX_CARACTERES_NOMBRE) return nombre;
    return caracteres.slice(0, MAX_CARACTERES_NOMBRE).join('') + '…';
  }

  private esTruncado(nombre: string): boolean {
    return Array.from(nombre).length > MAX_CARACTERES_NOMBRE;
  }

  /**
   * Formatea el valor de la métrica activa.
   *
   * El ahorro usa el MISMO formato de moneda que las tarjetas de KPI (CGBIDA-392), para
   * que el dashboard sea coherente consigo mismo.
   */
  private formatear(valor: number): string {
    if (this.metrica() === 'ahorro') {
      return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
      }).format(valor);
    }
    if (this.metrica() === 'mttr') return `${MIL.format(Math.round(valor))} min`;
    return MIL.format(valor);
  }
}
