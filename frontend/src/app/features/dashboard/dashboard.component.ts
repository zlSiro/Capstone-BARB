import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsService } from '../../core/services/stats.service';
import { FinancialStats } from '../../core/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { BacklogChartComponent } from './components/backlog-chart/backlog-chart.component';

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
  imports: [CommonModule, BacklogChartComponent],
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 dark:text-gray-100">{{ t().dashboardTitle }}</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t().dashboardSubtitle }}</p>
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
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (kpi of tarjetas(); track kpi.clave) {
            <div
              class="rounded-lg border border-gray-100 bg-white p-4 shadow-sm
                     dark:border-gray-700 dark:bg-gray-900"
              [attr.data-testid]="'kpi-' + kpi.clave"
            >
              <p class="text-xs uppercase text-gray-500 dark:text-gray-400">{{ kpi.etiqueta }}</p>
              <p class="mt-1 text-2xl font-bold" [class]="kpi.color">{{ kpi.valor }}</p>
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">{{ kpi.descripcion }}</p>
            </div>
          }
        </div>

        <!-- El gráfico se auto-oculta si no hay puntos, igual que el legacy. -->
        <app-backlog-chart [puntos]="tendencia()" />
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

  /** Textos del bloque `financial`. Reactivo al cambio de idioma. */
  protected readonly t = computed(() => this.i18n.tree().financial);

  /**
   * Tendencia de 14 dias para el grafico de backlog.
   *
   * Sale tal cual del backend: son siempre 14 puntos y NO dependen del selector de rango
   * temporal, porque el backend no parametriza esa serie (CGBIDA-391, decision (c)).
   */
  protected readonly tendencia = computed(() => this.stats()?.trend14Days ?? []);

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

  private cargar(): void {
    this.loading.set(true);
    this.error.set(false);
    this.statsService.getFinancialImpact('all').subscribe({
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
