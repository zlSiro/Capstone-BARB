import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EstancadasData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';

/**
 * Banner de órdenes estancadas (HU-16 / CGBIDA-396).
 *
 * Réplica del `dash-alert-banner` del legacy (`Dashboard.tsx:271-286`): icono de alerta,
 * título con la cifra y cuerpo con la acción sugerida, en la familia del rojo.
 *
 * El legacy NO estaba traducido: su texto estaba escrito en español dentro del JSX
 * ("Atención: Tienes N Órdenes de Trabajo estancadas o críticas"). Acá va por i18n.
 *
 * DESVÍOS DELIBERADOS DEL LEGACY (documentados):
 *  1. La definición de "estancada" es la del ticket, no la del legacy. El legacy usaba
 *     umbrales por prioridad (2 h para high/urgent, 24 h para el resto) sobre la duración
 *     de la OT. Acá: vencida (fecha_vencimiento pasada y estado no final) o demorada
 *     (más de 7 días en curso). Ver UMBRAL_ESTANCADA_DIAS en stats.py.
 *  2. Se agrega el desglose vencidas/demoradas, que el legacy no mostraba. El umbral de
 *     días lo manda el backend, así que si cambia, el texto cambia solo.
 *  3. El conteo no depende del selector de rango: es una foto del estado actual.
 */
@Component({
  selector: 'app-alerta-estancadas',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (datos().total > 0) {
      <div
        class="flex items-center gap-4 rounded-control border p-3
               border-peligro bg-peligro-suave text-peligro
                 
               max-sm:flex-col max-sm:items-start max-sm:gap-2"
        role="alert"
        data-testid="banner-estancadas"
      >
        <svg
          class="h-6 w-6 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
          data-testid="banner-icono"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          />
        </svg>

        <span class="sr-only">{{ t().stalledAlertLabel }}</span>

        <div class="min-w-0">
          <p class="text-[15px] font-semibold" data-testid="banner-titulo">
            {{ datos().total }} {{ t().stalledLabel }}
          </p>
          <p class="mt-1 text-sm opacity-90" data-testid="banner-cuerpo">
            {{ t().stalledBody }}
          </p>

          <ul class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="banner-desglose">
            @if (datos().vencidas > 0) {
              <li data-testid="banner-vencidas">
                <span class="font-medium">{{ t().stalledExpired }}:</span> {{ datos().vencidas }}
              </li>
            }
            @if (datos().demoradas > 0) {
              <li data-testid="banner-demoradas" [attr.title]="pistaDemoradas()">
                <span class="font-medium">{{ t().stalledDelayed }}:</span> {{ datos().demoradas }}
              </li>
            }
          </ul>
        </div>
      </div>
    }
  `
})
export class AlertaEstancadasComponent {
  private i18n = inject(I18nService);

  /** Órdenes estancadas que entrega el backend, ya acotadas a la empresa del usuario. */
  readonly datos = input.required<EstancadasData>();

  protected readonly t = computed(() => this.i18n.tree().dashboard);

  /**
   * Explicación del umbral, armada con las partes de i18n y el número que manda el
   * backend. Así el 7 no queda escrito en dos lugares distintos.
   */
  protected readonly pistaDemoradas = computed(() => {
    const t = this.t();
    return `${t.stalledThresholdBefore} ${this.datos().umbral_dias} ${t.stalledThresholdAfter}`;
  });
}
