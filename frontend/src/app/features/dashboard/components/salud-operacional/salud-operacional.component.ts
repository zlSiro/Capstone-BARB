import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EstadoSalud, SaludOperacionalData } from '../../../../core/models';
import { I18nService } from '../../../../core/i18n/i18n.service';

/**
 * Tarjeta de Salud Operacional simplificada (CGBIDA-520).
 *
 * El rediseño del dashboard redujo el semáforo a DOS señales que el supervisor puede
 * accionar hoy: OTs estancadas/vencidas y cumplimiento de SLA. Por eso esta tarjeta ya no
 * dibuja el anillo del índice compuesto ni las tres sub-tarjetas (SLA, MTBF, backlog):
 *
 * - **El semáforo grande** dice el estado de un vistazo.
 * - **El motivo** (texto que manda el backend) explica POR QUÉ está en ese color. Un color
 *   sin causa no es accionable, y el motivo lo redacta el backend para que haya una sola
 *   fuente de verdad.
 * - **Una línea** con el % de SLA y la cantidad de OTs vencidas: las dos cifras que
 *   sostienen el color.
 *
 * Si el backend no manda datos (`null`) el estado es `insuficiente` y se pinta en gris:
 * la interfaz no inventa un verde que el backend no calculó.
 */
@Component({
  selector: 'app-salud-operacional',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure
      class="flex h-full flex-col rounded-control border border-borde bg-superficie p-5 "
      data-testid="salud-operacional"
    >
      <figcaption class="mb-1">
        <h2 class="text-sm font-extrabold text-tinta ">
          {{ t().healthCardTitle }}
        </h2>
        <p class="text-sm text-tinta-suave ">{{ t().healthCardSub }}</p>
      </figcaption>

      <div class="flex flex-1 flex-col justify-center gap-3 py-2">
        <!-- Semaforo y estado en una sola fila: antes el circulo de 96px empujaba todo
             hacia abajo y dejaba medio tarjeta vacia (CGBIDA-550). -->
        <div class="flex items-center gap-4">
          <span
            class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full
                   text-2xl font-extrabold text-white shadow-lg"
            [style.background]="color()"
            role="img"
            [attr.aria-label]="t().healthCardTitle + ': ' + etiquetaEstado()"
            data-testid="luz-salud"
          >{{ icono() }}</span>
          <div class="min-w-0">
            <p
              class="text-2xl font-extrabold leading-tight"
              [style.color]="color()"
              data-testid="estado-salud"
            >{{ etiquetaEstado() }}</p>
            <!-- Motivo: lo redacta el backend, no se arma en el frontend. -->
            <p class="text-sm font-medium text-tinta " data-testid="motivo-salud">
              {{ motivo() }}
            </p>
          </div>
        </div>

        <!-- Linea simple con las dos cifras que sostienen el color. -->
        <p class="text-sm text-tinta-suave " data-testid="resumen-salud">
          <span data-testid="sla-salud">{{ t().healthComponentSla }} {{ slaTexto() }}</span>
          <span class="mx-2 text-borde-control ">·</span>
          <span data-testid="vencidas-salud">
            {{ vencidas() }} {{ t().healthOtsVencidas }}
          </span>
        </p>

        <!-- Desglose de OTs del período (CGBIDA-550): el espacio que antes quedaba vacio
             ahora dice como se reparte el trabajo. -->
        <div class="grid grid-cols-3 gap-2" data-testid="desglose-salud">
          @for (c of contadores(); track c.clave) {
            <div
              class="rounded-control border border-borde bg-superficie-alt px-2 py-1.5 text-center"
              [attr.data-testid]="'desglose-' + c.clave"
            >
              <p class="text-lg font-extrabold leading-none text-tinta">{{ c.valor }}</p>
              <p class="mt-0.5 text-xs text-tinta-suave ">{{ c.etiqueta }}</p>
            </div>
          }
        </div>
      </div>
    </figure>
  `
})
export class SaludOperacionalComponent {
  private i18n = inject(I18nService);

  /** Semáforo simplificado que calcula el backend (CGBIDA-520). */
  readonly salud = input.required<SaludOperacionalData | null>();

  protected readonly t = computed(() => this.i18n.tree().financial);

  /** Sin datos se pinta gris (`insuficiente`), nunca verde. */
  protected readonly estado = computed<EstadoSalud>(() => this.salud()?.estado ?? 'insuficiente');

  protected readonly color = computed(() => COLOR_POR_ESTADO[this.estado()]);

  protected readonly icono = computed(() => ICONO_POR_ESTADO[this.estado()]);

  protected readonly etiquetaEstado = computed(() => {
    const t = this.t();
    switch (this.estado()) {
      case 'verde':
        return t.healthEstadoVerde;
      case 'amarillo':
        return t.healthEstadoAmarillo;
      case 'rojo':
        return t.healthEstadoRojo;
      default:
        return t.healthEstadoInsuficiente;
    }
  });

  /** Motivo del backend; si no hay datos, el aviso de siempre. */
  protected readonly motivo = computed(() => {
    const m = this.salud()?.motivo;
    return m && m.trim() ? m : this.t().healthInsufficient;
  });

  /** SLA del período, con un decimal. Guion si no vino. */
  protected readonly slaTexto = computed(() => {
    const sla = this.salud()?.sla;
    return typeof sla === 'number' ? `${sla.toFixed(1)}%` : '—';
  });

  protected readonly vencidas = computed(() => this.salud()?.vencidas ?? 0);

  /**
   * Los tres contadores del desglose (CGBIDA-550).
   *
   * `pendientes` no es "todo lo abierto": es lo que todavía no tiene a nadie trabajando.
   * La distinción importa para el supervisor, que acciona distinto sobre una OT en curso
   * que sobre una sin asignar.
   *
   * Si el backend no manda `desglose` (versión anterior) los contadores muestran 0: es
   * preferible a inventar los números.
   */
  protected readonly contadores = computed(() => {
    const t = this.t();
    const d = this.salud()?.desglose;
    return [
      { clave: 'completadas', valor: d?.completadas ?? 0, etiqueta: t.healthDesgloseCompletadas },
      { clave: 'en-curso', valor: d?.en_curso ?? 0, etiqueta: t.healthDesgloseEnCurso },
      { clave: 'pendientes', valor: d?.pendientes ?? 0, etiqueta: t.healthDesglosePendientes },
    ];
  });
}

const COLOR_POR_ESTADO: Record<EstadoSalud, string> = {
  verde: 'var(--ok)',
  amarillo: 'var(--alerta)',
  rojo: 'var(--peligro)',
  insuficiente: 'var(--neutro)',
};

/** Glifo del semáforo. Se usa texto y no un icono para no sumar una dependencia. */
const ICONO_POR_ESTADO: Record<EstadoSalud, string> = {
  verde: '✓',
  amarillo: '!',
  rojo: '✕',
  insuficiente: '—',
};
