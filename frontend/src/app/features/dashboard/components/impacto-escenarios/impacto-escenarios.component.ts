import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImpactoAnual } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { CurrencyService } from '../../../../core/services/currency.service';

/**
 * Escenarios de Impacto Anual (CGBIDA-436).
 *
 * REEMPLAZA al gráfico de Tiempo de Resolución, que era redundante: el ranking de equipos
 * ya grafica `machines[].mttr` cuando se elige esa métrica. Este gráfico responde una
 * pregunta que ningún otro respondía — cuánto cuesta operar sin BARB frente a con BARB —
 * usando solo el campo `impacto_anual` que el endpoint ya devolvía.
 *
 * Lectura del gráfico:
 *  - Barra superior (roja): costo proyectado a 12 meses sin BARB.
 *  - Barra inferior (verde): lo que cuesta con BARB.
 *  - El tramo rayado entre ambas es el ahorro, que es la diferencia.
 *
 * Respeta `impacto_visible`: con menos de 90 días de historial el backend devuelve null y
 * aquí se muestra el aviso, no dos barras en cero.
 */
@Component({
  selector: 'app-impacto-escenarios',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <figure
        class="relative rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
        data-testid="impacto-escenarios"
      >
        <figcaption class="mb-2">
          <h3 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">
            {{ t().impactChartTitle }}
          </h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t().impactChartSub }}</p>
        </figcaption>

        <svg
          [attr.viewBox]="'0 0 ' + ANCHO + ' ' + ALTO"
          class="w-full"
          role="img"
          [attr.aria-label]="t().impactChartTitle"
        >
          <!-- Barra SIN BARB: es la referencia, ocupa el ancho util completo. -->
          <text
            [attr.x]="PAD_IZQ - 10" [attr.y]="Y_SIN + ALTURA_BARRA / 2 + 4"
            text-anchor="end" font-size="11"
            class="fill-gray-600 dark:fill-gray-300"
          >{{ t().withoutBarb }}</text>
          <rect
            [attr.x]="PAD_IZQ" [attr.y]="Y_SIN"
            [attr.width]="anchoUtil" [attr.height]="ALTURA_BARRA"
            rx="4" [attr.fill]="COLOR_SIN"
            data-testid="barra-sin-barb"
          />
          <text
            [attr.x]="ANCHO - PAD_DER - 8" [attr.y]="Y_SIN + ALTURA_BARRA / 2 + 4"
            text-anchor="end" font-size="11" font-weight="700" fill="#ffffff"
            data-testid="valor-sin-barb"
          >{{ valorSin() }}</text>

          <!-- Tramo que se ahorra: de lo que cuesta con BARB hasta lo que costaria sin el. -->
          <rect
            [attr.x]="PAD_IZQ + anchoCon()" [attr.y]="Y_CON"
            [attr.width]="Math.max(0, anchoUtil - anchoCon())" [attr.height]="ALTURA_BARRA"
            rx="4" [attr.fill]="COLOR_AHORRO" [attr.fill-opacity]="0.35"
            data-testid="tramo-ahorro"
          />

          <!-- Barra CON BARB. -->
          <text
            [attr.x]="PAD_IZQ - 10" [attr.y]="Y_CON + ALTURA_BARRA / 2 + 4"
            text-anchor="end" font-size="11"
            class="fill-gray-600 dark:fill-gray-300"
          >{{ t().withBarb }}</text>
          <rect
            [attr.x]="PAD_IZQ" [attr.y]="Y_CON"
            [attr.width]="anchoCon()" [attr.height]="ALTURA_BARRA"
            rx="4" [attr.fill]="COLOR_CON"
            data-testid="barra-con-barb"
          />
          <text
            [attr.x]="PAD_IZQ + anchoCon() - 8" [attr.y]="Y_CON + ALTURA_BARRA / 2 + 4"
            text-anchor="end" font-size="11" font-weight="700" fill="#ffffff"
            data-testid="valor-con-barb"
          >{{ valorCon() }}</text>

          <!-- Etiqueta del ahorro, debajo y alineada al tramo. -->
          <text
            [attr.x]="PAD_IZQ + anchoUtil" [attr.y]="ALTO - 8"
            text-anchor="end" font-size="11" font-weight="700"
            class="fill-emerald-600 dark:fill-emerald-400"
            data-testid="valor-ahorro"
          >{{ t().impactSavingsLabel }}: {{ valorAhorro() }}</text>
        </svg>
      </figure>
    } @else {
      <!--
        Sin historial suficiente se mantiene la tarjeta, no un parrafo suelto: si el
        mensaje queda sin marco, la celda del grid parece rota al lado de las demas.
      -->
      <figure
        class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
        data-testid="impacto-escenarios-vacio"
      >
        <figcaption class="mb-2">
          <h3 class="text-sm font-extrabold text-gray-800 dark:text-gray-100">
            {{ t().impactChartTitle }}
          </h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t().impactChartSub }}</p>
        </figcaption>
        <p class="text-sm text-amber-600 dark:text-amber-400" data-testid="impacto-vacio">
          {{ t().impactNoHistory }}
        </p>
      </figure>
    }
  `
})
export class ImpactoEscenariosComponent {
  private i18n = inject(I18nService);
  private currency = inject(CurrencyService);

  /** Impacto anual tal como lo entrega el endpoint. Puede faltar mientras carga. */
  readonly impacto = input.required<ImpactoAnual | null>();

  protected readonly t = computed(() => this.i18n.tree().financial);

  // Mismas proporciones que el gráfico al que reemplaza, para que la fila del grid no
  // cambie de alto y el dashboard siga entrando en 1080 px.
  protected readonly ANCHO = 720;
  protected readonly ALTO = 190;
  protected readonly PAD_IZQ = 120;
  protected readonly PAD_DER = 16;
  protected readonly ALTURA_BARRA = 34;
  private readonly PAD_SUP = 22;

  protected readonly Y_SIN = 44;
  protected readonly Y_CON = 104;

  protected readonly COLOR_SIN = '#c0281e';
  protected readonly COLOR_CON = '#059669';
  protected readonly COLOR_AHORRO = '#10b981';

  protected readonly Math = Math;

  protected readonly anchoUtil = this.ANCHO - this.PAD_IZQ - this.PAD_DER;

  /** Solo se dibuja si el backend dice que hay historial suficiente. */
  protected readonly visible = computed(() => {
    const i = this.impacto();
    if (!i) return false;
    return (
      i.impacto_visible &&
      typeof i.escenario_sin_barb === 'number' &&
      typeof i.escenario_con_barb === 'number' &&
      i.escenario_sin_barb > 0
    );
  });

  private readonly sinBarb = computed(() => this.impacto()?.escenario_sin_barb ?? 0);
  private readonly conBarb = computed(() => this.impacto()?.escenario_con_barb ?? 0);

  /** La barra "sin BARB" es la referencia: siempre ocupa el ancho completo. */
  protected readonly anchoCon = computed(() => {
    const sin = this.sinBarb();
    if (sin <= 0) return 0;
    return Math.max(0, Math.min(this.anchoUtil, (this.anchoUtil * this.conBarb()) / sin));
  });

  // Los montos se formatean con el servicio de moneda para que el toggle CLP/USD alcance
  // también a este gráfico.
  protected readonly valorSin = computed(() => this.currency.formatear(this.sinBarb()));
  protected readonly valorCon = computed(() => this.currency.formatear(this.conBarb()));
  protected readonly valorAhorro = computed(() =>
    this.currency.formatear(this.impacto()?.ahorro_proyectado ?? 0)
  );
}
