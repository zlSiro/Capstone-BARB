import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

import { Topology, TopologyConnection, TopologyNode, TopologyNodeState } from '../../core/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { TopologyService } from '../../core/services/topology.service';

/** Dimensiones de la tarjeta de cada nodo, en unidades del viewBox. */
const NODE_W = 130;
const NODE_H = 85;

/** Vista inicial del lienzo (CGBIDA-362). El zoom de CGBIDA-363 la modifica. */
const INITIAL_VIEW = { x: -100, y: -50, w: 1200, h: 800 };

/**
 * Estado de carga como unión discriminada: evita ambigüedad entre "aún cargando",
 * "falló" y "respondió vacío", que el usuario debe poder distinguir.
 */
type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  | { tipo: 'vacio' }
  | { tipo: 'listo'; topologia: Topology };

/**
 * Color por estado. Tailwind en Tailwind v4 se resuelve a `var(--color-*)`, así que
 * se puede enlazar directo en un atributo SVG (a diferencia de las clases del legacy).
 */
const COLOR_POR_ESTADO: Record<TopologyNodeState, string> = {
  operativo: 'var(--color-emerald-500)',
  alerta: 'var(--color-amber-500)',
  falla: 'var(--color-red-500)',
  desconectado: 'var(--color-gray-400)',
};

/** Clave de traducción de cada estado. El texto vive en `translations.topology`. */
const CLAVE_ESTADO: Record<TopologyNodeState, string> = {
  operativo: 'stateOperativo',
  alerta: 'stateAlerta',
  falla: 'stateFalla',
  desconectado: 'stateDesconectado',
};

@Component({
  selector: 'app-topology',
  standalone: true,
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-800">{{ t().title }}</h1>
          <p class="text-sm text-gray-500">{{ t().subtitle }}</p>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="zoom-in"
            (click)="zoom(1.2)"
            class="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
            [attr.aria-label]="t().zoomIn"
          >+</button>
          <button
            type="button"
            data-testid="zoom-out"
            (click)="zoom(0.8)"
            class="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
            [attr.aria-label]="t().zoomOut"
          >−</button>
          <button
            type="button"
            data-testid="zoom-reset"
            (click)="resetView()"
            class="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
          >{{ t().resetView }}</button>
        </div>
      </div>

      <!-- Leyenda de estados -->
      <div class="flex flex-wrap gap-4 text-sm text-gray-600">
        @for (e of estados; track e) {
          <span class="inline-flex items-center gap-2">
            <span
              class="inline-block w-3 h-3 rounded-full"
              [style.background-color]="colorDe(e)"
            ></span>
            {{ etiquetaDe(e) }}
          </span>
        }
      </div>

      <div class="relative bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        @switch (estado()) {
          @case ('cargando') {
            <div class="p-10 text-center text-gray-500" data-testid="estado-cargando">
              {{ t().loading }}
            </div>
          }
          @case ('error') {
            <div class="p-10 text-center text-red-600" data-testid="estado-error" role="alert">
              {{ t().loadError }}
            </div>
          }
          @case ('vacio') {
            <div class="p-10 text-center text-gray-500" data-testid="estado-vacio">
              {{ t().empty }}
            </div>
          }
          @default {
            <svg
              data-testid="topo-canvas"
              [attr.viewBox]="viewBoxAttr()"
              preserveAspectRatio="xMidYMid meet"
              class="w-full h-[560px] select-none"
              [class.cursor-grabbing]="arrastrando()"
              [class.cursor-grab]="!arrastrando()"
              style="touch-action: none"
              (mousedown)="onMouseDown($event)"
              (mousemove)="onMouseMove($event)"
              (mouseup)="onMouseUp()"
              (mouseleave)="onMouseUp()"
            >
              <!-- Conexiones -->
              <g stroke="#cbd5e1" stroke-width="2" fill="none">
                @for (e of aristas(); track e.conexion_id) {
                  <line
                    [attr.x1]="e.x1"
                    [attr.y1]="e.y1"
                    [attr.x2]="e.x2"
                    [attr.y2]="e.y2"
                    [attr.data-relacion]="e.tipo_relacion"
                  />
                }
              </g>

              <!-- Nodos -->
              @for (n of nodos(); track n.nodo_id) {
                <g
                  class="topo-node"
                  [attr.transform]="'translate(' + n.pos_x + ',' + n.pos_y + ')'"
                  [attr.data-nodo-id]="n.nodo_id"
                  [attr.data-tipo]="n.tipo"
                  [attr.data-estado]="n.estado_actual"
                  (click)="seleccionar(n, $event)"
                >
                  <rect
                    x="0"
                    y="0"
                    [attr.width]="nodeW"
                    [attr.height]="nodeH"
                    rx="12"
                    fill="#ffffff"
                    [attr.stroke]="colorDe(n.estado_actual)"
                    stroke-width="2"
                  />
                  <text x="65" y="28" text-anchor="middle" font-size="22">{{ n.icono }}</text>
                  <text
                    x="65"
                    y="50"
                    text-anchor="middle"
                    font-size="11"
                    font-weight="600"
                    fill="#1f2937"
                    class="topo-node-name"
                  >{{ n.nombre_visual }}</text>
                  <text
                    x="65"
                    y="65"
                    text-anchor="middle"
                    font-size="10"
                    fill="#6b7280"
                    class="topo-node-type"
                  >{{ n.tipo }}</text>
                  <circle
                    [attr.cx]="nodeW - 14"
                    cy="14"
                    r="7"
                    [attr.fill]="colorDe(n.estado_actual)"
                  />
                </g>
              }
            </svg>

            <!-- Panel de detalle del equipo seleccionado (CGBIDA-364) -->
            @if (seleccionado(); as n) {
              <div
                data-testid="panel-detalle"
                class="absolute top-3 right-3 w-64 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="font-semibold text-gray-800 truncate" data-testid="panel-nombre">
                      {{ n.nombre_visual }}
                    </p>
                    <p class="text-xs text-gray-500" data-testid="panel-tipo">{{ n.tipo }}</p>
                  </div>
                  <span class="text-xl" aria-hidden="true">{{ n.icono }}</span>
                </div>

                <div class="mt-3 flex items-center gap-2" data-testid="panel-estado">
                  <span
                    class="inline-block w-3 h-3 rounded-full"
                    [style.background-color]="colorDe(n.estado_actual)"
                  ></span>
                  <span class="text-sm text-gray-700">{{ etiquetaDe(n.estado_actual) }}</span>
                </div>

                <button
                  type="button"
                  data-testid="panel-cerrar"
                  (click)="cerrarPanel()"
                  class="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                >{{ t().closePanel }}</button>
              </div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class TopologyComponent {
  private readonly topologyService = inject(TopologyService);
  private readonly i18n = inject(I18nService);

  /** Textos de la pantalla. Es un computed, así que cambia al alternar el idioma. */
  protected readonly t = computed(() => this.i18n.tree().topology);

  protected readonly nodeW = NODE_W;
  protected readonly nodeH = NODE_H;
  protected readonly estados: TopologyNodeState[] = ['operativo', 'alerta', 'falla', 'desconectado'];

  /** Equipo cuyo panel de detalle está abierto (CGBIDA-364). */
  protected readonly seleccionado = signal<TopologyNode | null>(null);

  /** `initialValue` obliga a que el tipo no incluya `undefined`; de ahí la unión. */
  private readonly carga = toSignal(
    this.topologyService.get().pipe(
      map((t): EstadoCarga => (t.nodos.length ? { tipo: 'listo', topologia: t } : { tipo: 'vacio' })),
      catchError(() => of<EstadoCarga>({ tipo: 'error' })),
    ),
    { initialValue: { tipo: 'cargando' } as EstadoCarga },
  );

  /** Tipo de estado actual: `cargando` · `error` · `vacio` · `listo`. */
  protected readonly estado = computed(() => this.carga().tipo);

  private readonly topologiaLista = computed(() => {
    const c = this.carga();
    return c.tipo === 'listo' ? c.topologia : null;
  });

  protected readonly nodos = computed<TopologyNode[]>(() => this.topologiaLista()?.nodos ?? []);
  protected readonly conexiones = computed<TopologyConnection[]>(
    () => this.topologiaLista()?.conexiones ?? [],
  );

  /** Centro de cada nodo, para dibujar las aristas entre centros y no entre esquinas. */
  private readonly centros = computed(() => {
    const mapa = new Map<string, { x: number; y: number }>();
    for (const n of this.nodos()) {
      mapa.set(n.nodo_id, { x: n.pos_x + NODE_W / 2, y: n.pos_y + NODE_H / 2 });
    }
    return mapa;
  });

  /** Aristas resueltas: se descartan las que apunten a un nodo ausente. */
  protected readonly aristas = computed(() => {
    const centros = this.centros();
    return this.conexiones()
      .map((c) => {
        const o = centros.get(c.origen_nodo_id);
        const d = centros.get(c.destino_nodo_id);
        return o && d ? { ...c, x1: o.x, y1: o.y, x2: d.x, y2: d.y } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  });

  // --- CGBIDA-363: cámara del lienzo -----------------------------------------

  protected readonly viewBox = signal({ ...INITIAL_VIEW });
  protected readonly arrastrando = signal(false);
  private ultimoPunto = { x: 0, y: 0 };
  private svgEl: SVGSVGElement | null = null;

  protected readonly viewBoxAttr = computed(() => {
    const v = this.viewBox();
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  });

  protected zoom(factor: number): void {
    this.viewBox.update((v) => {
      const w = v.w / factor;
      const h = v.h / factor;
      return { x: v.x + v.w / 2 - w / 2, y: v.y + v.h / 2 - h / 2, w, h };
    });
  }

  protected resetView(): void {
    this.viewBox.set({ ...INITIAL_VIEW });
  }

  protected onMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.topo-node')) return; // los nodos no arrastran el lienzo
    this.arrastrando.set(true);
    this.ultimoPunto = { x: event.clientX, y: event.clientY };
  }

  protected onMouseMove(event: MouseEvent): void {
    if (!this.arrastrando()) return;
    this.svgEl = event.currentTarget as SVGSVGElement;
    const rect = this.svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    this.viewBox.update((v) => {
      // El delta de pantalla se escala a unidades del viewBox.
      const dx = ((event.clientX - this.ultimoPunto.x) * v.w) / rect.width;
      const dy = ((event.clientY - this.ultimoPunto.y) * v.h) / rect.height;
      return { ...v, x: v.x - dx, y: v.y - dy };
    });
    this.ultimoPunto = { x: event.clientX, y: event.clientY };
  }

  protected onMouseUp(): void {
    this.arrastrando.set(false);
  }

  // --- CGBIDA-364: panel de detalle ------------------------------------------

  protected seleccionar(nodo: TopologyNode, event: Event): void {
    // Sin esto, el clic burbujearía al <svg> y arrancaría un paneo.
    event.stopPropagation();
    this.seleccionado.set(nodo);
  }

  protected cerrarPanel(): void {
    this.seleccionado.set(null);
  }

  // --- helpers de presentación ----------------------------------------------

  protected colorDe(estado: TopologyNodeState): string {
    return COLOR_POR_ESTADO[estado] ?? COLOR_POR_ESTADO.desconectado;
  }

  protected etiquetaDe(estado: TopologyNodeState): string {
    const clave = CLAVE_ESTADO[estado] ?? CLAVE_ESTADO.desconectado;
    const textos = this.t() as unknown as Record<string, string>;
    return textos[clave] ?? estado;
  }
}
