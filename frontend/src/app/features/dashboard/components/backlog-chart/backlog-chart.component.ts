import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrendData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';

/**
 * Gráfico de backlog de 14 días (HU-16 / CGBIDA-393).
 *
 * Réplica visual del `AreaChart` del legacy (`FinancialDashboard.jsx:155-176`): dos áreas
 * superpuestas con interpolación monotone, ámbar para las OTs abiertas y verde para las
 * cerradas, con relleno en gradiente.
 *
 * SVG a mano, sin dependencias (decisión (a) de CGBIDA-391).
 *
 * DIFERENCIAS DELIBERADAS CON EL LEGACY:
 *  - Los datos vienen del endpoint nuevo, que acota por la empresa del usuario. El legacy
 *    sumaba todas las empresas: es una fuga de datos, no un comportamiento a replicar.
 *  - Los nombres de las series en el tooltip salen de i18n. El legacy mostraba las claves
 *    crudas del `dataKey` (`abiertas`, `cerradas`).
 *  - La serie tiene un tope de 14 puntos por diseño del backend: este gráfico NO responde
 *    al selector de rango temporal (ver CGBIDA-391, decisión (c)).
 */
@Component({
  selector: 'app-backlog-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (puntos().length > 0) {
      <figure
        class="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
        data-testid="backlog-chart"
      >
        <figcaption class="mb-4">
          <h3 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">{{ t().healthTitle }}</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t().healthSub }}</p>
        </figcaption>

        <!-- Leyenda: el legacy no la tenía y se apoyaba solo en el color. Se agrega para
             que la serie sea identificable sin depender del contraste. -->
        <div class="mb-2 flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-300">
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-2.5 w-2.5 rounded-sm" [style.background]="COLOR_ABIERTAS"></span>
            {{ t().abiertas }}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-2.5 w-2.5 rounded-sm" [style.background]="COLOR_CERRADAS"></span>
            {{ t().cerradas }}
          </span>
        </div>

        <svg
          [attr.viewBox]="'0 0 ' + ANCHO + ' ' + ALTO"
          class="w-full"
          role="img"
          [attr.aria-label]="t().healthTitle"
          (mousemove)="mover($event)"
          (mouseleave)="salir()"
        >
          <defs>
            <linearGradient id="backlog-abiertas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" [attr.stop-color]="COLOR_ABIERTAS" stop-opacity="0.3" />
              <stop offset="95%" [attr.stop-color]="COLOR_ABIERTAS" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="backlog-cerradas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" [attr.stop-color]="COLOR_CERRADAS" stop-opacity="0.3" />
              <stop offset="95%" [attr.stop-color]="COLOR_CERRADAS" stop-opacity="0" />
            </linearGradient>
          </defs>

          <!-- Cuadrícula: solo horizontal, como el CartesianGrid vertical={false} -->
          @for (marca of marcasY(); track marca.valor) {
            <line
              [attr.x1]="PAD_IZQ" [attr.y1]="marca.y"
              [attr.x2]="ANCHO - PAD_DER" [attr.y2]="marca.y"
              class="stroke-gray-200 dark:stroke-gray-700"
              stroke-dasharray="3 3"
            />
            <text
              [attr.x]="PAD_IZQ - 6" [attr.y]="marca.y + 3"
              text-anchor="end" font-size="11"
              class="fill-gray-500 dark:fill-gray-400"
            >{{ marca.valor }}</text>
          }

          <!-- Áreas -->
          <path [attr.d]="areaAbiertas()" fill="url(#backlog-abiertas)" />
          <path [attr.d]="areaCerradas()" fill="url(#backlog-cerradas)" />

          <!-- Líneas: sin marcadores en los vértices, como el legacy (no define dot) -->
          <path
            [attr.d]="lineaAbiertas()" fill="none"
            [attr.stroke]="COLOR_ABIERTAS" stroke-width="2"
            data-testid="linea-abiertas"
          />
          <path
            [attr.d]="lineaCerradas()" fill="none"
            [attr.stroke]="COLOR_CERRADAS" stroke-width="2"
            data-testid="linea-cerradas"
          />

          <!-- Etiquetas del eje X: MM-DD, sin año (tickFormatter del legacy) -->
          @for (p of puntos(); track p.date; let i = $index) {
            <text
              [attr.x]="xDe(i)" [attr.y]="ALTO - 12"
              text-anchor="middle" font-size="10"
              class="fill-gray-500 dark:fill-gray-400"
            >{{ p.date.slice(5) }}</text>
          }

          <!-- Zonas de hover: una banda por punto, para el tooltip -->
          @for (p of puntos(); track p.date; let i = $index) {
            <rect
              [attr.x]="xDe(i) - anchoBanda() / 2" y="0"
              [attr.width]="anchoBanda()" [attr.height]="ALTO - PAD_ABAJO"
              fill="transparent"
              [attr.data-testid]="'banda-' + i"
              (mouseenter)="entrar(i, $event)"
            />
          }
        </svg>

        <!--
          Tooltip flotante: sigue al cursor dentro de la tarjeta. Se invierte en el
          cuadrante derecho/inferior para no cortarse contra el borde.
        -->
        @if (puntoActivo(); as p) {
          @if (puntero(); as q) {
            <div
              class="pointer-events-none absolute z-50 rounded-lg border border-gray-200 bg-white
                     px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
              [style.left.px]="q.x + (q.derecha ? -14 : 14)"
              [style.top.px]="q.y + (q.abajo ? -14 : 14)"
              [class.-translate-x-full]="q.derecha"
              [class.-translate-y-full]="q.abajo"
              data-testid="backlog-tooltip"
            >
              <p class="mb-1 font-semibold text-gray-800 dark:text-gray-100">{{ p.date }}</p>
              <p class="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <span class="inline-block h-2 w-2 rounded-full" [style.background]="COLOR_ABIERTAS"></span>
                {{ t().abiertas }}: <strong>{{ p.abiertas }}</strong>
              </p>
              <p class="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <span class="inline-block h-2 w-2 rounded-full" [style.background]="COLOR_CERRADAS"></span>
                {{ t().cerradas }}: <strong>{{ p.cerradas }}</strong>
              </p>
            </div>
          }
        }
      </figure>
    }
  `
})
export class BacklogChartComponent {
  private i18n = inject(I18nService);
  private host = inject(ElementRef<HTMLElement>);

  /** Tendencia de 14 días. La provee el dashboard desde `trend14Days`. */
  readonly puntos = input.required<TrendData[]>();

  /** Índice del punto bajo el cursor, o `null`. */
  protected readonly indiceActivo = signal<number | null>(null);

  /** Cursor relativo a la tarjeta y cuadrante, para ubicar el tooltip. */
  protected readonly puntero = signal<
    { x: number; y: number; derecha: boolean; abajo: boolean } | null
  >(null);

  protected entrar(indice: number, evento: MouseEvent): void {
    this.indiceActivo.set(indice);
    this.mover(evento);
  }

  protected mover(evento: MouseEvent): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    const x = evento.clientX - r.left;
    const y = evento.clientY - r.top;
    this.puntero.set({ x, y, derecha: x > r.width / 2, abajo: y > r.height / 2 });
  }

  protected salir(): void {
    this.indiceActivo.set(null);
    this.puntero.set(null);
  }

  /** Punto bajo el cursor, ya resuelto. `null` si no hay ninguno. */
  protected readonly puntoActivo = computed<TrendData | null>(() => {
    const i = this.indiceActivo();
    return i === null ? null : (this.puntos()[i] ?? null);
  });

  protected readonly t = computed(() => this.i18n.tree().financial);

  // Paleta del legacy (index.css:19-20): --amber y --green resueltos a hex.
  protected readonly COLOR_ABIERTAS = '#d97706';
  protected readonly COLOR_CERRADAS = '#059669';

  // Geometría del viewBox. Las proporciones siguen al legacy: 220 px de alto útil.
  protected readonly ANCHO = 720;
  protected readonly ALTO = 240;
  protected readonly PAD_IZQ = 42;
  protected readonly PAD_DER = 16;
  protected readonly PAD_SUP = 16;
  protected readonly PAD_ABAJO = 34;

  private readonly anchoUtil = this.ANCHO - this.PAD_IZQ - this.PAD_DER;
  private readonly altoUtil = this.ALTO - this.PAD_SUP - this.PAD_ABAJO;

  /** Máximo del eje Y. `allowDecimals={false}` del legacy: enteros y al menos 1. */
  protected readonly maxY = computed(() => {
    const valores = this.puntos().flatMap((p) => [p.abiertas, p.cerradas]);
    return Math.max(1, ...valores);
  });

  protected readonly marcasY = computed(() => {
    const max = this.maxY();
    const pasos = Math.min(max, 4);
    return Array.from({ length: pasos + 1 }, (_, k) => {
      const valor = (max * k) / pasos;
      return { valor: Math.round(valor), y: this.yDe(valor) };
    });
  });

  protected readonly lineaAbiertas = computed(() => this.pathDe('abiertas'));
  protected readonly lineaCerradas = computed(() => this.pathDe('cerradas'));
  protected readonly areaAbiertas = computed(() => this.areaDe('abiertas'));
  protected readonly areaCerradas = computed(() => this.areaDe('cerradas'));

  /** Ancho de cada banda de hover. */
  protected readonly anchoBanda = computed(() => {
    const n = this.puntos().length;
    return n > 1 ? this.anchoUtil / (n - 1) : this.anchoUtil;
  });

  protected xDe(i: number): number {
    const n = this.puntos().length;
    if (n <= 1) return this.PAD_IZQ + this.anchoUtil / 2;
    return this.PAD_IZQ + (this.anchoUtil * i) / (n - 1);
  }

  protected yDe(valor: number): number {
    return this.PAD_SUP + this.altoUtil - (this.altoUtil * valor) / this.maxY();
  }

  private puntosDe(clave: 'abiertas' | 'cerradas'): { x: number; y: number }[] {
    return this.puntos().map((p, i) => ({ x: this.xDe(i), y: this.yDe(p[clave]) }));
  }

  /**
   * Curva monotone, el mismo `type="monotone"` del legacy.
   *
   * Se implementa la interpolación cúbica monótona (Fritsch-Carlson), que es la que usa
   * d3-shape: las tangentes se limitan para que la curva no sobrepase los valores. Con
   * líneas rectas el gráfico sería otro tipo, y eso queda como deuda para una HU futura.
   */
  private pathDe(clave: 'abiertas' | 'cerradas'): string {
    const ps = this.puntosDe(clave);
    const n = ps.length;
    if (n === 0) return '';
    if (n === 1) return `M ${ps[0].x.toFixed(1)},${ps[0].y.toFixed(1)}`;

    const dx = ps.slice(1).map((p, i) => p.x - ps[i].x);
    const m = ps.slice(1).map((p, i) => (dx[i] ? (p.y - ps[i].y) / dx[i] : 0));

    const t: number[] = new Array(n).fill(0);
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
      t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    }

    let d = `M ${ps[0].x.toFixed(1)},${ps[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const c1x = ps[i].x + dx[i] / 3;
      const c1y = ps[i].y + (t[i] * dx[i]) / 3;
      const c2x = ps[i + 1].x - dx[i] / 3;
      const c2y = ps[i + 1].y - (t[i + 1] * dx[i]) / 3;
      d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ` +
           `${ps[i + 1].x.toFixed(1)},${ps[i + 1].y.toFixed(1)}`;
    }
    return d;
  }

  /** Área cerrada hasta la base del gráfico, para el relleno en gradiente. */
  private areaDe(clave: 'abiertas' | 'cerradas'): string {
    const ps = this.puntosDe(clave);
    if (ps.length === 0) return '';
    const base = this.PAD_SUP + this.altoUtil;
    const ultimo = ps[ps.length - 1];
    return `${this.pathDe(clave)} L ${ultimo.x.toFixed(1)},${base} L ${ps[0].x.toFixed(1)},${base} Z`;
  }
}
