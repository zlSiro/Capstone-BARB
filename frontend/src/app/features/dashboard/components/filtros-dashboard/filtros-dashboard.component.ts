import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { CatalogService } from '../../../../core/services/catalog.service';
import { CurrencyService, Moneda } from '../../../../core/services/currency.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import {
  Discipline,
  FiltrosDashboard,
  Machine,
  Plant,
  RangoTemporal,
  SIN_FILTROS,
} from '../../../../core/models';

/**
 * Barra única de mandos del Dashboard (CGBIDA-550).
 *
 * Reúne TODOS los filtros globales en un solo lugar: topología (planta → disciplina →
 * máquina), ventana temporal y moneda de presentación. Antes el rango y la moneda vivían
 * sueltos en la cabecera y el gráfico histórico tenía además su propio selector, así que
 * se podía mirar el mismo Dashboard con dos ventanas distintas al mismo tiempo.
 *
 * Emite `FiltrosDashboard` completo en cada cambio. El Dashboard padre es quien vuelve a
 * pedir los KPIs y se lo pasa al gráfico histórico por input: este componente no conoce el
 * servicio de stats.
 *
 * Los catálogos salen de los mismos endpoints del mantenedor (`/api/plants`,
 * `/api/disciplines`, `/api/machines`), que ya vienen filtrados por empresa.
 */
@Component({
  selector: 'app-filtros-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      class="rounded-control border border-borde bg-superficie p-3 "
      data-testid="filtros-dashboard"
      [attr.aria-label]="t().filtersTitle"
    >
      <div class="flex flex-wrap items-end gap-3">
        <div class="mr-auto flex items-center gap-2">
          <span class="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
            {{ t().filtersTitle }}
          </span>
          @if (hayTopologia()) {
            <span
              class="rounded-full bg-accion-suave px-2 py-0.5 text-xs font-medium text-accion"
              data-testid="filtros-activos"
            >
              {{ t().filterActive }}
            </span>
          }
        </div>

        <!-- Planta: la única que arranca habilitada. -->
        <div>
          <label for="filtro-planta" class="mb-1 block text-xs font-medium text-tinta-suave">
            {{ t().filterPlant }}
          </label>
          <select
            id="filtro-planta"
            data-testid="filtro-planta"
            class="min-w-44 cursor-pointer rounded-control border border-borde-control bg-superficie px-2 py-1.5 text-sm
                   text-tinta outline-none transition-colors focus:border-accion"
            (change)="cambiarPlanta($any($event.target).value)"
          >
            <option value="">{{ t().filterAll }}</option>
            @for (planta of plantas(); track planta.id) {
              <option [value]="planta.id" [selected]="planta.id === plantaId()">
                {{ planta.name }}
              </option>
            }
          </select>
        </div>

        <!-- Disciplina: depende de la planta. -->
        <div>
          <label for="filtro-disciplina" class="mb-1 block text-xs font-medium text-tinta-suave">
            {{ t().filterDiscipline }}
          </label>
          <select
            id="filtro-disciplina"
            data-testid="filtro-disciplina"
            class="min-w-40 rounded-control border border-borde-control bg-superficie px-2 py-1.5 text-sm
                   text-tinta outline-none transition-colors focus:border-accion disabled:opacity-50"
            [disabled]="plantaId() === null"
            (change)="cambiarDisciplina($any($event.target).value)"
          >
            <option value="">{{ plantaId() === null ? t().filterNeedPlant : t().filterAll }}</option>
            @for (disciplina of disciplinasDisponibles(); track disciplina.id) {
              <option [value]="disciplina.id" [selected]="disciplina.id === disciplinaId()">
                {{ disciplina.name }}
              </option>
            }
          </select>
        </div>

        <!-- Máquina: depende de la planta y, si hay, de la disciplina. -->
        <div>
          <label for="filtro-maquina" class="mb-1 block text-xs font-medium text-tinta-suave">
            {{ t().filterMachine }}
          </label>
          <select
            id="filtro-maquina"
            data-testid="filtro-maquina"
            class="min-w-48 rounded-control border border-borde-control bg-superficie px-2 py-1.5 text-sm
                   text-tinta outline-none transition-colors focus:border-accion disabled:opacity-50"
            [disabled]="plantaId() === null"
            (change)="cambiarMaquina($any($event.target).value)"
          >
            <option value="">{{ plantaId() === null ? t().filterNeedPlant : t().filterAll }}</option>
            @for (maquina of maquinasDisponibles(); track maquina.id) {
              <option [value]="maquina.id" [selected]="maquina.id === maquinaId()">
                {{ maquina.name }}
              </option>
            }
          </select>
        </div>

        <!-- Rango temporal global: lo usan los KPIs y el gráfico histórico. -->
        <div>
          <label for="filtro-rango" class="mb-1 block text-xs font-medium text-tinta-suave">
            {{ tr().rangeLabel }}
          </label>
          <select
            id="filtro-rango"
            data-testid="filtro-rango"
            class="min-w-36 cursor-pointer rounded-control border border-borde-control bg-superficie px-2 py-1.5 text-sm
                   text-tinta outline-none transition-colors focus:border-accion"
            (change)="cambiarRango($any($event.target).value)"
          >
            @for (r of rangos; track r) {
              <option [value]="r" [selected]="r === rango()">{{ etiquetaRango(r) }}</option>
            }
          </select>
        </div>

        <!-- Moneda de presentación. Los datos base siguen en CLP (CGBIDA-432). -->
        <div>
          <span class="mb-1 block text-xs font-medium text-tinta-suave">
            {{ t().currencyLabel }}
          </span>
          <div
            class="flex items-center gap-1 rounded-control border border-borde-control p-0.5"
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
                [class]="currency.moneda() === m ? claseActiva : claseInactiva"
              >
                {{ m }}
              </button>
            }
          </div>
        </div>

        <button
          type="button"
          class="rounded-control border border-borde-control px-3 py-1.5 text-sm font-medium
                 text-tinta transition-colors hover:bg-superficie-alt disabled:opacity-40"
          data-testid="limpiar-filtros"
          [disabled]="!hayTopologia()"
          (click)="limpiar()"
        >
          {{ t().filterClear }}
        </button>
      </div>

      @if (error()) {
        <p class="mt-2 text-xs text-peligro" role="alert" data-testid="filtros-error">
          {{ t().loadError }}
        </p>
      }
    </section>
  `,
})
export class FiltrosDashboardComponent implements OnInit {
  private catalogo = inject(CatalogService);
  private i18n = inject(I18nService);
  protected readonly currency = inject(CurrencyService);

  protected readonly t = computed(() => this.i18n.tree().financial);
  protected readonly tr = computed(() => this.i18n.tree().dashboard);

  private readonly plantas = signal<Plant[]>([]);
  private readonly disciplinas = signal<Discipline[]>([]);
  private readonly maquinas = signal<Machine[]>([]);
  protected readonly error = signal(false);

  protected readonly plantaId = signal<number | null>(null);
  protected readonly disciplinaId = signal<number | null>(null);
  protected readonly maquinaId = signal<number | null>(null);
  protected readonly rango = signal<RangoTemporal>(SIN_FILTROS.rango);

  protected readonly rangos: readonly RangoTemporal[] = [7, 30, 90, 'all'];
  protected readonly monedas: readonly Moneda[] = ['CLP', 'USD'];

  /** Clases completas para que Tailwind no las elimine por no verlas en el HTML. */
  protected readonly claseActiva =
    'rounded-control px-2 py-1 text-sm font-semibold bg-accion text-sobre-accion';
  protected readonly claseInactiva =
    'rounded-control px-2 py-1 text-sm font-medium text-tinta-suave ';

  /** `true` si hay algún filtro de topología (el rango y la moneda no son "filtros"). */
  protected readonly hayTopologia = computed(
    () => this.plantaId() !== null || this.disciplinaId() !== null || this.maquinaId() !== null,
  );

  /** Filtros completos, tal como se emiten. */
  readonly cambio = output<FiltrosDashboard>();

  /** Disciplinas presentes en las máquinas de la planta elegida. */
  protected readonly disciplinasDisponibles = computed(() => {
    const planta = this.plantaId();
    if (planta === null) return [];
    const usadas = new Set(
      this.maquinas()
        .filter((m) => m.plant_id === planta && m.discipline_id !== null)
        .map((m) => m.discipline_id as number),
    );
    return this.disciplinas().filter((d) => usadas.has(d.id));
  });

  /** Máquinas de la planta elegida, acotadas por la disciplina si hay una. */
  protected readonly maquinasDisponibles = computed(() => {
    const planta = this.plantaId();
    if (planta === null) return [];
    const disciplina = this.disciplinaId();
    return this.maquinas()
      .filter((m) => m.plant_id === planta && (disciplina === null || m.discipline_id === disciplina))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  ngOnInit(): void {
    // Si el catálogo falla, el panel igual se muestra: el Dashboard sigue funcionando sin
    // filtros de topología, que es el estado por defecto.
    forkJoin({
      plantas: this.catalogo.getPlants().pipe(catchError(() => of([] as Plant[]))),
      disciplinas: this.catalogo.getDisciplines().pipe(catchError(() => of([] as Discipline[]))),
      maquinas: this.catalogo.getMachines().pipe(catchError(() => of([] as Machine[]))),
    }).subscribe({
      next: ({ plantas, disciplinas, maquinas }) => {
        this.plantas.set(plantas);
        this.disciplinas.set(disciplinas);
        this.maquinas.set(maquinas);
      },
      error: () => this.error.set(true),
    });
  }

  /** Etiqueta del rango en el idioma activo. */
  protected etiquetaRango(r: RangoTemporal): string {
    const tr = this.tr();
    switch (r) {
      case 7:
        return tr.last7Days;
      case 30:
        return tr.last30Days;
      case 90:
        return tr.last90Days;
      default:
        return tr.allTime;
    }
  }

  protected cambiarPlanta(valor: string): void {
    this.plantaId.set(valor === '' ? null : Number(valor));
    // Cambiar de planta invalida los hijos: la disciplina y la máquina eran de la anterior.
    this.disciplinaId.set(null);
    this.maquinaId.set(null);
    this.emitir();
  }

  protected cambiarDisciplina(valor: string): void {
    this.disciplinaId.set(valor === '' ? null : Number(valor));
    // La máquina elegida puede no pertenecer a la nueva disciplina: se limpia sola.
    const maquina = this.maquinaId();
    if (maquina !== null && !this.maquinasDisponibles().some((m) => m.id === maquina)) {
      this.maquinaId.set(null);
    }
    this.emitir();
  }

  protected cambiarMaquina(valor: string): void {
    this.maquinaId.set(valor === '' ? null : Number(valor));
    this.emitir();
  }

  protected cambiarRango(valor: string): void {
    const rango: RangoTemporal = valor === 'all' ? 'all' : (Number(valor) as 7 | 30 | 90);
    if (rango === this.rango()) return;
    this.rango.set(rango);
    this.emitir();
  }

  /** La moneda la aplica el servicio compartido: el resto de la UI reacciona sola. */
  protected cambiarMoneda(moneda: Moneda): void {
    if (moneda === this.currency.moneda()) return;
    this.currency.setMoneda(moneda);
    this.emitir();
  }

  /** Vuelve a "toda la empresa". No toca rango ni moneda: eso es preferencia, no filtro. */
  protected limpiar(): void {
    this.plantaId.set(null);
    this.disciplinaId.set(null);
    this.maquinaId.set(null);
    this.emitir();
  }

  private emitir(): void {
    this.cambio.emit({
      planta_id: this.plantaId(),
      disciplina_id: this.disciplinaId(),
      maquina_id: this.maquinaId(),
      rango: this.rango(),
      moneda: this.currency.moneda(),
    });
  }
}
