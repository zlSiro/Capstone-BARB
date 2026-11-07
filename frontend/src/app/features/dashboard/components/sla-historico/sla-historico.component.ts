import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsService } from '../../../../core/services/stats.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { PeriodoHistorico } from '../../../../core/models';

/** Opciones del selector de ventana histórica (CGBIDA-515). */
export type RangoHistorico = 'semestre' | 'anio' | 'tres' | 'cinco';

/** Granularidad y ventana que pide cada opción. */
interface ConfigRango {
  granularity: 'month' | 'semester' | 'year';
  days: number;
}

/**
 * Mapa opción -> (granularidad, días). El backend no tiene una unidad "semestre":
 * para el último año se piden semestres (2 puntos) y para 3/5 años, años.
 */
const CONFIG: Record<RangoHistorico, ConfigRango> = {
  semestre: { granularity: 'month', days: 180 },
  anio: { granularity: 'semester', days: 365 },
  tres: { granularity: 'year', days: 1095 },
  cinco: { granularity: 'year', days: 1825 },
};

/** Un punto ya proyectado a coordenadas SVG. */
interface Punto {
  x: number;
  y: number;
  etiqueta: string;
  valor: number;
}

/**
 * Gráfico de líneas del SLA histórico (CGBIDA-515).
 *
 * SVG dibujado a mano, sin librerías: el proyecto ya resolvió así el backlog y la dona,
 * y sumar una dependencia de charts por una línea de 24 puntos no se justifica.
 *
 * - El componente **pide sus propios datos** con `granularity` + `days`, así que no
 *   depende de la respuesta de `financial-impact` ni de cuándo se cargó el dashboard.
 * - El selector cambia la ventana y vuelve a pedir: 6 meses, 1 año, 3 años o 5 años.
 * - Los colores salen de tokens (`stroke-accion`, `fill-tinta-suave`), por lo que el
 *   modo oscuro funciona sin código extra.
 */
@Component({
  selector: 'app-sla-historico',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure
      class="flex h-full flex-col rounded-control border border-borde bg-superficie p-5 "
      data-testid="sla-historico"
    >
      <figcaption class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-extrabold text-tinta ">{{ t().historyTitle }}</h2>
          <p class="text-sm text-tinta-suave ">{{ t().historySub }}</p>
        </div>

        <!-- Selector de ventana: botones y no un select, son cuatro opciones fijas. -->
        <div
          class="flex flex-wrap items-center gap-1 rounded-control border border-borde-control p-0.5"
          role="group"
          [attr.aria-label]="t().historyTitle"
          data-testid="selector-historico"
        >
          @for (r of rangos; track r) {
            <button
              type="button"
              [attr.aria-pressed]="rango() === r"
              [attr.data-testid]="'rango-hist-' + r"
              (click)="cambiarRango(r)"
              [class]="rango() === r ? claseActiva : claseInactiva"
            >{{ etiquetaRango(r) }}</button>
          }
        </div>
      </figcaption>

      @if (cargando()) {
        <p class="py-10 text-center text-sm text-tinta-suave " data-testid="hist-cargando">
          {{ t().historyLoading }}
        </p>
      } @else if (error()) {
        <p class="py-10 text-center text-sm text-peligro " data-testid="hist-error">
          {{ t().historyError }}
        </p>
      } @else if (puntos().length < 2) {
        <p class="py-10 text-center text-sm text-tinta-suave " data-testid="hist-vacio">
          {{ t().historyEmpty }}
        </p>
      } @else {
        <svg
          [attr.viewBox]="'0 0 ' + ANCHO + ' ' + ALTO"
          class="h-[240px] w-full"
          role="img"
          [attr.aria-label]="t().historySvgLabel"
          data-testid="hist-svg"
        >
          <!-- Guias horizontales de 0 a 100 %. -->
          @for (g of guias(); track g.valor) {
            <line
              [attr.x1]="PAD_IZQ"
              [attr.x2]="ANCHO - PAD_DER"
              [attr.y1]="g.y"
              [attr.y2]="g.y"
              class="stroke-borde "
              stroke-width="1"
            />
            <text
              [attr.x]="PAD_IZQ - 6"
              [attr.y]="g.y + 4"
              text-anchor="end"
              font-size="10"
              class="fill-tinta-suave "
            >{{ g.valor }}</text>
          }

          <!-- Serie del SLA. -->
          <polyline
            [attr.points]="linea()"
            fill="none"
            class="stroke-accion "
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            data-testid="hist-linea"
          />

          @for (p of puntos(); track p.etiqueta) {
            <circle
              [attr.cx]="p.x"
              [attr.cy]="p.y"
              r="3.5"
              class="fill-accion "
              data-testid="hist-punto"
            >
              <title>{{ p.etiqueta }}: {{ p.valor }}%</title>
            </circle>
            @if (mostrarEtiqueta($index)) {
              <text
                [attr.x]="p.x"
                [attr.y]="ALTO - 6"
                text-anchor="middle"
                font-size="10"
                class="fill-tinta-suave "
              >{{ p.etiqueta }}</text>
            }
          }
        </svg>
      }
    </figure>
  `,
})
export class SlaHistoricoComponent {
  private stats = inject(StatsService);
  private i18n = inject(I18nService);

  protected readonly t = computed(() => this.i18n.tree().financial);

  // Lienzo del SVG. El viewBox es fijo y el SVG escala con `w-full`: así el trazo no
  // engorda en pantallas grandes.
  protected readonly ANCHO = 720;
  protected readonly ALTO = 240;
  protected readonly PAD_IZQ = 34;
  protected readonly PAD_DER = 12;
  protected readonly PAD_SUP = 12;
  protected readonly PAD_INF = 26;

  protected readonly rangos: readonly RangoHistorico[] = ['semestre', 'anio', 'tres', 'cinco'];

  protected readonly rango = signal<RangoHistorico>('semestre');
  protected readonly periodos = signal<PeriodoHistorico[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal(false);

  /** Clases del botón activo/inactivo (se guardan completas para Tailwind). */
  protected readonly claseActiva =
    'rounded-control px-2 py-1 text-sm font-semibold bg-accion text-sobre-accion';
  protected readonly claseInactiva =
    'rounded-control px-2 py-1 text-sm font-medium text-tinta-suave ';

  constructor() {
    this.cargar();
  }

  /** Etiqueta del botón según el idioma activo. */
  protected etiquetaRango(r: RangoHistorico): string {
    const t = this.t();
    switch (r) {
      case 'anio':
        return t.historyYear;
      case 'tres':
        return t.historyThree;
      case 'cinco':
        return t.historyFive;
      default:
        return t.historySemester;
    }
  }

  /** Cambia la ventana y vuelve a pedir la serie. */
  protected cambiarRango(r: RangoHistorico): void {
    if (r === this.rango()) return;
    this.rango.set(r);
    this.cargar();
  }

  /**
   * Piso del eje Y (CGBIDA-515).
   *
   * Con el eje fijo en 0-100 y datos entre 83 y 96 la línea se veía plana y no comunicaba
   * nada. El piso se calcula desde el dato más bajo: se deja un margen de 5 puntos y se
   * redondea a múltiplos de 5, con dos topes:
   *   - nunca baja de 0 (no tiene sentido un eje negativo), y
   *   - nunca sube de 90, para que el eje siempre abarque al menos 10 puntos y un
   *     99-100 no se dibuje como una catástrofe. El techo queda siempre en 100.
   */
  protected readonly piso = computed(() => {
    const valores = this.periodos().map((p) => p.sla);
    if (valores.length === 0) return 0;
    const minimo = Math.min(...valores);
    return Math.min(90, Math.max(0, Math.floor((minimo - 5) / 5) * 5));
  });

  /** Guías horizontales del eje Y, desde el piso hasta el 100 %, en pasos redondos. */
  protected readonly guias = computed(() => {
    const piso = this.piso();
    const rango = 100 - piso;
    // Paso en 5, 10 o 25 según el rango: nunca más de 6 líneas ni números quebrados.
    const paso = rango <= 25 ? 5 : rango <= 50 ? 10 : 25;
    const valores: number[] = [];
    for (let v = piso; v <= 100; v += paso) valores.push(v);
    if (valores[valores.length - 1] !== 100) valores.push(100);
    return valores.map((valor) => ({ valor, y: this.yDe(valor) }));
  });

  /** Puntos proyectados a coordenadas del SVG. */
  protected readonly puntos = computed<Punto[]>(() => {
    const ps = this.periodos();
    const n = ps.length;
    if (n === 0) return [];
    const anchoUtil = this.ANCHO - this.PAD_IZQ - this.PAD_DER;
    return ps.map((p, i) => ({
      x: this.PAD_IZQ + (n === 1 ? anchoUtil / 2 : (i / (n - 1)) * anchoUtil),
      y: this.yDe(p.sla),
      etiqueta: p.etiqueta,
      valor: p.sla,
    }));
  });

  /** Cadena de `points` para la polilínea. */
  protected readonly linea = computed(() =>
    this.puntos()
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ')
  );

  /** Se rotulan todas si son pocas; si no, se saltean para que no se pisen. */
  protected mostrarEtiqueta(i: number): boolean {
    const n = this.puntos().length;
    if (n <= 8) return true;
    const paso = Math.ceil(n / 8);
    return i % paso === 0 || i === n - 1;
  }

  /** SLA (entre el piso y 100) -> coordenada Y invertida del lienzo. */
  private yDe(sla: number): number {
    const piso = this.piso();
    const altoUtil = this.ALTO - this.PAD_SUP - this.PAD_INF;
    const acotado = Math.max(piso, Math.min(100, sla));
    const rango = 100 - piso;
    const fraccion = rango === 0 ? 1 : (acotado - piso) / rango;
    return this.ALTO - this.PAD_INF - fraccion * altoUtil;
  }

  private cargar(): void {
    const { granularity, days } = CONFIG[this.rango()];
    this.cargando.set(true);
    this.error.set(false);
    this.stats.getHistorical(granularity, days).subscribe({
      next: (r) => {
        this.periodos.set(r.periods ?? []);
        this.cargando.set(false);
      },
      error: () => {
        // Sin datos no se dibuja una línea plana: se dice que no se pudo.
        this.periodos.set([]);
        this.error.set(true);
        this.cargando.set(false);
      },
    });
  }
}
