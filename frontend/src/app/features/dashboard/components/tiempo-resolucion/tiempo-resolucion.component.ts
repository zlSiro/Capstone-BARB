import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MachineData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';

/**
 * Tiempo de resolución por máquina (HU-16 / CGBIDA-400).
 *
 * Barras verticales con el MTTR de cada equipo, SVG a mano como el resto del dashboard.
 *
 * RELACIÓN CON EL LEGACY (`Dashboard.tsx:291-325`):
 *  - El legacy dibujaba una barra por ORDEN DE TRABAJO (las últimas 15 cerradas), con el
 *    nombre de la máquina como etiqueta y el técnico en el tooltip.
 *  - Acá se dibuja una barra por MÁQUINA, con su MTTR, que es lo que pide la subtarea y lo
 *    que el endpoint entrega agregado en `machines`. Graficar por OT obligaría a traer el
 *    listado de órdenes, que está paginado.
 *
 * DEL LEGACY SÍ SE CONSERVA:
 *  - Barras verticales con la esquina superior redondeada (radius [4,4,0,0]).
 *  - Etiquetas del eje X inclinadas y ancladas al extremo, para que no se pisen.
 *  - Cuadrícula solo horizontal (vertical={false}).
 *  - Eje Y con el sufijo de minutos.
 *
 * DESVÍO DOCUMENTADO: el legacy pintaba cada barra de rojo o verde según superara el SLA
 * (24 min) y dibujaba una línea de referencia en ese valor. El frontend NO recibe el
 * objetivo de SLA en la respuesta de stats, así que no se puede colorear por ese criterio
 * sin inventar la constante. Se usa la misma paleta por posición que el ranking y la dona.
 */
@Component({
  selector: 'app-tiempo-resolucion',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (filas().length > 0) {
      <figure
        class="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
        data-testid="tiempo-resolucion"
      >
        <figcaption class="mb-3">
          <h3 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">{{ t().chartResolution }}</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t().chartResolutionSub }}</p>
        </figcaption>

        <svg
          [attr.viewBox]="'0 0 ' + ANCHO + ' ' + ALTO"
          class="w-full"
          role="img"
          [attr.aria-label]="t().chartResolution"
          (mousemove)="mover($event)"
          (mouseleave)="salir()"
        >
          <!-- Cuadrícula: solo horizontal, como el legacy. -->
          @for (marca of marcasY(); track marca.y) {
            <g>
              <line
                [attr.x1]="PAD_IZQ" [attr.y1]="marca.y"
                [attr.x2]="ANCHO - PAD_DER" [attr.y2]="marca.y"
                class="stroke-gray-200 dark:stroke-gray-700"
                stroke-width="1"
                stroke-dasharray="3 3"
              />
              <text
                [attr.x]="PAD_IZQ - 8" [attr.y]="marca.y + 3"
                text-anchor="end" font-size="10"
                class="fill-gray-500 dark:fill-gray-400"
              >{{ marca.etiqueta }}</text>
            </g>
          }

          <!-- Barras + etiquetas del eje X. -->
          @for (fila of filas(); track fila.id; let i = $index) {
            <path
              [attr.d]="fila.barra"
              [attr.fill]="fila.color"
              [attr.data-testid]="'resolucion-barra-' + fila.id"
              class="transition-opacity"
              [style.opacity]="indiceActivo() === null || indiceActivo() === i ? 1 : 0.45"
            />

            <!-- Etiqueta girada 45°, anclada al extremo, como el legacy. -->
            <text
              [attr.x]="fila.centro" [attr.y]="ALTO - PAD_ABAJO + 12"
              text-anchor="end" font-size="9"
              class="fill-gray-500 dark:fill-gray-400"
              [attr.transform]="'rotate(-45 ' + fila.centro + ' ' + (ALTO - PAD_ABAJO + 12) + ')'"
              [attr.data-testid]="'resolucion-etiqueta-' + fila.id"
            >{{ fila.etiqueta }}</text>

            <!-- Zona de hover. -->
            <rect
              [attr.x]="fila.zona.x" y="0"
              [attr.width]="fila.zona.ancho" [attr.height]="ALTO - PAD_ABAJO"
              fill="transparent"
              [attr.data-testid]="'resolucion-zona-' + fila.id"
              (mouseenter)="entrar(i, $event)"
            />
          }
        </svg>

        <!-- Tooltip flotante, misma lógica de cuadrantes que los demás gráficos. -->
        @if (seleccionada(); as m) {
          @if (puntero(); as p) {
            <div
              class="pointer-events-none absolute z-50 w-52 rounded-lg border border-gray-200 bg-white
                     px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
              [style.left.px]="p.x + (p.derecha ? -14 : 14)"
              [style.top.px]="p.y + (p.abajo ? -14 : 14)"
              [class.-translate-x-full]="p.derecha"
              [class.-translate-y-full]="p.abajo"
              data-testid="resolucion-tooltip"
            >
              <p class="mb-1.5 flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
                <span class="inline-block h-2 w-2 shrink-0 rounded-full" [style.background]="m.color"></span>
                <span data-testid="resolucion-tooltip-nombre">{{ m.name }}</span>
              </p>
              <dl class="flex flex-col gap-0.5 text-gray-600 dark:text-gray-300">
                <div class="flex justify-between gap-3">
                  <dt>{{ tf().rankingMetricMttr }}</dt>
                  <dd class="font-medium tabular-nums text-gray-800 dark:text-gray-100">{{ m.mttr }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt>{{ tf().rankingMetricOts }}</dt>
                  <dd class="font-medium tabular-nums text-gray-800 dark:text-gray-100">{{ m.ots }}</dd>
                </div>
              </dl>
            </div>
          }
        }
      </figure>
    } @else {
      <p class="text-sm text-gray-500 dark:text-gray-400" data-testid="resolucion-vacio">
        {{ t().noData }}
      </p>
    }
  `
})
export class TiempoResolucionComponent {
  private i18n = inject(I18nService);
  private host = inject(ElementRef<HTMLElement>);

  /** Equipos del endpoint. El backend ya limita a 5. */
  readonly maquinas = input.required<MachineData[]>();

  protected readonly indiceActivo = signal<number | null>(null);
  protected readonly puntero = signal<
    { x: number; y: number; derecha: boolean; abajo: boolean } | null
  >(null);

  /** Títulos del bloque dashboard. */
  protected readonly t = computed(() => this.i18n.tree().dashboard);
  /** Nombres de métricas del bloque financial. */
  protected readonly tf = computed(() => this.i18n.tree().financial);

  // Proporciones: 190 de alto deja el gráfico a la altura de la dona, de modo que la fila
  // no crezca y el dashboard siga entrando en 1080 px. Los 60 de base alcanzan para las
  // etiquetas giradas 45 grados (una etiqueta de 15 caracteres ocupa ~53 px en vertical).
  protected readonly ANCHO = 720;
  protected readonly ALTO = 190;
  protected readonly PAD_IZQ = 44;
  protected readonly PAD_DER = 16;
  protected readonly PAD_SUP = 12;
  protected readonly PAD_ABAJO = 60;
  private readonly LARGO_ETIQUETA = 14;
  private readonly PALETA = ['#2563eb', '#059669', '#d97706', '#6d28d9', '#c0281e', '#0e7490'];

  private readonly anchoUtil = this.ANCHO - this.PAD_IZQ - this.PAD_DER;
  private readonly altoUtil = this.ALTO - this.PAD_SUP - this.PAD_ABAJO;

  /** Tope del eje Y: se redondea hacia arriba a múltiplos de 50 para que las marcas sean legibles. */
  protected readonly topeY = computed(() => {
    const maximo = Math.max(1, ...this.maquinas().map((m) => Number(m.mttr ?? 0)));
    return Math.max(50, Math.ceil(maximo / 50) * 50);
  });

  /** Tres marcas: 0, mitad y tope, igual que el ranking. */
  protected readonly marcasY = computed(() => {
    const tope = this.topeY();
    return [0, 0.5, 1].map((f) => ({
      y: this.PAD_SUP + this.altoUtil * (1 - f),
      etiqueta: `${Math.round(tope * f)}m`,
    }));
  });

  protected readonly filas = computed(() => {
    const datos = this.maquinas();
    if (datos.length === 0) return [];
    const tope = this.topeY();
    const paso = this.anchoUtil / datos.length;
    const anchoBarra = Math.min(56, paso * 0.55);

    return datos.map((m, i) => {
      const centro = this.PAD_IZQ + paso * (i + 0.5);
      const alto = (this.altoUtil * Number(m.mttr ?? 0)) / tope;
      const y = this.PAD_SUP + this.altoUtil - alto;
      return {
        id: m.id,
        name: m.name,
        etiqueta: this.truncar(m.name),
        color: this.PALETA[i % this.PALETA.length],
        mttr: `${Math.round(m.mttr)} min`,
        ots: String(m.total),
        centro,
        barra: this.barra(centro - anchoBarra / 2, y, anchoBarra, Math.max(alto, 1)),
        zona: { x: centro - paso / 2, ancho: paso },
      };
    });
  });

  protected readonly seleccionada = computed(() => {
    const i = this.indiceActivo();
    return i === null ? null : (this.filas()[i] ?? null);
  });

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

  /**
   * Barra con las esquinas SUPERIORES redondeadas.
   *
   * El legacy usa radius [4,4,0,0]; un `<rect rx>` redondearía también la base, así que se
   * dibuja como path.
   */
  private barra(x: number, y: number, ancho: number, alto: number): string {
    const r = Math.min(4, ancho / 2, alto);
    const x2 = x + ancho;
    const base = y + alto;
    return (
      `M ${x.toFixed(1)},${base.toFixed(1)} ` +
      `L ${x.toFixed(1)},${(y + r).toFixed(1)} ` +
      `Q ${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} ` +
      `L ${(x2 - r).toFixed(1)},${y.toFixed(1)} ` +
      `Q ${x2.toFixed(1)},${y.toFixed(1)} ${x2.toFixed(1)},${(y + r).toFixed(1)} ` +
      `L ${x2.toFixed(1)},${base.toFixed(1)} Z`
    );
  }

  private truncar(nombre: string): string {
    if (nombre.length <= this.LARGO_ETIQUETA) return nombre;
    return `${nombre.slice(0, this.LARGO_ETIQUETA - 1)}…`;
  }
}
