import { Component, computed, input } from '@angular/core';

import { GraficoLinea, SerieLinea } from '../../../core/models';

interface Trazo {
  serie: SerieLinea;
  /** Tramos continuos (un valor nulo corta la línea). */
  tramos: string[];
  puntos: { x: number; y: number }[];
  min: number;
  max: number;
}

const W = 560;
const H = 140;
const PAD_X = 36;

/**
 * Un gráfico de línea por serie (cada una con su propia escala: SLA en % y MTTR en minutos no comparten eje). Las etiquetas
 * del primer y último periodo van escritas; el detalle de cada punto está en la tabla del reporte.
 */
@Component({
  selector: 'app-grafico-linea',
  template: `
    <figure class="flex flex-col gap-3" [attr.data-testid]="'grafico-' + grafico().id">
      <figcaption class="text-base font-semibold text-tinta">{{ grafico().titulo }}</figcaption>
      @for (tz of trazos(); track tz.serie.nombre; let k = $index) {
        <div>
          <p class="mb-1 text-sm text-tinta-suave">
            {{ tz.serie.nombre }} ({{ tz.serie.unidad }}) · {{ tz.min }} – {{ tz.max }}
          </p>
          <svg
            viewBox="0 0 560 140"
            class="h-auto w-full max-w-3xl"
            role="img"
            [attr.aria-label]="tz.serie.nombre + ': ' + etiquetaInicio() + ' → ' + etiquetaFin()">
            <line x1="36" y1="126" x2="548" y2="126" stroke="var(--borde-control)" stroke-width="1" />
            <line x1="36" y1="14" x2="36" y2="126" stroke="var(--borde-control)" stroke-width="1" />
            @for (d of tz.tramos; track $index) {
              <polyline [attr.points]="d" fill="none" [attr.stroke]="k === 0 ? 'var(--accion)' : 'var(--ok)'" stroke-width="2.5" stroke-linejoin="round" />
            }
            @for (p of tz.puntos; track $index) {
              <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" [attr.fill]="k === 0 ? 'var(--accion)' : 'var(--ok)'" />
            }
            <text x="36" y="138" font-size="12" fill="var(--tinta-suave)">{{ etiquetaInicio() }}</text>
            <text x="548" y="138" font-size="12" text-anchor="end" fill="var(--tinta-suave)">{{ etiquetaFin() }}</text>
          </svg>
        </div>
      }
    </figure>
  `,
})
export class GraficoLineaComponent {
  readonly grafico = input.required<GraficoLinea>();

  protected readonly etiquetaInicio = computed(() => this.grafico().etiquetas[0] ?? '');
  protected readonly etiquetaFin = computed(() => this.grafico().etiquetas.at(-1) ?? '');

  protected readonly trazos = computed<Trazo[]>(() => {
    const n = this.grafico().etiquetas.length;
    return this.grafico().series.map((serie) => {
      const valores = serie.valores.filter((v): v is number => v !== null);
      const min = valores.length ? Math.min(...valores) : 0;
      const max = valores.length ? Math.max(...valores) : 0;
      const rango = max - min || 1;
      const x = (i: number) => (n <= 1 ? W / 2 : PAD_X + ((W - PAD_X - 12) * i) / (n - 1));
      const y = (v: number) => H - 14 - ((H - 28) * (v - min)) / rango;
      const tramos: string[] = [];
      const puntos: { x: number; y: number }[] = [];
      let actual: string[] = [];
      serie.valores.forEach((v, i) => {
        if (v === null) {
          if (actual.length > 1) tramos.push(actual.join(' '));
          actual = [];
          return;
        }
        const p = { x: Math.round(x(i)), y: Math.round(y(v)) };
        puntos.push(p);
        actual.push(`${p.x},${p.y}`);
      });
      if (actual.length > 1) tramos.push(actual.join(' '));
      return { serie, tramos, puntos, min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10 };
    });
  });
}
