import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsService } from '../../core/services/stats.service';
import { FinancialStats } from '../../core/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { BacklogChartComponent } from './components/backlog-chart/backlog-chart.component';
import { MachineRankingComponent } from './components/machine-ranking/machine-ranking.component';
import { TipoDonutComponent } from './components/tipo-donut/tipo-donut.component';
import { AlertaEstancadasComponent } from './components/alerta-estancadas/alerta-estancadas.component';
import { TiempoResolucionComponent } from './components/tiempo-resolucion/tiempo-resolucion.component';

/** Rangos del selector temporal (CGBIDA-397). `'all'` = histórico completo. */
export type RangoTemporal = 7 | 30 | 90 | 'all';

/**
 * Dashboard de KPIs (HU-08 + HU-16 / CGBIDA-392 y 393).
 *
 * Los 6 indicadores en tarjetas, cada una con su valor y la descripcion de QUE mide.
 * Debajo, el grafico de backlog de 14 dias.
 *
 * El texto sale de i18n (es/en) y todo tiene variantes de modo oscuro.
 *
 * Estados:
 *  - Cargando: texto explicito, nunca ceros.
 *  - Error: mensaje claro. Esta rama era INALCANZABLE antes de CGBIDA-403, porque el
 *    backend devolvia HTTP 200 con ceros y el error nunca llegaba. Ahora devuelve 503/500.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, BacklogChartComponent, MachineRankingComponent, TipoDonutComponent, AlertaEstancadasComponent, TiempoResolucionComponent],
  template: `
    <!--
      max-w-screen-2xl (1536px) + mx-auto: sin esto el dashboard se estiraba al 100% del
      ancho y en monitores anchos las tarjetas quedaban desproporcionadas y los graficos
      con demasiado aire. 1536px es el ancho estandar de dashboard de Tailwind y deja
      margen a los dos lados en un monitor de 1920.
    -->
    <div class="mx-auto flex w-full max-w-screen-2xl flex-col gap-3">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-gray-800 dark:text-gray-100">{{ t().dashboardTitle }}</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t().dashboardSubtitle }}</p>
        </div>

        <!-- Selector de rango temporal (CGBIDA-397). Replica el select del legacy. -->
        <div>
          <label for="rango-temporal" class="sr-only">{{ tr().rangeLabel }}</label>
          <select
            id="rango-temporal"
            data-testid="selector-rango"
            (change)="cambiarRango($any($event.target).value)"
            class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs
                   text-gray-700 outline-none transition-colors focus:border-blue-500
                   dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            @for (r of rangos; track r) {
              <option [value]="r" [selected]="r === rango()" [attr.data-testid]="'rango-' + r">
                {{ etiquetaRango(r) }}
              </option>
            }
          </select>
        </div>
      </div>

      @if (loading()) {
        <div class="py-10 text-center text-gray-500 dark:text-gray-400" role="status">
          {{ t().loading }}
        </div>
      } @else if (error()) {
        <div
          class="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-700
                 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          role="alert"
        >
          {{ t().loadError }}
        </div>
      } @else {
        <!-- Banner de estancadas (CGBIDA-396). Se auto-oculta si no hay ninguna. -->
        <app-alerta-estancadas [datos]="estancadas()" />
        <!--
          KPIs: en pantallas anchas van las 6 en una sola fila, como el legacy
          (.dash-kpi-grid: repeat(4, 1fr)). En dos filas de tres ocupaban 228 px de alto y
          eran lo que empujaba el resto del dashboard fuera de la pantalla.
        -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          @for (kpi of tarjetas(); track kpi.clave) {
            <div
              class="rounded-lg border border-gray-100 bg-white p-3 shadow-sm
                     dark:border-gray-700 dark:bg-gray-900"
              [attr.data-testid]="'kpi-' + kpi.clave"
            >
              <p class="text-xs uppercase text-gray-500 dark:text-gray-400">{{ kpi.etiqueta }}</p>
              <p class="mt-1 text-2xl font-bold" [class]="kpi.color">{{ kpi.valor }}</p>
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ kpi.descripcion }}</p>
            </div>
          }
        </div>

        <!--
          Gráficos en grid, como el legacy (Dashboard.tsx:290 + .dash-charts-grid).

          Con los gráficos apilados a todo el ancho, cada SVG con w-full se escalaba al
          ancho de la pantalla: el backlog mide 720x240 y el ranking 420x240, así que a
          1536 px quedaban de 512 y 878 px de alto. De ahí la sensación de "gigante".

          En dos columnas cada uno vuelve a su tamaño natural: el backlog queda en ~253 px
          de alto y el ranking en ~297 px. La dona va abajo ocupando las dos columnas,
          porque su contenido (dona de 200 px + leyenda de 214 px) es angosto y se centra.
        -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <!-- El gráfico se auto-oculta si no hay puntos, igual que el legacy. -->
          <app-backlog-chart class="min-w-0" [puntos]="tendencia()" />

          <!-- El ranking muestra su propio estado vacío si no hay equipos. -->
          <app-machine-ranking class="min-w-0" [maquinas]="equipos()" />

          <!-- Dona por tipo de intervencion (CGBIDA-395). Se auto-oculta sin datos. -->
          <app-tipo-donut class="min-w-0" [datos]="porTipo()" />

          <!-- Tiempo de resolución por máquina (CGBIDA-400), como el legacy. -->
          <app-tiempo-resolucion class="min-w-0" [maquinas]="equipos()" />
        </div>
      }
    </div>
  `
})
export class DashboardComponent implements OnInit {
  private statsService = inject(StatsService);
  private i18n = inject(I18nService);

  stats = signal<FinancialStats | null>(null);
  loading = signal(true);
  error = signal(false);

  /**
   * Rango temporal elegido (CGBIDA-397).
   *
   * Arranca en histórico completo, igual que el legacy (`Dashboard.tsx:123`). El valor
   * viaja al endpoint como `days`; `'all'` no manda el parámetro.
   */
  protected readonly rango = signal<RangoTemporal>('all');

  /** Opciones del selector, en el orden del legacy. */
  protected readonly rangos: readonly RangoTemporal[] = [7, 30, 90, 'all'];

  /** Textos del bloque `dashboard` (títulos, avisos y etiquetas del selector). */
  protected readonly tr = computed(() => this.i18n.tree().dashboard);

  /**
   * Etiqueta legible de cada rango. Las claves ya existían en i18n porque el legacy
   * también las tenía (`last7Days`, `last30Days`, `last90Days`, `allTime`).
   */
  protected etiquetaRango(r: RangoTemporal): string {
    const t = this.tr();
    switch (r) {
      case 7:
        return t.last7Days;
      case 30:
        return t.last30Days;
      case 90:
        return t.last90Days;
      default:
        return t.allTime;
    }
  }

  /** Textos del bloque `financial`. Reactivo al cambio de idioma. */
  protected readonly t = computed(() => this.i18n.tree().financial);

  /**
   * Tendencia de 14 dias para el grafico de backlog.
   *
   * Sale tal cual del backend: son siempre 14 puntos y NO dependen del selector de rango
   * temporal, porque el backend no parametriza esa serie (CGBIDA-391, decision (c)).
   */
  protected readonly tendencia = computed(() => this.stats()?.trend14Days ?? []);

  /** Equipos del ranking. El backend ya los limita a 5. */
  protected readonly equipos = computed(() => this.stats()?.machines ?? []);

  /** Distribucion por tipo de intervencion, para la dona. */
  protected readonly porTipo = computed(() => this.stats()?.por_tipo ?? []);

  /** Ordenes estancadas para el banner. Un total de 0 lo oculta. */
  protected readonly estancadas = computed(
    () => this.stats()?.estancadas ?? { total: 0, vencidas: 0, demoradas: 0, umbral_dias: 0 }
  );

  /**
   * Las 6 tarjetas de KPI, derivadas de la respuesta.
   *
   * La descripcion (`*Sub`) es lo que pide la HU: que cada indicador diga que mide.
   * El MTBF tiene dos estados: valor, o aviso de que falta historial (`mtbf_visible`).
   * El impacto anual tambien: valor, o aviso de que el rango no alcanza.
   */
  protected readonly tarjetas = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const f = s.financials;
    const imp = s.impacto_anual;
    const tx = this.t();
    const mtbfOk = f.mtbf_visible && f.mtbfHours !== null;
    const impactoOk = imp.impacto_visible && imp.ahorro_proyectado !== null;

    return [
      {
        clave: 'mttr',
        etiqueta: tx.mttrGlobal,
        valor: `${f.mttr}m`,
        descripcion: tx.mttrSub,
        color: 'text-gray-800 dark:text-gray-100'
      },
      {
        clave: 'sla',
        etiqueta: tx.efficiency,
        valor: `${f.efficiency}%`,
        descripcion: tx.efficiencySub,
        color: 'text-green-600 dark:text-green-400'
      },
      {
        clave: 'costo',
        etiqueta: tx.directCost,
        valor: this.moneda(f.costo_total_acumulado),
        descripcion: tx.directCostSub,
        color: 'text-gray-800 dark:text-gray-100'
      },
      {
        clave: 'mtbf',
        etiqueta: tx.mtbf,
        // El flag es lo que permite distinguir "el rango no alcanza" de "hay pocas
        // fallas": ambos casos dan mtbfHours null.
        valor: mtbfOk ? `${f.mtbfHours} h` : tx.mtbfNeedData,
        descripcion: tx.mtbfSub,
        color: mtbfOk
          ? 'text-gray-800 dark:text-gray-100'
          : 'text-sm font-medium text-amber-600 dark:text-amber-400'
      },
      {
        clave: 'ahorro',
        etiqueta: tx.savingsGenerated,
        valor: this.moneda(f.ahorro_generado),
        descripcion: tx.savingsSub,
        color: 'text-orange-600 dark:text-orange-400'
      },
      {
        clave: 'impacto',
        etiqueta: tx.impactCardTitle,
        valor: impactoOk ? this.moneda(imp.ahorro_proyectado as number) : tx.impactNoData,
        // `supuestos_incompletos` avisa de que se proyecto con el supuesto del modelo en
        // vez de con un tiempo medido. Se refleja para no presentarlo como dato duro.
        descripcion: imp.supuestos_incompletos
          ? `${tx.impactCardSub} (${tx.estimated})`
          : tx.impactCardSub,
        color: impactoOk
          ? 'text-blue-700 dark:text-blue-400'
          : 'text-sm font-medium text-amber-600 dark:text-amber-400'
      }
    ];
  });

  ngOnInit() {
    this.cargar();
  }

  /**
   * Cambia el rango temporal y vuelve a pedir las metricas (CGBIDA-397).
   *
   * El endpoint ya aceptaba `days`; aca solo se conecta. `'all'` viaja como histórico
   * completo, igual que en el legacy (`Dashboard.tsx:123`).
   */
  protected cambiarRango(valor: string): void {
    const nuevo: RangoTemporal = valor === 'all' ? 'all' : (Number(valor) as 7 | 30 | 90);
    if (nuevo === this.rango()) return;
    this.rango.set(nuevo);
    this.cargar();
  }

  private cargar(): void {
    this.loading.set(true);
    this.error.set(false);
    this.statsService.getFinancialImpact(this.rango()).subscribe({
      next: (data) => {
        this.stats.set(data);
        this.loading.set(false);
      },
      error: () => {
        // No se muestran ceros: se muestra que no se pudo cargar.
        this.error.set(true);
        this.loading.set(false);
      }
    });
  }

  /**
   * Formatea en CLP. Se mantiene el formato que ya usaba el dashboard.
   *
   * NOTA: el rotulo del supuesto dice "US$" (bloque `financial`, roiSubtitle) y el
   * formato es CLP. Es el desajuste de moneda documentado en CGBIDA-410, anexo A.1. No
   * se corrige aqui porque cambiarlo altera todas las cifras visibles y es una decision
   * de producto, no de esta subtarea.
   */
  private moneda(v: number): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(v);
  }
}
