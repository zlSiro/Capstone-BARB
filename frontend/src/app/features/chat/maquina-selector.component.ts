import { Component, ElementRef, computed, inject, input, model, signal } from '@angular/core';

import { Machine, Plant } from '../../core/models';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

interface Opcion {
  /** `null` = «Sin máquina». */
  id: number | null;
  etiqueta: string;
  /** Posición en la lista plana: la usa el teclado y `aria-activedescendant`. */
  indice: number;
}

interface GrupoOpciones {
  planta: string;
  opciones: Opcion[];
}

let siguienteId = 0;

/** Quita tildes y pasa a minúsculas para que «compresor» encuentre «Compréssor». */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Selector de la máquina de la conversación (HU-23): combobox editable (patrón ARIA 1.2 «list autocomplete»).
 *
 * - Buscable por nombre o código; las máquinas se agrupan por planta.
 * - Opcional: la opción «Sin máquina» desvincula.
 * - Teclado: ↑/↓ mueven, Enter elige, Esc cierra (y descarta la búsqueda), Tab cierra.
 * - Es presentacional: recibe el catálogo y expone la selección con `[(value)]` (id de la máquina o `null`).
 */
@Component({
  selector: 'app-maquina-selector',
  imports: [TranslatePipe],
  host: {
    class: 'block min-w-0',
    '(document:click)': 'alHacerClicEnDocumento($event)',
  },
  template: `
    <label [for]="inputId" class="fld-label">{{ 'docChat.maquinaLabel' | translate }}</label>
    <div class="relative">
      <input
        [id]="inputId"
        type="text"
        role="combobox"
        autocomplete="off"
        class="fld-input pr-10"
        data-testid="maquina-input"
        aria-autocomplete="list"
        [attr.aria-expanded]="abierto()"
        [attr.aria-controls]="listaId"
        [attr.aria-activedescendant]="opcionActivaId()"
        [attr.aria-describedby]="ayudaId"
        [attr.placeholder]="'docChat.maquinaPlaceholder' | translate"
        [disabled]="disabled()"
        [value]="textoVisible()"
        (focus)="abrir()"
        (click)="abrir()"
        (input)="alEscribir($event)"
        (keydown)="alPulsarTecla($event)"
      />
      @if (value() !== null && !disabled()) {
        <button
          type="button"
          class="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-control text-tinta-suave hover:text-tinta focus-visible:outline-2 focus-visible:outline-accion"
          data-testid="maquina-limpiar"
          [attr.aria-label]="'docChat.maquinaQuitar' | translate"
          (click)="elegir(null)"
        >×</button>
      }
      @if (abierto()) {
        <ul
          [id]="listaId"
          role="listbox"
          data-testid="maquina-lista"
          [attr.aria-label]="'docChat.maquinaLabel' | translate"
          class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-control border border-borde bg-superficie py-1 text-sm shadow-lg"
        >
          @if (mostrarSinMaquina()) {
            <li
              role="option"
              [id]="idOpcion(0)"
              data-testid="maquina-opcion"
              class="cursor-pointer px-3 py-2 text-tinta-suave"
              [class.bg-accion-suave]="indiceActivo() === 0"
              [attr.aria-selected]="value() === null"
              (mousedown)="$event.preventDefault()"
              (click)="elegir(null)"
            >{{ 'docChat.maquinaNinguna' | translate }}</li>
          }
          @for (g of grupos(); track g.planta) {
            <li role="presentation">
              <ul role="group" [attr.aria-label]="g.planta">
                <li role="presentation" class="px-3 pt-2 pb-1 text-xs font-semibold uppercase text-tinta-suave" aria-hidden="true">{{ g.planta }}</li>
                @for (o of g.opciones; track o.id) {
                  <li
                    role="option"
                    [id]="idOpcion(o.indice)"
                    data-testid="maquina-opcion"
                    class="cursor-pointer px-3 py-2 text-tinta"
                    [class.bg-accion-suave]="indiceActivo() === o.indice"
                    [class.font-semibold]="value() === o.id"
                    [attr.aria-selected]="value() === o.id"
                    (mousedown)="$event.preventDefault()"
                    (click)="elegir(o.id)"
                  >{{ o.etiqueta }}</li>
                }
              </ul>
            </li>
          }
          @if (grupos().length === 0 && !mostrarSinMaquina()) {
            <li role="presentation" class="px-3 py-2 text-tinta-suave" data-testid="maquina-vacio">{{ 'docChat.maquinaSinResultados' | translate }}</li>
          }
        </ul>
      }
    </div>
    <p [id]="ayudaId" class="mt-1 text-sm text-tinta-suave">{{ 'docChat.maquinaAyuda' | translate }}</p>
  `,
})
export class MaquinaSelectorComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly maquinas = input<Machine[]>([]);
  readonly plantas = input<Plant[]>([]);
  readonly disabled = input(false);
  /** Id de la máquina elegida; `null` = sin máquina. */
  readonly value = model<number | null>(null);

  private readonly uid = ++siguienteId;
  protected readonly inputId = `maquina-selector-${this.uid}`;
  protected readonly listaId = `${this.inputId}-lista`;
  protected readonly ayudaId = `${this.inputId}-ayuda`;

  protected readonly abierto = signal(false);
  /** Texto que el usuario está escribiendo; `null` = no está buscando (el input muestra la selección). */
  private readonly consulta = signal<string | null>(null);
  protected readonly indiceActivo = signal(0);

  private readonly etiquetas = computed(() => {
    const nombres = new Map(this.plantas().map((p) => [p.id, p.name]));
    return this.maquinas().map((m) => ({
      id: m.id,
      planta: (m.plant_id !== null ? nombres.get(m.plant_id) : undefined) ?? '—',
      etiqueta: m.codigo ? `${m.name} (${m.codigo})` : m.name,
      busqueda: normalizar(`${m.name} ${m.codigo ?? ''}`),
    }));
  });

  private readonly seleccionada = computed(() => this.etiquetas().find((m) => m.id === this.value()) ?? null);

  protected readonly textoVisible = computed(() => this.consulta() ?? this.seleccionada()?.etiqueta ?? '');

  /** «Sin máquina» solo se ofrece cuando no se está filtrando. */
  protected readonly mostrarSinMaquina = computed(() => !(this.consulta() ?? '').trim());

  protected readonly grupos = computed<GrupoOpciones[]>(() => {
    const q = normalizar((this.consulta() ?? '').trim());
    // El índice 0 lo ocupa «Sin máquina» cuando se muestra.
    let indice = this.mostrarSinMaquina() ? 1 : 0;
    const porPlanta = new Map<string, Opcion[]>();
    for (const m of this.etiquetas()) {
      if (q && !m.busqueda.includes(q)) continue;
      const lista = porPlanta.get(m.planta) ?? [];
      lista.push({ id: m.id, etiqueta: m.etiqueta, indice: indice++ });
      porPlanta.set(m.planta, lista);
    }
    return [...porPlanta].map(([planta, opciones]) => ({ planta, opciones }));
  });

  /** Lista plana en el orden en que se ven las opciones (para el teclado). */
  private readonly planas = computed<(number | null)[]>(() => [
    ...(this.mostrarSinMaquina() ? [null] : []),
    ...this.grupos().flatMap((g) => g.opciones.map((o) => o.id)),
  ]);

  protected readonly opcionActivaId = computed(() =>
    this.abierto() && this.planas().length > 0 ? this.idOpcion(this.indiceActivo()) : null,
  );

  protected idOpcion(indice: number): string {
    return `${this.inputId}-opt-${indice}`;
  }

  protected abrir(): void {
    if (this.disabled() || this.abierto()) return;
    this.abierto.set(true);
    // Al abrir, el cursor parte en la opción elegida (o en la primera).
    const i = this.planas().indexOf(this.value());
    this.indiceActivo.set(Math.max(0, i));
  }

  protected cerrar(): void {
    this.abierto.set(false);
    this.consulta.set(null);
  }

  protected elegir(id: number | null): void {
    this.value.set(id);
    this.cerrar();
  }

  protected alEscribir(ev: Event): void {
    this.consulta.set((ev.target as HTMLInputElement).value);
    this.abierto.set(true);
    this.indiceActivo.set(0);
  }

  protected alPulsarTecla(ev: KeyboardEvent): void {
    const total = this.planas().length;
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        if (!this.abierto()) this.abrir();
        else if (total) this.moverA((this.indiceActivo() + 1) % total);
        break;
      case 'ArrowUp':
        ev.preventDefault();
        if (!this.abierto()) this.abrir();
        else if (total) this.moverA((this.indiceActivo() - 1 + total) % total);
        break;
      case 'Enter':
        if (this.abierto() && total) {
          ev.preventDefault();
          this.elegir(this.planas()[this.indiceActivo()] ?? null);
        }
        break;
      case 'Escape':
        if (this.abierto()) {
          ev.preventDefault();
          this.cerrar();
        }
        break;
      case 'Tab':
        this.cerrar();
        break;
    }
  }

  protected alHacerClicEnDocumento(ev: MouseEvent): void {
    if (this.abierto() && !this.host.nativeElement.contains(ev.target as Node)) this.cerrar();
  }

  private moverA(indice: number): void {
    this.indiceActivo.set(indice);
    // Mantiene visible la opción activa en listas largas (jsdom no implementa scrollIntoView).
    queueMicrotask(() => document.getElementById(this.idOpcion(indice))?.scrollIntoView?.({ block: 'nearest' }));
  }
}
