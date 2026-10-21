import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

import {
  Topology,
  TopologyConnection,
  TopologyNode,
  TopologyNodeState,
  TopologyNodoDetalle,
  WorkOrder,
  WorkOrderStatus,
} from '../../core/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { TopologyService } from '../../core/services/topology.service';
import { OtDetailSheetComponent } from '../work-orders/components/ot-detail-sheet/ot-detail-sheet.component';
import { filterGroup } from '../work-orders/utils/work-order-labels';

/** Dimensiones de la tarjeta de cada nodo, en unidades del viewBox. */
const NODE_W = 130;
const NODE_H = 85;

/**
 * Aire alrededor del grafo, en unidades del viewBox.
 *
 * Sin este margen el nodo de la izquierda queda pegado al borde del lienzo y el de la
 * derecha también, así que el mapa se ve recortado aunque esté completo.
 */
const PADDING_VISTA = 80;

/**
 * Vista de respaldo cuando todavía no hay nodos (CGBIDA-362).
 *
 * Con datos, la cámara arranca en el rectángulo que contiene el grafo (`cajaContenido`).
 * La vista fija anterior era 1200x800 en (-100,-50), y el mapa real llega a x=2160: diez
 * de los veintiún nodos quedaban fuera de cuadro al cargar.
 */
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

// --- HU-377 · CGBIDA-383: agrupación de los 6 estados de OT -------------------
//
// La agrupación NO se decide aquí: se reutiliza `filterGroup()`
// (`features/work-orders/utils/work-order-labels.ts`), que ya unifica `assigned` y
// `overdue` bajo `pending`. El backend aplica la misma regla en
// `core/work_order_states.py` (los tres estados comparten transiciones).
// Duplicarla aquí haría que el panel de topología y el listado de OTs discreparan.
//
// `overdue` se agrupa con Pendientes por ciclo de vida, pero se marca con un badge
// rojo (decisión de CGBIDA-378) para que el supervisor lo distinga sin cambiar de grupo.

type GrupoOt = 'groupPendientes' | 'groupEnCurso' | 'groupCerradas' | 'groupCanceladas';

/** Orden dentro de cada grupo: por número de OT (A-Z) o por fecha de creación. */
type OrdenOt = 'az' | 'recientes';

/** Orden de presentación de los grupos; el usuario ve primero lo que exige acción. */
const ORDEN_GRUPOS: GrupoOt[] = ['groupPendientes', 'groupEnCurso', 'groupCerradas', 'groupCanceladas'];

/**
 * Estado ya normalizado por `filterGroup()` -> grupo del panel.
 * Las claves son los 4 estados que devuelve `filterGroup`, no los 6 del backend.
 */
const CLAVE_GRUPO: Record<string, GrupoOt> = {
  pending: 'groupPendientes',
  in_progress: 'groupEnCurso',
  completed: 'groupCerradas',
  cancelled: 'groupCanceladas',
};

/** Etiqueta por estado, para el badge de cada tarjeta. */
const ETIQUETA_OT: Record<string, string> = {
  pending: 'Pendiente',
  assigned: 'Asignada',
  in_progress: 'En curso',
  overdue: 'Vencida',
  completed: 'Cerrada',
  cancelled: 'Cancelada',
};

/** Color del badge por estado, coherente con `work-order-labels.ts`. */
const COLOR_OT: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900',
  assigned: 'bg-indigo-100 text-indigo-900',
  in_progress: 'bg-blue-100 text-blue-900',
  overdue: 'bg-red-100 text-red-900',
  completed: 'bg-green-100 text-green-900',
  cancelled: 'bg-gray-200 text-gray-800',
};

interface OtEnPanel {
  orden: WorkOrder;
  /** `overdue` lleva badge rojo dentro de su grupo (CGBIDA-378). */
  vencida: boolean;
  etiqueta: string;
  color: string;
}

interface GrupoEnPanel {
  nombre: GrupoOt;
  ordenes: OtEnPanel[];
}

@Component({
  selector: 'app-topology',
  standalone: true,
  imports: [OtDetailSheetComponent],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-800 dark:text-gray-100">{{ t().title }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t().subtitle }}</p>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="zoom-in"
            (click)="zoom(1.2)"
            class="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            [attr.aria-label]="t().zoomIn"
          >+</button>
          <button
            type="button"
            data-testid="zoom-out"
            (click)="zoom(0.8)"
            class="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            [attr.aria-label]="t().zoomOut"
          >−</button>
          <button
            type="button"
            data-testid="zoom-reset"
            (click)="resetView()"
            class="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >{{ t().resetView }}</button>
        </div>
      </div>

      <!-- Leyenda de estados -->
      <div class="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-300">
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

      <div class="relative bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden dark:border-gray-800 dark:bg-slate-900">
        @switch (estado()) {
          @case ('cargando') {
            <div class="p-10 text-center text-gray-500 dark:text-gray-400" data-testid="estado-cargando">
              {{ t().loading }}
            </div>
          }
          @case ('error') {
            <div class="p-10 text-center text-red-600 dark:text-red-400" data-testid="estado-error" role="alert">
              {{ t().loadError }}
            </div>
          }
          @case ('vacio') {
            <div class="p-10 text-center text-gray-500 dark:text-gray-400" data-testid="estado-vacio">
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
              <g class="stroke-gray-300 dark:stroke-gray-600" stroke-width="2" fill="none">
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
                    class="fill-white dark:fill-slate-800"
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
                    class="topo-node-name fill-gray-800 dark:fill-gray-100"
                  >{{ n.nombre_visual }}</text>
                  <text
                    x="65"
                    y="65"
                    text-anchor="middle"
                    font-size="10"
                    class="topo-node-type fill-gray-500 dark:fill-gray-400"
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
                class="absolute top-3 right-3 w-72 max-h-[85%] overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="font-semibold text-gray-800 truncate dark:text-gray-100" data-testid="panel-nombre">
                      {{ n.nombre_visual }}
                    </p>
                    <p class="text-xs text-gray-500 dark:text-gray-400" data-testid="panel-tipo">{{ n.tipo }}</p>
                  </div>
                  <span class="text-xl" aria-hidden="true">{{ n.icono }}</span>
                </div>

                <div class="mt-3 flex items-center gap-2" data-testid="panel-estado">
                  <span
                    class="inline-block w-3 h-3 rounded-full"
                    [style.background-color]="colorDe(n.estado_actual)"
                  ></span>
                  <span class="text-sm text-gray-700 dark:text-gray-200">{{ etiquetaDe(n.estado_actual) }}</span>
                </div>

                @if (esBotonVolver()) {
                  <button
                    type="button"
                    data-testid="panel-volver"
                    (click)="volver()"
                    class="mt-3 text-xs text-blue-700 underline hover:text-blue-900 dark:text-blue-200 dark:hover:text-white"
                  >&larr; {{ t().detailBack }}</button>
                }

                <!-- CGBIDA-383: órdenes de trabajo, solo en nodos Máquina -->
                @if (n.tipo === 'Máquina') {
                  <div class="mt-3 border-t border-gray-100 pt-2 dark:border-gray-700">
                    <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {{ t().ordersTitle }}
                    </p>

                    @switch (estadoDetalle()) {
                      @case ('cargando') {
                        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400" data-testid="ordenes-cargando">
                          {{ t().ordersLoading }}
                        </p>
                      }
                      @case ('error') {
                        <p class="mt-2 text-sm text-red-700 dark:text-red-300" data-testid="ordenes-error">
                          {{ t().ordersError }}
                        </p>
                      }
                      @default {
                        @if (gruposDeOrdenes().length) {
                          <!--
                            Fila de controles. 40 px de alto y una sola línea: el panel mide
                            288 px (256 internos) y el listado ya scrollea, así que el costo
                            vertical es despreciable y el horizontal entra con holgura.
                          -->
                          <div class="mt-1.5 flex items-center gap-1.5" data-testid="ordenes-controles">
                            <select
                              class="min-w-0 flex-1 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs
                                     text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                              [value]="filtroEstado()"
                              (change)="cambiarFiltro($any($event.target).value)"
                              data-testid="filtro-estado"
                            >
                              <option value="todos">{{ t().filterAll }} ({{ totalOrdenes() }})</option>
                              @for (opcion of gruposDeOrdenes(); track opcion.nombre) {
                                <option [value]="opcion.nombre">
                                  {{ t()[opcion.nombre] }} ({{ opcion.ordenes.length }})
                                </option>
                              }
                            </select>
                            <button
                              type="button"
                              (click)="alternarOrden()"
                              class="shrink-0 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs
                                     text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800
                                     dark:text-gray-100 dark:hover:bg-gray-700"
                              [attr.aria-label]="t().sortAz + ' / ' + t().sortRecent"
                              [attr.title]="etiquetaOrden()"
                              data-testid="orden-ot"
                            >
                              <span aria-hidden="true">⇅</span> {{ etiquetaOrden() }}
                            </button>
                          </div>

                          @for (grupo of gruposVisibles(); track grupo.nombre) {
                            <!--
                              La cabecera es un botón: pliega el grupo. El chevron rota 90°
                              cuando está abierto y aria-expanded lo anuncia.
                            -->
                            <button
                              type="button"
                              class="sticky top-0 z-10 -mx-1 mt-1 flex w-full cursor-pointer items-center gap-1
                                     bg-white px-1 py-0.5 text-left text-xs font-medium text-gray-700
                                     hover:text-gray-900 dark:bg-gray-900 dark:text-gray-200 dark:hover:text-white"
                              [attr.data-testid]="'grupo-' + grupo.nombre"
                              [attr.aria-expanded]="!estaPlegado(grupo.nombre)"
                              (click)="alternarGrupo(grupo.nombre)"
                            >
                              <span
                                class="inline-block w-3 shrink-0 transition-transform"
                                [class.rotate-90]="!estaPlegado(grupo.nombre)"
                                aria-hidden="true"
                              >▸</span>
                              {{ t()[grupo.nombre] }} ({{ grupo.ordenes.length }})
                            </button>

                            @if (!estaPlegado(grupo.nombre)) {
                              <ul class="mt-0.5 flex flex-col gap-1" data-testid="grupo-lista">
                                @for (item of grupo.ordenes; track item.orden.numero_ot) {
                                  <li
                                    class="rounded border border-gray-200 px-2 py-1 dark:border-gray-700"
                                    data-testid="orden-item"
                                  >
                                    <div class="flex items-center gap-1">
                                      <span
                                        class="truncate text-xs font-medium text-gray-800 dark:text-gray-100"
                                        data-testid="orden-numero"
                                      >{{ item.orden.numero_ot }}</span>
                                      <span
                                        class="ml-auto shrink-0 rounded px-1 text-[10px]"
                                        [class]="item.color"
                                        data-testid="orden-estado"
                                      >{{ item.etiqueta }}</span>
                                    </div>
                                    <!-- Badge rojo de vencida (CGBIDA-378) -->
                                    @if (item.vencida) {
                                      <span
                                        class="mt-1 inline-block rounded bg-red-600 px-1 text-[10px] font-semibold text-white"
                                        data-testid="orden-vencida"
                                      >{{ t().overdueBadge }}</span>
                                    }
                                    <button
                                      type="button"
                                      data-testid="orden-ver-detalle"
                                      (click)="abrirDetalleOt(item.orden)"
                                      class="mt-1 block text-[11px] text-blue-700 underline hover:text-blue-900 dark:text-blue-200 dark:hover:text-white"
                                    >{{ t().viewOrderDetail }}</button>
                                  </li>
                                }
                              </ul>
                            }
                          }
                        } @else {
                          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400" data-testid="ordenes-vacio">
                            {{ t().ordersEmpty }}
                          </p>
                        }
                      }
                    }
                  </div>
                }

                <!-- CGBIDA-384: hijos del nodo, para Planta y Disciplina -->
                @if (n.tipo !== 'Máquina') {
                  <div class="mt-3 border-t border-gray-100 pt-2 dark:border-gray-700">
                    <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {{ t().childrenTitle }}
                    </p>

                    @switch (estadoDetalle()) {
                      @case ('cargando') {
                        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400" data-testid="hijos-cargando">
                          {{ t().childrenLoading }}
                        </p>
                      }
                      @case ('error') {
                        <p class="mt-2 text-sm text-red-700 dark:text-red-300" data-testid="hijos-error">
                          {{ t().childrenError }}
                        </p>
                      }
                      @default {
                        @if (hijos().length) {
                          <ul class="mt-2 flex flex-col gap-1">
                            @for (hijo of hijos(); track hijo.nodo_id) {
                              <li>
                                <button
                                  type="button"
                                  data-testid="hijo-item"
                                  [attr.data-nodo-id]="hijo.nodo_id"
                                  (click)="seleccionarHijo(hijo)"
                                  class="flex w-full items-center gap-2 rounded border border-gray-200 px-2 py-1 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                                >
                                  <span
                                    class="inline-block w-2 h-2 shrink-0 rounded-full"
                                    [style.background-color]="colorDe(hijo.estado_actual)"
                                  ></span>
                                  <span class="truncate text-xs text-gray-800 dark:text-gray-100">{{ hijo.nombre_visual }}</span>
                                  <span class="ml-auto shrink-0 text-[10px] text-gray-500 dark:text-gray-400">{{ hijo.tipo }}</span>
                                </button>
                              </li>
                            }
                          </ul>
                        } @else {
                          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400" data-testid="hijos-vacio">
                            {{ t().childrenEmpty }}
                          </p>
                        }
                      }
                    }
                  </div>
                }

                <button
                  type="button"
                  data-testid="panel-cerrar"
                  (click)="cerrarPanel()"
                  class="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"
                >{{ t().closePanel }}</button>
              </div>
            }

            <!-- CGBIDA-385: el detalle de una OT es un sheet, no una ruta.
                 Se reutiliza el componente que ya usa el listado de OTs. -->
            @if (otEnDetalle(); as ot) {
              <app-ot-detail-sheet
                [order]="ot"
                (closed)="cerrarDetalleOt()"
                (changeRequested)="cerrarDetalleOt()"
              />
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

  /**
   * Rectángulo que contiene todos los nodos, con padding.
   *
   * Es la vista inicial y el destino del botón de reset. Se calcula a partir de las
   * posiciones que manda el backend, no de una constante: el mapa crece y se mueve, y una
   * vista fija deja nodos fuera de cuadro sin que nadie se entere.
   */
  protected readonly cajaContenido = computed(() => {
    const nodos = this.nodos();
    if (nodos.length === 0) return null;

    const minX = Math.min(...nodos.map((n) => n.pos_x));
    const minY = Math.min(...nodos.map((n) => n.pos_y));
    const maxX = Math.max(...nodos.map((n) => n.pos_x + NODE_W));
    const maxY = Math.max(...nodos.map((n) => n.pos_y + NODE_H));

    return {
      x: minX - PADDING_VISTA,
      y: minY - PADDING_VISTA,
      w: maxX - minX + 2 * PADDING_VISTA,
      h: maxY - minY + 2 * PADDING_VISTA,
    };
  });

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
    // Vuelve al encuadre que contiene el grafo, no a una constante: si el mapa cambió,
    // el reset debe mostrar el mapa nuevo completo.
    const caja = this.cajaContenido();
    this.viewBox.set(caja ? { ...caja } : { ...INITIAL_VIEW });
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
    this.pila.set([nodo]);
  }

  protected cerrarPanel(): void {
    this.seleccionado.set(null);
    this.pila.set([]);
    this.otEnDetalle.set(null);
  }

  // --- CGBIDA-384: navegación por la jerarquía -------------------------------

  /**
   * Pila de nodos visitados, para poder volver al padre.
   * DEBE ser una señal: `esBotonVolver` es un `computed` y con un array plano se
   * memorizaría con el valor de la primera lectura (no hay señal que lo invalide).
   */
  private readonly pila = signal<TopologyNode[]>([]);

  protected readonly esBotonVolver = computed(() => this.pila().length > 1);

  /** Cambia el nodo del panel a uno de sus hijos (CGBIDA-384). */
  protected seleccionarHijo(hijo: TopologyNode): void {
    this.seleccionado.set(hijo);
    this.pila.update((p) => [...p, hijo]);
  }

  protected volver(): void {
    this.pila.update((p) => p.slice(0, -1));
    const pila = this.pila();
    this.seleccionado.set(pila[pila.length - 1] ?? null);
  }

  // --- CGBIDA-382/383: detalle del nodo, órdenes e hijos ---------------------

  /**
   * Detalle del nodo seleccionado. Se recarga cada vez que cambia la selección,
   * así que navegar a un hijo pide el detalle de ese hijo.
   */
  private readonly detalle = signal<TopologyNodoDetalle | null>(null);

  private readonly cargandoDetalle = signal(false);
  private readonly errorDetalle = signal(false);

  constructor() {
    // Encuadre inicial: cuando llegan los nodos, la cámara se ajusta al grafo completo.
    // Corre una sola vez porque `cajaContenido` depende únicamente de `nodos`, que se
    // resuelve con la carga; después el usuario manda con el zoom y el paneo.
    effect(() => {
      const caja = this.cajaContenido();
      if (caja) this.viewBox.set(caja);
    });

    effect((onCleanup) => {
      const nodo = this.seleccionado();
      if (!nodo) {
        this.detalle.set(null);
        this.errorDetalle.set(false);
        return;
      }
      this.cargandoDetalle.set(true);
      const sub = this.topologyService.getNodo(nodo.nodo_id).subscribe({
        next: (d) => {
          this.detalle.set(d);
          this.errorDetalle.set(false);
          this.cargandoDetalle.set(false);
        },
        error: () => {
          this.errorDetalle.set(true);
          this.cargandoDetalle.set(false);
        },
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  /** `listo` solo cuando el detalle cargado corresponde al nodo seleccionado. */
  private readonly detalleDelSeleccionado = computed(() => {
    const d = this.detalle();
    const n = this.seleccionado();
    return d && n && d.nodo.nodo_id === n.nodo_id ? d : null;
  });

  protected readonly estadoDetalle = computed<'cargando' | 'error' | 'listo'>(() => {
    if (this.errorDetalle()) return 'error';
    return this.detalleDelSeleccionado() ? 'listo' : 'cargando';
  });

  protected readonly hijos = computed<TopologyNode[]>(
    () => this.detalleDelSeleccionado()?.hijos ?? [],
  );

  /**
   * Órdenes agrupadas para el panel. La agrupación la decide `filterGroup()`, no este
   * componente: si se reimplementara aquí, el panel y el listado de OTs podrían
   * discrepar sobre en qué grupo cae `assigned` u `overdue` (CGBIDA-378, D1).
   */
  protected readonly gruposDeOrdenes = computed<GrupoEnPanel[]>(() => {
    const ordenes = this.detalleDelSeleccionado()?.ordenes ?? [];
    const porGrupo = new Map<GrupoOt, OtEnPanel[]>();

    for (const orden of ordenes) {
      const clave = CLAVE_GRUPO[filterGroup(orden.estado as WorkOrderStatus)] ?? 'groupPendientes';
      const lista = porGrupo.get(clave) ?? [];
      lista.push({
        orden,
        // `overdue` va en Pendientes pero con badge rojo (CGBIDA-378).
        vencida: orden.estado === 'overdue',
        etiqueta: ETIQUETA_OT[orden.estado] ?? orden.estado,
        color: COLOR_OT[orden.estado] ?? COLOR_OT['pending'],
      });
      porGrupo.set(clave, lista);
    }

    // El Map conserva el orden de inserción, así que se recorren los grupos en el
    // orden de presentación y se descartan los vacíos.
    return ORDEN_GRUPOS.filter((g) => porGrupo.has(g)).map((nombre) => ({
      nombre,
      ordenes: porGrupo.get(nombre)!,
    }));
  });

  /** Grupo elegido en el selector. `todos` deja el listado completo. */
  protected readonly filtroEstado = signal<GrupoOt | 'todos'>('todos');

  /** Orden aplicado DENTRO de cada grupo; el orden de los grupos no cambia. */
  protected readonly ordenOt = signal<OrdenOt>('recientes');

  /**
   * Grupos plegados.
   *
   * «Cerradas» y «Canceladas» arrancan cerradas porque son las que sepultan lo accionable:
   * con 26 cerradas, las 2 pendientes y la 1 en curso quedaban a cuatro pantallas de scroll
   * en un panel de 476 px.
   */
  private readonly plegados = signal<Record<GrupoOt, boolean>>({
    groupPendientes: false,
    groupEnCurso: false,
    groupCerradas: true,
    groupCanceladas: true,
  });

  protected estaPlegado(grupo: GrupoOt): boolean {
    return this.plegados()[grupo];
  }

  protected alternarGrupo(grupo: GrupoOt): void {
    this.plegados.update((p) => ({ ...p, [grupo]: !p[grupo] }));
  }

  protected cambiarFiltro(valor: string): void {
    this.filtroEstado.set(valor === 'todos' ? 'todos' : (valor as GrupoOt));
  }

  protected alternarOrden(): void {
    this.ordenOt.update((o) => (o === 'az' ? 'recientes' : 'az'));
  }

  /** Etiqueta del botón de orden: muestra el criterio activo, no el que aplicaría. */
  protected readonly etiquetaOrden = computed(() =>
    this.ordenOt() === 'az' ? this.t().sortAz : this.t().sortRecent,
  );

  /** Total de OTs del equipo, para el contador de la opción «Todos». */
  protected readonly totalOrdenes = computed(() =>
    this.gruposDeOrdenes().reduce((n, g) => n + g.ordenes.length, 0),
  );

  /**
   * Grupos tal como se pintan: filtrados por estado y con las OTs ordenadas por dentro.
   *
   * El filtro NO reordena los grupos ni los fusiona: sólo descarta los que no coinciden.
   */
  protected readonly gruposVisibles = computed<GrupoEnPanel[]>(() => {
    const filtro = this.filtroEstado();
    const orden = this.ordenOt();
    const grupos = this.gruposDeOrdenes();
    const visibles = filtro === 'todos' ? grupos : grupos.filter((g) => g.nombre === filtro);

    const comparar = (a: OtEnPanel, b: OtEnPanel): number => {
      if (orden === 'az') return a.orden.numero_ot.localeCompare(b.orden.numero_ot);
      // Más recientes primero. Una fecha ilegible cae al final en vez de romper el orden.
      const fa = Date.parse(a.orden.created_at) || 0;
      const fb = Date.parse(b.orden.created_at) || 0;
      return fb - fa;
    };

    return visibles.map((g) => ({ ...g, ordenes: [...g.ordenes].sort(comparar) }));
  });

  // --- CGBIDA-385: detalle de una OT -----------------------------------------

  /** OT abierta en el sheet de detalle. El sheet se reutiliza, no se reimplementa. */
  protected readonly otEnDetalle = signal<WorkOrder | null>(null);

  protected abrirDetalleOt(orden: WorkOrder): void {
    this.otEnDetalle.set(orden);
  }

  protected cerrarDetalleOt(): void {
    this.otEnDetalle.set(null);
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



