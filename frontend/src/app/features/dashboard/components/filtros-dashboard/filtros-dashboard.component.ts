import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { CatalogService } from '../../../../core/services/catalog.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { Discipline, FiltrosDashboard, Machine, Plant } from '../../../../core/models';

/**
 * Panel de filtros globales del Dashboard (CGBIDA-550).
 *
 * Tres selects en cascada: la planta habilita la disciplina y la máquina, y la disciplina
 * acota las máquinas. Emite `FiltrosDashboard` en cada cambio; el Dashboard padre es quien
 * vuelve a pedir los KPIs, así que este componente no conoce el servicio de stats.
 *
 * Los catálogos salen de los mismos endpoints que usa el mantenedor (`/api/plants`,
 * `/api/disciplines`, `/api/machines`), que ya vienen filtrados por empresa: el panel no
 * inventa un endpoint nuevo ni puede mostrar plantas de otra empresa.
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
          @if (plantaId() !== null) {
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

        <button
          type="button"
          class="rounded-control border border-borde-control px-3 py-1.5 text-sm font-medium
                 text-tinta transition-colors hover:bg-superficie-alt disabled:opacity-40"
          data-testid="limpiar-filtros"
          [disabled]="plantaId() === null"
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

  protected readonly t = computed(() => this.i18n.tree().financial);

  private readonly plantas = signal<Plant[]>([]);
  private readonly disciplinas = signal<Discipline[]>([]);
  private readonly maquinas = signal<Machine[]>([]);
  protected readonly error = signal(false);

  protected readonly plantaId = signal<number | null>(null);
  protected readonly disciplinaId = signal<number | null>(null);
  protected readonly maquinaId = signal<number | null>(null);

  /** IDs elegidos. Se emite en cada cambio hacia el Dashboard. */
  readonly cambio = output<FiltrosDashboard>();

  /**
   * Disciplinas presentes en las máquinas de la planta elegida.
   *
   * No se listan las disciplinas de la empresa que esa planta no usa: elegir una
   * disciplina sin equipos dejaría los KPIs en cero sin que se entienda por qué.
   */
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
    // filtros, que es el estado por defecto.
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

  protected cambiarPlanta(valor: string): void {
    const planta = valor === '' ? null : Number(valor);
    this.plantaId.set(planta);
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

  /** Vuelve a "toda la empresa". */
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
    });
  }
}
