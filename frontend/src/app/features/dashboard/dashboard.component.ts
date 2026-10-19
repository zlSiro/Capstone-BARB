import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsService } from '../../core/services/stats.service';
import { CurrencyService, Moneda } from '../../core/services/currency.service';
import { MtbfUnitService, UnidadMtbf } from '../../core/services/mtbf-unit.service';
import { FinancialStats } from '../../core/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { SaludOperacionalComponent } from './components/salud-operacional/salud-operacional.component';
import { MachineRankingComponent } from './components/machine-ranking/machine-ranking.component';
import { TipoDonutComponent } from './components/tipo-donut/tipo-donut.component';
import { AlertaEstancadasComponent } from './components/alerta-estancadas/alerta-estancadas.component';
import { ImpactoEscenariosComponent } from './components/impacto-escenarios/impacto-escenarios.component';

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
  imports: [CommonModule, MachineRankingComponent, TipoDonutComponent, AlertaEstancadasComponent, ImpactoEscenariosComponent, SaludOperacionalComponent],
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

        <!-- Moneda y rango temporal, juntos a la derecha de la cabecera. -->
        <div class="flex flex-wrap items-center justify-end gap-2">
          <!--
            Tasa aplicada y su fecha, ANTES del toggle (pedido de Rene): se lee
            [tipo de cambio] [CLP|USD], o sea primero el dato y despues el control que lo
            usa. Es lo que hace auditable la conversion: sin esto el usuario no sabe a que
            tipo de cambio se convirtieron las cifras.
          -->
          @if (currency.sinTasa()) {
            <p class="text-xs text-amber-600 dark:text-amber-400" data-testid="moneda-sin-tasa">
              {{ t().currencyNoRate }}
            </p>
          } @else if (currency.moneda() === 'USD') {
            <p class="text-xs text-gray-500 dark:text-gray-400" data-testid="moneda-tasa">
              {{ t().currencyRate }} {{ tasaTexto() }} CLP/USD
            </p>
          }

          <!--
            Toggle de moneda (CGBIDA-432). Los datos base estan en CLP; USD solo cambia
            la presentacion. Se usa aria-pressed y no un select porque son dos estados.
          -->
          <div
            class="flex items-center gap-1 rounded-lg border border-gray-300 p-0.5
                   dark:border-gray-700"
            role="group"
            [attr.aria-label]="t().currencyLabel"
            data-testid="selector-moneda"
          >
            @for (m of monedas; track m) {
              <button
                type="button"
                [attr.aria-pressed]="currency.moneda() === m"
                [attr.data-testid]="'moneda-' + m"
                (click)="cambiarMoneda(m)"
                [class]="currency.moneda() === m ? claseMonedaActiva : claseMonedaInactiva"
              >
                {{ m }}
              </button>
            }
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
          KPIs: 5 en una sola fila desde xl. Se quito el de Impacto Anual porque el
          grafico de escenarios de abajo ya lo explica con mas detalle; con 5 columnas
          cada tarjeta gana ancho y la fila queda continua (6 columnas dejaria un hueco).
        -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          @for (kpi of tarjetas(); track kpi.clave) {
            <div
              class="rounded-lg border border-gray-100 bg-white p-3 shadow-sm
                     dark:border-gray-700 dark:bg-gray-900"
              [attr.data-testid]="'kpi-' + kpi.clave"
            >
              <div class="flex items-start justify-between gap-1">
                <div class="flex min-w-0 items-center gap-1">
                  <p class="truncate text-xs uppercase text-gray-500 dark:text-gray-400">
                    {{ kpi.etiqueta }}
                  </p>
                  <!--
                    Selector de unidad del MTBF (CGBIDA-435). Va en la MISMA linea de la
                    etiqueta y con alto fijo de 16 px, para no sumar altura: el dashboard
                    esta en 0 px de desborde y un renglon mas lo rompe.
                  -->
                  @if (kpi.clave === 'mtbf') {
                    <select
                      [attr.aria-label]="t().mtbfUnitLabel"
                      [attr.data-testid]="'selector-unidad-mtbf'"
                      (change)="cambiarUnidadMtbf($any($event.target).value)"
                      class="h-4 shrink-0 cursor-pointer rounded border border-gray-300
                             bg-transparent px-0.5 text-[10px] leading-none
                             text-gray-600 outline-none focus:border-blue-500
                             dark:border-gray-600 dark:text-gray-300"
                    >
                      @for (u of unidadesMtbf; track u) {
                        <option [value]="u" [selected]="u === mtbf.unidad()"
                                [attr.data-testid]="'unidad-' + u">
                          {{ etiquetaUnidadMtbf(u) }}
                        </option>
                      }
                    </select>
                  }
                </div>
                @if (kpi.tooltip) {
                  <!--
                    Tooltip de formula (CGBIDA-433). Va en un group para que se abra con
                    hover Y con foco de teclado: un title nativo no es accesible ni se ve
                    en una demo.
                  -->
                  <div class="group relative shrink-0">
                    <button
                      type="button"
                      class="flex h-4 w-4 items-center justify-center rounded-full border
                             border-gray-300 text-[9px] font-bold leading-none text-gray-500
                             transition-colors hover:border-blue-500 hover:text-blue-600
                             focus:border-blue-500 focus:text-blue-600 focus:outline-none
                             dark:border-gray-600 dark:text-gray-400"
                      [attr.aria-describedby]="'kpi-tip-' + kpi.clave"
                      [attr.aria-label]="kpi.etiqueta"
                      [attr.data-testid]="'info-kpi-' + kpi.clave"
                    >?</button>
                    <div
                      role="tooltip"
                      [id]="'kpi-tip-' + kpi.clave"
                      [attr.data-testid]="'tooltip-kpi-' + kpi.clave"
                      class="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 w-64
                             rounded-lg border border-gray-200 bg-white p-3 text-xs font-normal
                             normal-case leading-relaxed text-gray-600 shadow-lg
                             group-hover:visible group-focus-within:visible
                             dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >{{ kpi.tooltip }}</div>
                  </div>
                }
              </div>
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
          <!-- Salud Operacional (CGBIDA-435). Sustituye al grafico de backlog suelto:
               el indicador va como hero y la tendencia queda de minigrafico en la misma
               tarjeta, asi el dashboard sigue entrando sin scroll. -->
          <app-salud-operacional class="min-w-0" [salud]="salud()" [tendencia]="tendencia()" />

          <!-- El ranking muestra su propio estado vacío si no hay equipos. -->
          <app-machine-ranking class="min-w-0" [maquinas]="equipos()" />

          <!-- Dona por tipo de intervencion (CGBIDA-395). Se auto-oculta sin datos. -->
          <app-tipo-donut class="min-w-0" [datos]="porTipo()" />

          <!-- Escenarios de Impacto Anual (CGBIDA-436). Reemplaza al de resolucion,
               que duplicaba el ranking en su metrica MTTR. -->
          <app-impacto-escenarios class="min-w-0" [impacto]="impacto()" />
        </div>
      }
    </div>
  `
})
export class DashboardComponent implements OnInit {
  private statsService = inject(StatsService);
  private i18n = inject(I18nService);

  /** Moneda de presentación (CGBIDA-432). Los datos base son CLP. */
  protected readonly currency = inject(CurrencyService);

  /**
   * Unidad del MTBF (CGBIDA-435). Estado compartido con el semáforo: el mismo MTBF
   * aparece en la tarjeta y en el desglose de salud, y verlo en dos unidades distintas
   * se lee como un error.
   */
  protected readonly mtbf = inject(MtbfUnitService);

  /** Opciones del selector de unidad, en orden. */
  protected readonly unidadesMtbf: readonly UnidadMtbf[] = ['horas', 'dias', 'meses'];

  /** Opciones del toggle de moneda, en orden. */
  protected readonly monedas: readonly Moneda[] = ['CLP', 'USD'];

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

  /** Impacto anual, para el grafico de escenarios (CGBIDA-436). */
  protected readonly impacto = computed(() => this.stats()?.impacto_anual ?? null);

  /** Semaforo compuesto de salud operacional (CGBIDA-435). */
  protected readonly salud = computed(() => this.stats()?.salud_operacional ?? null);

  /** Ordenes estancadas para el banner. Un total de 0 lo oculta. */
  protected readonly estancadas = computed(
    () => this.stats()?.estancadas ?? { total: 0, vencidas: 0, demoradas: 0, umbral_dias: 0 }
  );

  /**
   * Las 5 tarjetas de KPI, derivadas de la respuesta.
   *
   * La descripcion (`*Sub`) es lo que pide la HU: que cada indicador diga que mide.
   * El MTBF tiene dos estados: valor, o aviso de que falta historial (`mtbf_visible`).
   *
   * La tarjeta de Impacto Anual se quito en CGBIDA-435: el grafico de escenarios de abajo
   * muestra la misma cifra con mas contexto, y su explicacion se mudo al grafico.
   */
  protected readonly tarjetas = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const f = s.financials;
    const imp = s.impacto_anual;
    const tx = this.t();
    const mtbfOk = f.mtbf_visible && f.mtbfHours !== null;

    // Moneda: los montos base estan en CLP y el servicio formatea en la activa.
    // Leer `formatear` dentro del computed lo hace reactivo al toggle.
    const cifra = (v: number) => this.currency.formatear(v);

    // Supuestos del modelo, tal como los entrega el backend. No se hardcodean: si manana
    // cambian en config.py, el tooltip sigue diciendo la verdad.
    // La cifra va en la MONEDA ACTIVA (CGBIDA-435): antes decia "CLP" fijo aunque el
    // toggle estuviera en dolares.
    const costoMin = imp.supuestos?.costo_por_minuto ?? 2000;
    const supuesto = this.currency.formatearDetalle(costoMin);
    const notaMoneda =
      this.currency.moneda() === 'USD' && !this.currency.sinTasa() ? ` ${tx.kpiUsdNote}` : '';

    return [
      {
        clave: 'mttr',
        etiqueta: tx.mttrGlobal,
        valor: `${f.mttr}m`,
        descripcion: tx.mttrSub,
        color: 'text-gray-800 dark:text-gray-100',
        tooltip: ''
      },
      {
        clave: 'sla',
        etiqueta: tx.efficiency,
        valor: `${f.efficiency}%`,
        descripcion: tx.efficiencySub,
        color: 'text-green-600 dark:text-green-400',
        tooltip: ''
      },
      {
        clave: 'costo',
        etiqueta: tx.directCost,
        valor: cifra(f.costo_total_acumulado),
        descripcion: tx.directCostSub,
        color: 'text-gray-800 dark:text-gray-100',
        tooltip: `${tx.kpiCostoTooltip}${notaMoneda}`
      },
      {
        clave: 'mtbf',
        etiqueta: tx.mtbf,
        // CGBIDA-435: la unidad la elige el usuario. El servicio convierte desde horas
        // y el sufijo sale de i18n, asi que la tarjeta no sabe de conversiones.
        valor: mtbfOk
          ? this.mtbf.formatear(f.mtbfHours as number, this.sufijoMtbf())
          : tx.mtbfNeedData,
        descripcion: tx.mtbfSub,
        color: mtbfOk
          ? 'text-gray-800 dark:text-gray-100'
          : 'text-xs font-medium text-amber-600 dark:text-amber-400',
        tooltip: ''
      },
      {
        clave: 'ahorro',
        etiqueta: tx.savingsGenerated,
        valor: cifra(f.ahorro_generado),
        descripcion: tx.savingsSub,
        color: 'text-orange-600 dark:text-orange-400',
        tooltip: `${tx.kpiAhorroTooltip} Supuesto: ${supuesto} por minuto.${notaMoneda}`
      }
    ];
  });

  ngOnInit() {
    // La tasa se pide en el componente, no en el servicio: asi el arranque es explicito
    // y los tests controlan cuando ocurre la peticion.
    void this.currency.asegurarTasa();
    this.cargar();
  }

  /** Cambia la moneda de presentación (CGBIDA-432). */
  protected cambiarMoneda(moneda: Moneda): void {
    this.currency.setMoneda(moneda);
  }

  /** Cambia la unidad del MTBF. El semáforo la refleja porque comparte el servicio. */
  protected cambiarUnidadMtbf(valor: string): void {
    if (valor === 'horas' || valor === 'dias' || valor === 'meses') {
      this.mtbf.setUnidad(valor);
    }
  }

  /** Etiqueta del selector de unidad, en el idioma activo. */
  protected etiquetaUnidadMtbf(u: UnidadMtbf): string {
    const t = this.t();
    switch (u) {
      case 'horas':
        return t.mtbfUnitHoras;
      case 'meses':
        return t.mtbfUnitMeses;
      default:
        return t.mtbfUnitDias;
    }
  }

  /** Sufijo corto que acompaña al valor del MTBF en la tarjeta. */
  protected readonly sufijoMtbf = computed(() => {
    const t = this.t();
    switch (this.mtbf.unidad()) {
      case 'horas':
        return t.mtbfUnitShortHoras;
      case 'meses':
        return t.mtbfUnitShortMeses;
      default:
        return t.mtbfUnitShortDias;
    }
  });

  /** Tasa vigente con dos decimales y coma decimal, como se lee en Chile. */
  protected readonly tasaTexto = computed(() => {
    const t = this.currency.tasa();
    if (t === null) return '';
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(t);
  });

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

  /**
   * Clases del boton de moneda.
   *
   * Se guardan como cadenas completas y se enlazan con [class] para que el estado activo
   * no dependa de que Tailwind genere variantes condicionales.
   */
  protected readonly claseMonedaActiva =
    'rounded px-2 py-1 text-xs font-semibold bg-blue-600 text-white';
  protected readonly claseMonedaInactiva =
    'rounded px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300';

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
}


