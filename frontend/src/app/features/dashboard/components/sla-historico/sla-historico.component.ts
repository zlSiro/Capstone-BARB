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
  /**
   * `false` cuando el período no tuvo cierres (`completadas === 0`).
   *
   * El backend manda `sla: 0.0` en esos períodos, pero un 0 no significa "cumplió 0 %":
   * significa "no hubo nada que medir". Dibujarlos como 0 hunde la línea y produce la
   * caída en diagonal hacia el último valor. Se tratan como hueco.
   */
  valido: boolean;
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
      class="relative flex h-full flex-col rounded-control border border-borde bg-superficie p-5 "
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
      } @else if (puntos().length < 2 || !hayDatos()) {
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

          <!--
            Serie del SLA: línea para TODAS las granularidades (es lo estándar para leer una
            tendencia). Los períodos sin cierres no se dibujan como 0 %: cortan la línea y
            dejan un hueco (spanGaps: false), así el trazo no cae en diagonal hasta el
            último valor. Por eso puede haber más de una polilínea: una por tramo continuo.
          -->
          @for (seg of segmentos(); track $index) {
            <polyline
              [attr.points]="seg"
              fill="none"
              class="stroke-accion "
              stroke-width="2.5"
              stroke-linejoin="round"
              stroke-linecap="round"
              data-testid="hist-linea"
            />
          }

          @for (p of puntosConDatos(); track p.etiqueta) {
            <!-- Sin el elemento title del SVG: el tooltip nativo del navegador es un cuadro
                 blanco que rompe el tema oscuro. El de abajo usa los tokens del tema. -->
            <circle
              [attr.cx]="p.x"
              [attr.cy]="p.y"
              [attr.r]="indiceActivo() === p.i ? 5 : 3.5"
              class="fill-accion cursor-pointer "
              data-testid="hist-punto"
              (mouseenter)="entrar(p.i, $event)"
              (mousemove)="mover($event)"
              (mouseleave)="salir()"
            />
          }

          <!--
            Etiquetas del eje X. La primera y la última se anclan al inicio y al final para
            que no se corten contra el borde del SVG («2025-20…»): con un anclaje centrado el texto se
            salía del viewBox en los dos extremos.
          -->
          @for (p of puntos(); track p.etiqueta; let i = $index) {
            @if (mostrarEtiqueta(i)) {
              <text
                [attr.x]="p.x"
                [attr.y]="ALTO - 6"
                [attr.text-anchor]="anclaEtiqueta(i)"
                font-size="10"
                class="fill-tinta-suave "
              >{{ p.etiqueta }}</text>
            }
          }
        </svg>
      }

      <!--
        Tooltip del punto. Mismo patrón que el de la dona (CGBIDA-550): posicionado de forma
        absoluta dentro de la tarjeta, con los tokens del tema (bg-superficie, text-tinta)
        para que respete el modo oscuro. Se invierte el desplazamiento en la mitad derecha
        o inferior para que no se corte contra el borde.
      -->
      @if (puntoActivo(); as p) {
        @if (puntero(); as pos) {
          <div
            class="pointer-events-none absolute z-50 rounded-control border border-borde bg-superficie
                   px-3 py-2 text-sm shadow-lg "
            [style.left.px]="pos.x + (pos.derecha ? -14 : 14)"
            [style.top.px]="pos.y + (pos.abajo ? -14 : 14)"
            [class.-translate-x-full]="pos.derecha"
            [class.-translate-y-full]="pos.abajo"
            data-testid="hist-tooltip"
          >
            <p class="flex items-center gap-2 font-semibold text-tinta ">
              <span class="inline-block h-2 w-2 rounded-full bg-accion"></span>
              {{ p.etiqueta }}
            </p>
            <p class="text-tinta-suave ">
              {{ t().healthComponentSla }}: <strong class="text-tinta ">{{ p.valor }}%</strong>
            </p>
          </div>
        }
      }
    </figure>
  `,
})
export class SlaHistoricoComponent {
  private stats = inject(StatsService);
  private i18n = inject(I18nService);
  private destroyRef = inject(DestroyRef);

  /** El host, para posicionar el tooltip relativo a la tarjeta (igual que la dona). */
  private host = inject(ElementRef<HTMLElement>);

  protected readonly t = computed(() => this.i18n.tree().financial);

  /** Índice del punto bajo el cursor, o `null`. */
  protected readonly indiceActivo = signal<number | null>(null);

  /**
   * Posición del cursor relativa a la tarjeta, más en qué cuadrante está.
   *
   * `derecha` y `abajo` deciden si el tooltip se dibuja a la derecha/abajo del cursor o al
   * revés, para que no se corte contra el borde de la tarjeta.
   */
  protected readonly puntero = signal<
    { x: number; y: number; derecha: boolean; abajo: boolean } | null
  >(null);

  /** Punto activo, para el tooltip. */
  protected readonly puntoActivo = computed(() => {
    const i = this.indiceActivo();
    return i === null ? null : (this.puntos()[i] ?? null);
  });

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

  /** Entra en un punto: lo marca y arranca a seguir el cursor. */
  protected entrar(indice: number, evento: MouseEvent): void {
    this.indiceActivo.set(indice);
    this.mover(evento);
  }

  /** Sigue el cursor dentro de la tarjeta. */
  protected mover(evento: MouseEvent): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    const x = evento.clientX - r.left;
    const y = evento.clientY - r.top;
    this.puntero.set({ x, y, derecha: x > r.width / 2, abajo: y > r.height / 2 });
  }

  /** Sale del punto: se oculta el tooltip. */
  protected salir(): void {
    this.indiceActivo.set(null);
    this.puntero.set(null);
  }

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
    // Solo los períodos con cierres: incluir los `sla: 0.0` de los vacíos hundía el eje a 0
    // y dejaba la serie pegada arriba, sin variación visible.
    const valores = this.periodos().filter((p) => p.completadas > 0).map((p) => p.sla);
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
      valido: p.completadas > 0,
    }));
  });

  /** ¿Hay al menos un período con cierres? Si no, no hay nada que dibujar. */
  protected readonly hayDatos = computed(() =>
    this.periodos().some((p) => p.completadas > 0)
  );

  /**
   * Tramos continuos de la serie, ya como cadenas de `points`.
   *
   * Cada período sin cierres corta el trazo (equivalente a `spanGaps: false`): la línea no
   * une el último dato bueno con el siguiente salvando el hueco, porque ese hueco no es un
   * valor. Un tramo de un solo punto no se dibuja (el punto queda como círculo).
   */
  protected readonly segmentos = computed(() => {
    const tramos: string[] = [];
    let actual: string[] = [];
    for (const p of this.puntos()) {
      if (!p.valido) {
        if (actual.length >= 2) tramos.push(actual.join(' '));
        actual = [];
        continue;
      }
      actual.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    if (actual.length >= 2) tramos.push(actual.join(' '));
    return tramos;
  });

  /** Puntos reales (con cierres) y su índice dentro de la serie completa, para el hover. */
  protected readonly puntosConDatos = computed(() =>
    this.puntos()
      .map((p, i) => ({ ...p, i }))
      .filter((p) => p.valido)
  );

  /**
   * Anclaje del rótulo del eje X.
   *
   * El primero y el último se pegan a su borde en vez de centrarse: centrados, el texto se
   * salía del viewBox y el navegador lo recortaba («2025-20…»).
   */
  protected anclaEtiqueta(i: number): 'start' | 'middle' | 'end' {
    if (i === 0) return 'start';
    if (i === this.puntos().length - 1) return 'end';
    return 'middle';
  }

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
