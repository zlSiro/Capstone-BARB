import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PorTipoData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';

/**
 * Dona por tipo de intervención (HU-16 / CGBIDA-395).
 *
 * Réplica visual del `PieChart` del legacy (`Dashboard.tsx:328-344`):
 * dona con radio interior 60, radio exterior 90 y 4 grados de separación entre segmentos,
 * con leyenda al pie y tooltip.
 *
 * SVG a mano, sin dependencias (decisión (a) de CGBIDA-391).
 *
 * DESVÍOS DELIBERADOS DEL LEGACY (aprobados, documentados):
 *  1. Los datos vienen del servidor, ya acotados a la empresa del usuario. El legacy
 *     calculaba la dona en el cliente sobre las OTs ya descargadas, sin filtro por empresa.
 *  2. Los nombres de los tipos salen de i18n en el servidor y en el cliente. El legacy
 *     usaba `t.maintenanceTypes[name]` con la clave cruda como respaldo, así que un tipo
 *     nuevo aparecía sin traducir; acá el respaldo es la clave en mayúscula inicial.
 *  3. La leyenda muestra el valor y el porcentaje. El legacy solo mostraba el nombre.
 *  4. La paleta usa hex con variantes oscuras, no `var(--*)`: el legacy dejaba el 6.º
 *     color sin definir en tema claro (mismo defecto que el ranking).
 */
@Component({
  selector: 'app-tipo-donut',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (segmentos().length > 0) {
      <figure
        class="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
        data-testid="tipo-donut"
      >
        <figcaption class="mb-2">
          <h3 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">{{ t().strategyTitle }}</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t().strategySubtitle }}</p>
        </figcaption>

        <!--
          Dona y leyenda lado a lado en pantallas anchas. Apiladas, la tarjeta medía 380 px
          de alto (200 de dona + 120 de leyenda) y era la que más empujaba el dashboard
          fuera de la pantalla. En fila baja a ~280 px.
        -->
        <div class="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <svg
            [attr.viewBox]="'0 0 ' + LADO + ' ' + LADO"
            [attr.width]="LADO"
            [attr.height]="LADO"
            role="img"
            [attr.aria-label]="t().strategyTitle"
            (mousemove)="mover($event)"
            (mouseleave)="salir()"
          >
            @for (s of segmentos(); track s.tipo) {
              <path
                [attr.d]="s.path"
                [attr.fill]="s.color"
                [attr.data-testid]="'segmento-' + s.tipo"
                class="cursor-pointer transition-opacity"
                [style.opacity]="indiceActivo() === null || indiceActivo() === $index ? 1 : 0.45"
                (mouseenter)="entrar($index, $event)"
              />
            }

            <!-- Centro: el volumen total. Refuerza la lectura sin depender del tooltip. -->
            <text
              [attr.x]="CENTRO" [attr.y]="CENTRO - 2"
              text-anchor="middle" font-size="20" font-weight="700"
              class="fill-gray-800 dark:fill-gray-100"
              data-testid="dona-total"
            >{{ total() }}</text>
            <text
              [attr.x]="CENTRO" [attr.y]="CENTRO + 14"
              text-anchor="middle" font-size="9"
              class="fill-gray-500 dark:fill-gray-400"
            >{{ t().totalOts }}</text>
          </svg>

          <!--
            Leyenda, en el mismo orden que los segmentos.

            w-fit + mx-auto: la lista se ajusta a su contenido y se centra, asi que no
            queda ningun hueco elastico entre el nombre y su valor. Antes la lista ocupaba
            todo el ancho de la tarjeta y el ml-auto del valor lo empujaba al borde
            opuesto, dejando cientos de pixeles de vacio en el medio.

            El nombre lleva ancho fijo para que los valores queden alineados en columna, y
            tabular-nums evita que las cifras bailen entre filas.
          -->
          <!--
            Sin mx-auto: en la fila del layout ancho, mx-auto se queda con todo el espacio
            libre y empuja la leyenda al otro extremo de la tarjeta, que es justo el
            defecto que se estaba corrigiendo. El centrado lo dan items-center (columna) y
            justify-center (fila) del contenedor.
          -->
          <ul class="flex w-fit flex-col gap-1.5">
            @for (s of segmentos(); track s.tipo; let i = $index) {
              <li
                class="flex items-center gap-2 text-xs"
                [attr.data-testid]="'leyenda-' + s.tipo"
              >
                <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" [style.background]="s.color"></span>
                <span class="w-26 truncate text-gray-700 dark:text-gray-200">{{ s.etiqueta }}</span>
                <span class="w-10 text-right font-medium tabular-nums text-gray-800 dark:text-gray-100">{{ s.total }}</span>
                <span class="w-9 text-right tabular-nums text-gray-500 dark:text-gray-400">{{ s.porcentaje }}%</span>
              </li>
            }
          </ul>
        </div>

        <!--
          Tooltip flotante. Va en position absolute dentro de la tarjeta, no en fixed: asi
          queda contenido por construccion y no puede salirse ni de la tarjeta ni de la
          pantalla. Cuando el cursor esta en la mitad derecha o inferior, se invierte el
          desplazamiento y se traslada el propio tooltip (-100%) para que no se corte
          contra el borde.
        -->
        @if (segmentoActivo(); as s) {
          @if (puntero(); as p) {
            <div
              class="pointer-events-none absolute z-50 rounded-lg border border-gray-200 bg-white
                     px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
              [style.left.px]="p.x + (p.derecha ? -14 : 14)"
              [style.top.px]="p.y + (p.abajo ? -14 : 14)"
              [class.-translate-x-full]="p.derecha"
              [class.-translate-y-full]="p.abajo"
              data-testid="dona-tooltip"
            >
              <p class="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
                <span class="inline-block h-2 w-2 rounded-full" [style.background]="s.color"></span>
                {{ s.etiqueta }}
              </p>
              <p class="text-gray-600 dark:text-gray-300">
                {{ t().totalOts }}: <strong>{{ s.total }}</strong> ({{ s.porcentaje }}%)
              </p>
            </div>
          }
        }
      </figure>
    } @else {
      <p class="text-sm text-gray-500 dark:text-gray-400" data-testid="dona-vacia">
        {{ t().noData }}
      </p>
    }
  `
})
export class TipoDonutComponent {
  private i18n = inject(I18nService);
  private host = inject(ElementRef<HTMLElement>);

  /** Distribución que entrega el backend, ya acotada a la empresa del usuario. */
  readonly datos = input.required<PorTipoData[]>();

  /** Índice del segmento bajo el cursor, o `null`. */
  protected readonly indiceActivo = signal<number | null>(null);

  /**
   * Posición del cursor relativa a la tarjeta, más en qué cuadrante está.
   *
   * `derecha` y `abajo` deciden si el tooltip se dibuja a la derecha/abajo del cursor o al
   * revés, para que nunca se corte contra el borde de la tarjeta.
   */
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

  protected readonly t = computed(() => this.i18n.tree().dashboard);

  /** Nombres de los tipos desde i18n. Sección de nivel raíz del árbol. */
  private readonly tipos = computed(() => this.i18n.tree().maintenanceTypes);

  // Geometría del legacy: `innerRadius={60} outerRadius={90}` dentro de un `height={260}`.
  // El lienzo se dimensiona con el diámetro exterior más un margen para el trazo.
  protected readonly RADIO_EXT = 90;
  protected readonly RADIO_INT = 60;
  protected readonly LADO = 200;
  protected readonly CENTRO = 100;
  /** `paddingAngle={4}` del legacy, en grados. */
  private readonly SEPARACION = 4;

  /** Paleta del legacy (`Dashboard.tsx`), con los hex resueltos y sin `var(--cyan)`. */
  private readonly PALETA = [
    '#2563eb', '#059669', '#d97706', '#6d28d9',
    '#c0281e', '#0e7490', '#b45309', '#34d399',
  ];

  /**
   * Tipos que no se dibujan.
   *
   * «Predictivo» se excluye por pedido del usuario: sus 21 OTs no cambian la lectura de la
   * estrategia y hacían la leyenda más ruidosa que informativa. El backend sigue enviando
   * los cuatro tipos; el recorte es de presentación, así que si mañana se quiere de vuelta
   * alcanza con sacarlo de este conjunto.
   */
  private readonly TIPOS_OCULTOS: ReadonlySet<string> = new Set(['predictive']);

  /** Filas que efectivamente se dibujan. */
  private readonly filasVisibles = computed(() =>
    this.datos().filter((d) => !this.TIPOS_OCULTOS.has(d.tipo))
  );

  protected readonly total = computed(() =>
    this.filasVisibles().reduce((suma, d) => suma + d.total, 0)
  );

  /**
   * Segmentos ya calculados: arco, color, etiqueta traducida, volumen y porcentaje.
   *
   * El `paddingAngle` del legacy resta 4 grados por segmento del barrido total, y ese
   * espacio se reparte como separación. Con un solo segmento no hay separación: si se
   * restara, la dona quedaría con un hueco sin sentido.
   *
   * Los porcentajes se reparten por el método del mayor residuo, NO redondeando cada uno
   * por separado: 70/146, 30/146, 25/146 y 21/146 redondeados de forma independiente dan
   * 48+21+17+14 = 100... o 101 según los decimales. Con este método la suma es siempre
   * exactamente 100, que es lo que un lector espera al ver una leyenda de porcentajes.
   */
  protected readonly segmentos = computed(() => {
    const filas = this.filasVisibles();
    const total = this.total();
    if (filas.length === 0 || total === 0) return [];

    const sep = filas.length > 1 ? this.SEPARACION : 0;
    const disponible = 360 - sep * filas.length;
    const tipos = this.tipos();
    const porcentajes = this.repartirPorcentajes(filas, total);

    let angulo = 0;
    return filas.map((fila, i) => {
      const barrido = (disponible * fila.total) / total;
      const inicio = angulo;
      angulo += barrido + sep;
      return {
        tipo: fila.tipo,
        total: fila.total,
        porcentaje: porcentajes[i],
        etiqueta: tipos[fila.tipo as keyof typeof tipos] ?? fila.tipo,
        color: this.PALETA[i % this.PALETA.length],
        path: this.arco(inicio, barrido),
      };
    });
  });

  /**
   * Reparte 100 puntos porcentuales con el método del mayor residuo.
   *
   * 1. Se toma la parte entera de cada porcentaje exacto.
   * 2. Los puntos que faltan para 100 se asignan a los mayores residuos.
   *
   * Garantiza que la suma sea exactamente 100 sin alterar el orden de los segmentos.
   */
  private repartirPorcentajes(filas: PorTipoData[], total: number): number[] {
    const exactos = filas.map((f) => (100 * f.total) / total);
    const base = exactos.map((v) => Math.floor(v));
    let faltan = 100 - base.reduce((a, b) => a + b, 0);

    // Indices ordenados por residuo descendente; a igualdad, el de mayor volumen primero.
    const porResiduo = exactos
      .map((v, i) => ({ i, residuo: v - Math.floor(v), total: filas[i].total }))
      .sort((a, b) => b.residuo - a.residuo || b.total - a.total);

    for (const { i } of porResiduo) {
      if (faltan <= 0) break;
      base[i] += 1;
      faltan -= 1;
    }
    return base;
  }

  protected readonly segmentoActivo = computed(() => {
    const i = this.indiceActivo();
    return i === null ? null : (this.segmentos()[i] ?? null);
  });

  /**
   * Path SVG de un segmento anular entre dos ángulos (en grados, desde las 12 en punto).
   *
   * Un solo arco no alcanza para 180 grados o más: SVG necesita partir el trazo en dos.
   * Por eso se controla `largeArcFlag`, y si el barrido llega a 360 se dibuja un anillo
   * completo con dos semicírculos, porque un arco de 360º colapsa al mismo punto.
   */
  private arco(inicioDeg: number, barridoDeg: number): string {
    if (barridoDeg <= 0) return '';

    const punto = (d: number, r: number) => this.punto(d, r);

    // Caso especial: un único segmento que ocupa todo el círculo.
    if (barridoDeg >= 359.999) {
      const a = punto(0, this.RADIO_EXT);
      const b = punto(180, this.RADIO_EXT);
      const c = punto(0, this.RADIO_INT);
      const d = punto(180, this.RADIO_INT);
      return (
        `M ${a.x.toFixed(2)},${a.y.toFixed(2)} ` +
        `A ${this.RADIO_EXT},${this.RADIO_EXT} 0 1 1 ${b.x.toFixed(2)},${b.y.toFixed(2)} ` +
        `A ${this.RADIO_EXT},${this.RADIO_EXT} 0 1 1 ${a.x.toFixed(2)},${a.y.toFixed(2)} Z ` +
        `M ${c.x.toFixed(2)},${c.y.toFixed(2)} ` +
        `A ${this.RADIO_INT},${this.RADIO_INT} 0 1 0 ${d.x.toFixed(2)},${d.y.toFixed(2)} ` +
        `A ${this.RADIO_INT},${this.RADIO_INT} 0 1 0 ${c.x.toFixed(2)},${c.y.toFixed(2)} Z`
      );
    }

    const fin = inicioDeg + barridoDeg;
    const grande = barridoDeg > 180 ? 1 : 0;

    const extIni = punto(inicioDeg, this.RADIO_EXT);
    const extFin = punto(fin, this.RADIO_EXT);
    const intFin = punto(fin, this.RADIO_INT);
    const intIni = punto(inicioDeg, this.RADIO_INT);

    return (
      `M ${extIni.x.toFixed(2)},${extIni.y.toFixed(2)} ` +
      `A ${this.RADIO_EXT},${this.RADIO_EXT} 0 ${grande} 1 ${extFin.x.toFixed(2)},${extFin.y.toFixed(2)} ` +
      `L ${intFin.x.toFixed(2)},${intFin.y.toFixed(2)} ` +
      `A ${this.RADIO_INT},${this.RADIO_INT} 0 ${grande} 0 ${intIni.x.toFixed(2)},${intIni.y.toFixed(2)} Z`
    );
  }

  private punto(d: number, r: number): { x: number; y: number } {
    const rad = ((d - 90) * Math.PI) / 180;
    return { x: this.CENTRO + r * Math.cos(rad), y: this.CENTRO + r * Math.sin(rad) };
  }
}
