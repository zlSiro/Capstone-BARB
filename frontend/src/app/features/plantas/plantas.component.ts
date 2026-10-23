import { Component, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { Discipline, Machine, Plant } from '../../core/models';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { MaquinaFormModalComponent } from './maquina-form-modal.component';
import { PlantaFormModalComponent } from './planta-form-modal.component';

/** Una planta con lo que el listado necesita mostrar. */
interface PlantaFila {
  planta: Plant;
  maquinas: Machine[];
}

/**
 * Listado de plantas con el alta masiva (HU-25 / CGBIDA-461, subtarea CGBIDA-466).
 *
 * Se arma con los GET que ya existen, sin tocar el backend:
 *  - `/api/plants`     → las plantas de la empresa.
 *  - `/api/machines`   → se agrupan por `plant_id` para contar y listar sus máquinas.
 *  - `/api/disciplines`→ resuelve el nombre de la disciplina de cada máquina.
 *
 * El modal de alta es el que crea la planta con sus disciplinas y máquinas en una sola
 * transacción; al emitir `saved` este listado se recarga para reflejar lo creado.
 */
@Component({
  selector: 'app-plantas',
  imports: [PlantaFormModalComponent, MaquinaFormModalComponent],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="plantas-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="plantas-title" class="text-2xl font-bold text-gray-800 dark:text-gray-100">
            Plantas ({{ plantas().length }})
          </h1>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            Plantas de tu empresa con sus máquinas. El alta crea la planta, sus disciplinas y sus máquinas de una vez.
          </p>
        </div>
        <button type="button" class="btn-primary" data-testid="nueva-planta" (click)="openCreate()">
          + Nueva planta
        </button>
      </div>

      <div>
        <label for="planta-filtro" class="sr-only">Buscar planta</label>
        <input
          id="planta-filtro"
          type="search"
          placeholder="Buscar por nombre o ubicación…"
          class="w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          [value]="filtro()"
          (input)="filtro.set($any($event.target).value)" />
      </div>

      @if (loading()) {
        <div class="py-10 text-center text-gray-600 dark:text-gray-300" role="status" data-testid="cargando">
          Cargando plantas…
        </div>
      } @else if (error()) {
        <div class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" data-testid="error">
          {{ error() }}
          <button type="button" class="ml-2 underline" (click)="load()">Reintentar</button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <table class="w-full text-sm text-gray-800 dark:text-gray-100">
            <caption class="sr-only">Listado de plantas</caption>
            <thead class="bg-gray-50 text-xs uppercase text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">Planta</th>
                <th scope="col" class="px-4 py-2 text-left">Ubicación</th>
                <th scope="col" class="px-4 py-2 text-right">Máquinas</th>
                <th scope="col" class="px-4 py-2 text-left">Disciplinas</th>
                <th scope="col" class="px-4 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (fila of filtradas(); track fila.planta.id) {
                <tr class="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800" data-testid="fila-planta">
                  <td class="px-4 py-2">
                    <div class="font-medium" data-testid="planta-celda-nombre">{{ fila.planta.name }}</div>
                    @if (fila.maquinas.length === 0) {
                      <div class="text-xs text-gray-500 dark:text-gray-400">Sin máquinas</div>
                    }
                  </td>
                  <td class="px-4 py-2" data-testid="planta-celda-ubicacion">{{ fila.planta.ubicacion || '—' }}</td>
                  <td class="px-4 py-2 text-right font-medium" data-testid="planta-celda-maquinas">
                    {{ fila.maquinas.length }}
                  </td>
                  <td class="px-4 py-2">
                    @if (disciplinasDe(fila).length) {
                      <div class="flex flex-wrap gap-1">
                        @for (d of disciplinasDe(fila); track d) {
                          <span class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">{{ d }}</span>
                        }
                      </div>
                    } @else {
                      <span class="text-gray-400">—</span>
                    }
                  </td>
                  <td class="px-4 py-2">
                    <div class="flex justify-end gap-1">
                      <button
                        type="button"
                        class="btn-secondary"
                        data-testid="editar-planta"
                        (click)="openEdit(fila.planta)"
                        [attr.aria-label]="'Editar ' + fila.planta.name"
                      >Editar</button>
                      <button
                        type="button"
                        class="btn-secondary"
                        data-testid="agregar-maquina"
                        (click)="openMaquina(fila.planta)"
                        [attr.aria-label]="'Agregar máquina a ' + fila.planta.name"
                      >+ Máquina</button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="py-6 text-center text-gray-600 dark:text-gray-300" data-testid="vacio">
                    No hay plantas todavía. Crea la primera con «Nueva planta».
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (modalOpen()) {
      <app-planta-form-modal [planta]="editing()" (closed)="closeModal()" (saved)="onSaved()" />
    }

    @if (maquinaPara(); as planta) {
      <app-maquina-form-modal
        [planta]="planta"
        [disciplinas]="listaDisciplinas()"
        (closed)="closeMaquina()"
        (saved)="onMaquinaSaved()"
      />
    }
  `,
})
export class PlantasComponent {
  private readonly catalogo = inject(CatalogService);
  private readonly toast = inject(ToastService);

  protected readonly plantas = signal<PlantaFila[]>([]);
  protected readonly disciplinas = signal<Map<number, string>>(new Map());
  /** Lista completa, para el datalist del modal de máquina. */
  protected readonly listaDisciplinas = signal<Discipline[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly filtro = signal('');
  protected readonly modalOpen = signal(false);
  /** Planta en edición; null = alta. */
  protected readonly editing = signal<Plant | null>(null);
  /** Planta a la que se le agrega una máquina; null = modal cerrado. */
  protected readonly maquinaPara = signal<Plant | null>(null);

  protected readonly filtradas = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return this.plantas();
    return this.plantas().filter((f) =>
      [f.planta.name, f.planta.ubicacion].some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  });

  constructor() {
    this.load();
  }

  /**
   * Carga plantas y máquinas en paralelo.
   *
   * Si fallan las máquinas, el listado igual se muestra con 0: es preferible ver las
   * plantas sin contadores que una pantalla de error por un dato accesorio.
   */
  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      plantas: this.catalogo.getPlants(),
      maquinas: this.catalogo.getMachines().pipe(catchError(() => of([] as Machine[]))),
      disciplinas: this.catalogo.getDisciplines().pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ plantas, maquinas, disciplinas }) => {
        this.disciplinas.set(new Map(disciplinas.map((d) => [d.id, d.name])));
        this.listaDisciplinas.set(disciplinas);
        this.plantas.set(
          plantas.map((planta) => ({
            planta,
            maquinas: maquinas.filter((m) => m.plant_id === planta.id),
          })),
        );
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'No se pudieron cargar las plantas.'));
        this.loading.set(false);
      },
    });
  }

  /** Nombres de disciplina distintos que usan las máquinas de una planta. */
  protected disciplinasDe(fila: PlantaFila): string[] {
    const nombres = new Set<string>();
    for (const maquina of fila.maquinas) {
      const nombre = maquina.discipline_id ? this.disciplinas().get(maquina.discipline_id) : undefined;
      if (nombre) nombres.add(nombre);
    }
    return [...nombres].sort((a, b) => a.localeCompare(b));
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.modalOpen.set(true);
  }

  protected openEdit(planta: Plant): void {
    this.editing.set(planta);
    this.modalOpen.set(true);
  }

  protected openMaquina(planta: Plant): void {
    this.maquinaPara.set(planta);
  }

  protected closeMaquina(): void {
    this.maquinaPara.set(null);
  }

  protected onMaquinaSaved(): void {
    this.maquinaPara.set(null);
    this.load();
  }

  protected closeModal(): void {
    this.modalOpen.set(false);
  }

  protected onSaved(): void {
    this.modalOpen.set(false);
    this.toast.info('Listado actualizado.');
    this.load();
  }
}


