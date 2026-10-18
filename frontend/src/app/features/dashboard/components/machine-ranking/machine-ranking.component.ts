import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
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
        class="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
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

        <!--
          max-w-[520px]: el viewBox es 420x240, así que con w-full en una columna de ~760
          px el gráfico se escalaba a ~434 px de alto. Acotado a 520 px queda en ~297 px,
          cerca de los 240 del legacy, y se centra en la tarjeta.
        -->
        <svg
          [attr.viewBox]="'0 0 ' + ANCHO + ' ' + ALTO"
          class="mx-auto w-full max-w-[480px]"
          role="img"
          [attr.aria-label]="t().topMachinesTitle"
          (mousemove)="mover($event)"
          (mouseleave)="salir()"
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
              (mouseenter)="entrar($index, $event)"
            />
          }
        </svg>

        <!--
          Tooltip flotante con los datos COMPLETOS del equipo, no solo la metrica activa:
          asi el usuario no tiene que cambiar el selector para ver el resto. Se invierte en
          el cuadrante derecho/inferior para no cortarse contra el borde de la tarjeta.
        -->
        @if (seleccionada(); as m) {
          @if (puntero(); as p) {
            <div
              class="pointer-events-none absolute z-50 w-56 rounded-lg border border-gray-200 bg-white
                     px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
              [style.left.px]="p.x + (p.derecha ? -14 : 14)"
              [style.top.px]="p.y + (p.abajo ? -14 : 14)"
              [class.-translate-x-full]="p.derecha"
              [class.-translate-y-full]="p.abajo"
              data-testid="ranking-tooltip"
            >
              <p class="mb-1.5 flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
                <span class="inline-block h-2 w-2 shrink-0 rounded-full" [style.background]="m.color"></span>
                <span data-testid="ranking-tooltip-nombre">{{ m.name }}</span>
              </p>

              <dl class="flex flex-col gap-0.5 text-gray-600 dark:text-gray-300">
                <div class="flex justify-between gap-3">
                  <dt>{{ t().rankingMetricOts }}</dt>
                  <dd class="font-medium tabular-nums text-gray-800 dark:text-gray-100">{{ m.ots }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt>{{ t().rankingMetricMttr }}</dt>
                  <dd class="font-medium tabular-nums text-gray-800 dark:text-gray-100">{{ m.mttr }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt>{{ t().rankingMetricAhorro }}</dt>
                  <dd class="font-medium tabular-nums text-gray-800 dark:text-gray-100">{{ m.ahorro }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt>{{ t().efficiency }}</dt>
                  <dd class="font-medium tabular-nums text-gray-800 dark:text-gray-100">{{ m.sla }}</dd>
                </div>
              </dl>
            </div>
          }
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
  private host = inject(ElementRef<HTMLElement>);

  /** Equipos del endpoint. Ya vienen limitados a 5 por el backend. */
  readonly maquinas = input.required<MachineData[]>();

  /** Métrica activa. Por defecto `ots`, como el legacy (`FinancialDashboard.jsx:63`). */
  protected readonly metrica = signal<MetricaRanking>('ots');

  /** Índice del equipo bajo el cursor, o `null`. */
  protected readonly indiceActivo = signal<number | null>(null);

  /** Cursor relativo a la tarjeta y cuadrante, para ubicar el tooltip flotante. */
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
        // Datos completos para el tooltip. NO dependen de la metrica elegida: asi el
        // usuario ve todo el perfil del equipo sin tocar el selector.
        ots: MIL.format(m.total),
        mttr: `${MIL.format(Math.round(m.mttr))} min`,
        ahorro: this.moneda(m.ahorroGenerado),
        sla: `${m.slaCompliance} %`,
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
    if (this.metrica() === 'ahorro') return this.moneda(valor);
    if (this.metrica() === 'mttr') return `${MIL.format(Math.round(valor))} min`;
    return MIL.format(valor);
  }

  /** Moneda CLP, con el mismo formato que las tarjetas de KPI (CGBIDA-392). */
  private moneda(valor: number): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(valor);
  }
}
