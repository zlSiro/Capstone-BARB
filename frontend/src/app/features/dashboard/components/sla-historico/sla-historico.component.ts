import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsService } from '../../../../core/services/stats.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { FiltrosDashboard, PeriodoHistorico, SIN_FILTROS } from '../../../../core/models';

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
 * - El componente **pide sus propios datos**, así que no depende de la respuesta de
 *   `financial-impact` ni de cuándo se cargó el dashboard.
 * - La ventana ya no se elige acá: la manda el panel de filtros global (CGBIDA-550) y
 *   el gráfico solo reacciona. Así el gráfico y los KPIs muestran el mismo período.
 * - Los colores salen de tokens (`stroke-accion`, `fill-tinta-suave`), por lo que el
 *   modo oscuro funciona sin código extra.
 */
@Component({
  selector: 'app-sla-historico',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure
      #lienzo
      class="flex h-full flex-col rounded-control border border-borde bg-superficie p-5 "
      data-testid="sla-historico"
    >
      <figcaption class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-extrabold text-tinta ">{{ t().historyTitle }}</h2>
          <p class="text-sm text-tinta-suave ">{{ t().historySub }}</p>
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
          [attr.viewBox]="'0 0 ' + ANCHO() + ' ' + ALTO"
          [attr.height]="ALTO"
          class="w-full"
          role="img"
          [attr.aria-label]="t().historySvgLabel"
          data-testid="hist-svg"
        >
          <!-- Guias horizontales de 0 a 100 %. -->
          @for (g of guias(); track g.valor) {
            <line
              [attr.x1]="PAD_IZQ"
              [attr.x2]="ANCHO() - PAD_DER"
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
  private destroyRef = inject(DestroyRef);


  protected readonly t = computed(() => this.i18n.tree().financial);

  // Lienzo del SVG.
  //
  // El ancho NO es una constante: se mide el contenedor con un ResizeObserver y el
  // viewBox usa ese ancho. Con un viewBox fijo de 720 y `w-full` el dibujo quedaba
  // centrado y sobraban cientos de px en blanco a los lados, que es justo lo que se
  // veia en la tarjeta ancha (CGBIDA-550). Como el viewBox y el ancho del elemento
  // coinciden, la escala es 1:1 y el trazo tampoco engorda.
  private readonly anchoMedido = signal(720);
  protected readonly ANCHO = computed(() => Math.max(320, Math.round(this.anchoMedido())));
  protected readonly ALTO = 220;

  /** Contenedor del SVG, para medirlo. */
  private readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');
  protected readonly PAD_IZQ = 34;
  protected readonly PAD_DER = 12;
  protected readonly PAD_SUP = 12;
  protected readonly PAD_INF = 26;

  /**
   * Filtros de topologia que manda el Dashboard (CGBIDA-550).
   *
   * El componente pide sus propios datos, asi que sin esto el grafico mostraria toda la
   * empresa mientras los KPIs de arriba estan filtrados por planta.
   *
   * Incluye el rango temporal: el grafico ya no tiene selector propio (CGBIDA-550).
   */
  readonly filtros = input<FiltrosDashboard>(SIN_FILTROS);
  protected readonly periodos = signal<PeriodoHistorico[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal(false);

  /**
   * Pide la serie al construirse y cada vez que cambian los filtros.
   *
   * `untracked` deja fuera del efecto lo que `cargar()` lee por dentro (el rango): si
   * no, cambiar de ventana dispararia dos peticiones, una por `cambiarRango()` y otra
   * por el efecto.
   */
  constructor() {
    effect(() => {
      const filtros = this.filtros();
      untracked(() => this.cargar(filtros));
    });

    afterNextRender(() => {
      const nodo = this.lienzo()?.nativeElement;
      // En jsdom (tests) no hay ResizeObserver: se queda con el ancho por defecto.
      if (!nodo || typeof ResizeObserver === 'undefined') return;
      const observador = new ResizeObserver(([entrada]) => {
        this.anchoMedido.set(entrada.contentRect.width);
      });
      observador.observe(nodo);
      this.destroyRef.onDestroy(() => observador.disconnect());
    });
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
    const anchoUtil = this.ANCHO() - this.PAD_IZQ - this.PAD_DER;
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

  private cargar(filtros: FiltrosDashboard): void {
    this.cargando.set(true);
    this.error.set(false);
    this.stats.getHistorical(filtros).subscribe({
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
