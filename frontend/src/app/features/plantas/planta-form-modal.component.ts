import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, form, required, validate } from '@angular/forms/signals';

import { MaquinaNuevaPayload, Plant, PlantaActualizada, PlantaCompletaPayload, PlantaCompletaResponse } from '../../core/models';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';

/** Datos de cabecera de la planta. Es lo único que valida Signal Forms. */
interface PlantaFormModel {
  nombre: string;
  ubicacion: string;
}

/** Fila editable de máquina. Los vacíos se descartan al armar el payload. */
interface MaquinaForm {
  nombre: string;
  codigo: string;
  disciplina: string;
  /**
   * SLA y costo de inactividad propios de esta máquina, como texto: vacío significa «usar
   * el default de la empresa», mientras que "0" es un valor explícito (atención inmediata).
   * Un `<input type="number">` con `number` no permitiría distinguir esos dos casos.
   */
  slaHoras: string;
  costoInactividad: string;
}

/**
 * Alta masiva de una planta con sus disciplinas y máquinas (HU-25 / CGBIDA-461, CGBIDA-466).
 *
 * Formato: dos pasos dentro del mismo modal. El primero captura los datos y las listas
 * dinámicas; el segundo es la confirmación, que resume cuántas máquinas y disciplinas se van
 * a crear antes de llamar al endpoint. Es un solo POST transaccional: o se crea todo o nada.
 *
 * Signal Forms se usa para los campos de cabecera (`form()` + `[formField]`, igual que
 * `empresa-form-modal`). Las listas dinámicas quedan como señales propias y se validan a
 * mano: agregar y quitar filas en un array dentro del modelo no encaja con el árbol de
 * campos, y mantenerlas fuera evita pelear con el esquema.
 */
@Component({
  selector: 'app-planta-form-modal',
  imports: [FormField, ModalComponent],
  template: `
    <app-modal
      [title]="
        esEdicion()
          ? 'Editar planta'
          : paso() === 'form'
            ? 'Nueva planta'
            : 'Confirmar creación'
      "
      [subtitle]="
        esEdicion()
          ? 'Cambia el nombre o la ubicación. Las máquinas se gestionan aparte.'
          : paso() === 'form'
            ? 'Crea la planta con sus disciplinas y máquinas en una sola operación.'
            : 'Revisa el resumen antes de guardar.'
      "
      size="lg"
      (closed)="closed.emit()"
    >
      @if (paso() === 'form') {
        <form class="grid gap-4 md:grid-cols-2" (submit)="$event.preventDefault(); esEdicion() ? guardar() : irAConfirmar()" novalidate>
          <div class="md:col-span-2">
            <label for="pla-nombre" class="fld-label">Nombre de la planta *</label>
            <input
              id="pla-nombre"
              type="text"
              class="fld-input"
              data-testid="planta-nombre"
              [formField]="f.nombre"
              [attr.aria-invalid]="f.nombre().touched() && f.nombre().invalid()"
              [attr.aria-describedby]="f.nombre().touched() && f.nombre().invalid() ? 'pla-nombre-err' : null"
            />
            @if (f.nombre().touched() && f.nombre().invalid()) {
              <p id="pla-nombre-err" role="alert" class="fld-error" data-testid="error-nombre">
                {{ f.nombre().errors()[0]?.message }}
              </p>
            }
          </div>

          <div class="md:col-span-2">
            <label for="pla-ubicacion" class="fld-label">Ubicación</label>
            <input
              id="pla-ubicacion"
              type="text"
              class="fld-input"
              data-testid="planta-ubicacion"
              placeholder="Ciudad, región…"
              [formField]="f.ubicacion"
            />
          </div>

          @if (!esEdicion()) {
          <!-- Disciplinas -->
          <fieldset class="md:col-span-2 rounded-lg border border-slate-700 p-4">
            <legend class="px-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
              Disciplinas
            </legend>
            <p class="mb-3 text-xs text-slate-400">
              Se reutilizan si la empresa ya las tiene; sólo se crean las que falten.
            </p>

            @if (disciplinas().length === 0) {
              <p class="mb-3 text-sm text-slate-400" data-testid="sin-disciplinas">
                Sin disciplinas. Puedes crearlas después.
              </p>
            }

            @for (d of disciplinas(); track $index) {
              <div class="mb-2 flex items-center gap-2">
                <input
                  type="text"
                  class="fld-input"
                  data-testid="disciplina-input"
                  placeholder="Mecánica, Eléctrica…"
                  [value]="d"
                  (input)="cambiarDisciplina($index, $any($event.target).value)"
                />
                <button
                  type="button"
                  class="rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  data-testid="quitar-disciplina"
                  (click)="quitarDisciplina($index)"
                  [attr.aria-label]="'Quitar disciplina ' + (d || $index + 1)"
                >
                  ✕
                </button>
              </div>
            }

            <button
              type="button"
              class="mt-1 rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              data-testid="agregar-disciplina"
              (click)="agregarDisciplina()"
            >
              + Agregar disciplina
            </button>
          </fieldset>

          <!-- Máquinas -->
          <fieldset class="md:col-span-2 rounded-lg border border-slate-700 p-4">
            <legend class="px-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
              Máquinas
            </legend>

            @if (maquinas().length === 0) {
              <p class="mb-3 text-sm text-slate-400" data-testid="sin-maquinas">
                Sin máquinas. Puedes agregarlas después.
              </p>
            }

            @for (m of maquinas(); track $index) {
              <div class="mb-3 rounded border border-slate-800 p-3">
                <div class="grid gap-2 md:grid-cols-4">
                  <div>
                    <label class="fld-label" [attr.for]="'maq-nombre-' + $index">Nombre *</label>
                    <input
                      [id]="'maq-nombre-' + $index"
                      type="text"
                      class="fld-input"
                      data-testid="maquina-nombre"
                      [value]="m.nombre"
                      (input)="cambiarMaquina($index, 'nombre', $any($event.target).value)"
                    />
                  </div>
                  <div>
                    <label class="fld-label" [attr.for]="'maq-codigo-' + $index">Código *</label>
                    <input
                      [id]="'maq-codigo-' + $index"
                      type="text"
                      class="fld-input"
                      data-testid="maquina-codigo"
                      placeholder="CMP-01"
                      [value]="m.codigo"
                      (input)="cambiarMaquina($index, 'codigo', $any($event.target).value)"
                    />
                  </div>
                  <div>
                    <label class="fld-label" [attr.for]="'maq-disc-' + $index">Disciplina</label>
                    <select
                      [id]="'maq-disc-' + $index"
                      class="fld-input"
                      data-testid="maquina-disciplina"
                      [value]="m.disciplina"
                      (change)="cambiarMaquina($index, 'disciplina', $any($event.target).value)"
                    >
                      <option value="">Sin disciplina</option>
                      @for (d of opcionesDisciplina(); track d) {
                        <option [value]="d">{{ d }}</option>
                      }
                    </select>
                  </div>
                  <div class="flex items-end">
                    <button
                      type="button"
                      class="w-full rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                      data-testid="quitar-maquina"
                      (click)="quitarMaquina($index)"
                      [attr.aria-label]="'Quitar máquina ' + (m.nombre || $index + 1)"
                    >
                      ✕ Quitar
                    </button>
                  </div>
                </div>

                <div class="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <label class="fld-label" [attr.for]="'maq-sla-' + $index">SLA (horas)</label>
                    <input
                      [id]="'maq-sla-' + $index"
                      type="number"
                      step="0.5"
                      class="fld-input"
                      placeholder="24"
                      data-testid="maquina-sla-horas"
                      [value]="m.slaHoras"
                      (input)="cambiarMaquina($index, 'slaHoras', $any($event.target).value)"
                    />
                  </div>
                  <div>
                    <label class="fld-label" [attr.for]="'maq-costo-' + $index">Costo de inactividad (por minuto)</label>
                    <input
                      [id]="'maq-costo-' + $index"
                      type="number"
                      step="100"
                      class="fld-input"
                      placeholder="2000"
                      data-testid="maquina-costo-inactividad"
                      [value]="m.costoInactividad"
                      (input)="cambiarMaquina($index, 'costoInactividad', $any($event.target).value)"
                    />
                  </div>
                </div>
                <p class="mt-1 text-xs text-slate-400">
                  Vacío = usa el SLA y el costo generales de la empresa.
                </p>
              </div>
            }

            <button
              type="button"
              class="mt-1 rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              data-testid="agregar-maquina"
              (click)="agregarMaquina()"
            >
              + Agregar máquina
            </button>

            @if (errorMaquinas(); as err) {
              <p role="alert" class="fld-error mt-2" data-testid="error-maquinas">{{ err }}</p>
            }
          </fieldset>
          }

          @if (errorGeneral(); as err) {
            <p role="alert" class="fld-error md:col-span-2" data-testid="error-formulario">{{ err }}</p>
          }

          <div class="md:col-span-2 flex justify-end gap-2 pt-2">
            <button
              type="button"
              (click)="closed.emit()"
              class="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Cancelar
            </button>
              <button type="submit" class="btn-primary" data-testid="continuar" [disabled]="submitting()">
                {{ esEdicion() ? (submitting() ? 'Guardando…' : 'Guardar cambios') : 'Continuar' }}
            </button>
          </div>
        </form>
      } @else {
        <div class="space-y-4">
          <p class="text-sm text-slate-200" data-testid="confirmacion">
            ¿Crear la planta <strong>{{ model().nombre.trim() }}</strong> con
            <strong>{{ totalMaquinas() }}</strong>
            {{ totalMaquinas() === 1 ? 'máquina' : 'máquinas' }} y
            <strong>{{ totalDisciplinas() }}</strong>
            {{ totalDisciplinas() === 1 ? 'disciplina' : 'disciplinas' }}?
          </p>

          @if (model().ubicacion.trim()) {
            <p class="text-xs text-slate-400">Ubicación: {{ model().ubicacion.trim() }}</p>
          }

          @if (totalDisciplinas() > 0) {
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Disciplinas</p>
              <ul class="mt-1 flex flex-wrap gap-2" data-testid="resumen-disciplinas">
                @for (d of disciplinasLimpas(); track d) {
                  <li class="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200">{{ d }}</li>
                }
              </ul>
            </div>
          }

          @if (totalMaquinas() > 0) {
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Máquinas</p>
              <ul class="mt-1 space-y-1" data-testid="resumen-maquinas">
                @for (m of maquinasLimpias(); track m.codigo) {
                  <li class="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5 text-sm">
                    <span class="text-slate-200">{{ m.nombre }}</span>
                    <span class="flex items-center gap-2 text-xs text-slate-400">
                      <span class="rounded bg-slate-800 px-1.5 py-0.5">{{ m.codigo }}</span>
                      @if (m.disciplina) {
                        <span>{{ m.disciplina }}</span>
                      } @else {
                        <span>Sin disciplina</span>
                      }
                    </span>
                  </li>
                }
              </ul>
            </div>
          }

          @if (errorGeneral(); as err) {
            <p role="alert" class="fld-error" data-testid="error-servidor">{{ err }}</p>
          }

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="volver"
              (click)="volver()"
              [disabled]="submitting()"
            >
              Volver
            </button>
            <button
              type="button"
              class="btn-primary"
              data-testid="guardar"
              (click)="guardar()"
              [disabled]="submitting()"
            >
              {{ submitting() ? 'Creando…' : 'Crear planta' }}
            </button>
          </div>
        </div>
      }
    </app-modal>
  `,
})
export class PlantaFormModalComponent {
  private readonly catalogo = inject(CatalogService);
  private readonly toast = inject(ToastService);

  /**
   * Planta a editar. `null` (por defecto) = alta masiva.
   *
   * En edición sólo se tocan nombre y ubicación: las listas de disciplinas y máquinas se
   * ocultan porque agregar máquinas a una planta existente tiene su propio modal
   * (`maquina-form-modal`), y el backend no permite recrear dependencias desde el PATCH.
   */
  readonly planta = input<Plant | null>(null);

  readonly closed = output<void>();
  readonly saved = output<PlantaActualizada | PlantaCompletaResponse>();

  protected readonly esEdicion = computed(() => this.planta() !== null);

  /** Paso actual: captura de datos o confirmación. */
  protected readonly paso = signal<'form' | 'confirmar'>('form');
  protected readonly submitting = signal(false);
  protected readonly errorGeneral = signal<string | null>(null);

  protected readonly model = linkedSignal<PlantaFormModel>(() => ({
    nombre: this.planta()?.name ?? '',
    ubicacion: this.planta()?.ubicacion ?? '',
  }));
  protected readonly f = form(this.model, (p) => {
    required(p.nombre, { message: 'Ingresa el nombre de la planta.' });
    validate(p.nombre, ({ value }) =>
      value().trim().length >= 2
        ? undefined
        : { kind: 'minlength', message: 'El nombre debe tener al menos 2 caracteres.' },
    );
  });

  protected readonly disciplinas = signal<string[]>([]);
  protected readonly maquinas = signal<MaquinaForm[]>([]);

  /** Disciplinas ya escritas y no vacías: alimentan el selector de cada máquina. */
  protected readonly disciplinasLimpas = computed(() => {
    const vistas = new Set<string>();
    const salida: string[] = [];
    for (const bruta of this.disciplinas()) {
      const nombre = bruta.trim();
      const clave = nombre.toLowerCase();
      if (!nombre || vistas.has(clave)) continue;
      vistas.add(clave);
      salida.push(nombre);
    }
    return salida;
  });

  protected readonly opcionesDisciplina = this.disciplinasLimpas;

  protected readonly totalDisciplinas = computed(() => this.disciplinasLimpas().length);

  /**
   * Máquinas listas para enviar.
   *
   * Una fila completamente vacía se descarta (el usuario agregó y no llenó). Una fila a
   * medias se conserva para que `errorMaquinas` la señale; mandarla produciría un 422 del
   * backend con un mensaje menos claro que el de aquí.
   */
  protected readonly maquinasLimpias = computed<MaquinaNuevaPayload[]>(() =>
    this.maquinas()
      .filter((m) => m.nombre.trim() || m.codigo.trim())
      .map((m) => ({
        nombre: m.nombre.trim(),
        codigo: m.codigo.trim(),
        disciplina: m.disciplina.trim() || null,
        sla_horas: this.numeroOpcional(m.slaHoras),
        costo_inactividad_minuto: this.numeroOpcional(m.costoInactividad),
      })),
  );

  /** `''` → null (sin dato); `'0'` → 0 (valor explícito). */
  private numeroOpcional(texto: string): number | null {
    const limpio = (texto ?? '').trim();
    if (!limpio) return null;
    const n = Number(limpio);
    return Number.isFinite(n) ? n : null;
  }

  protected readonly totalMaquinas = computed(() => this.maquinasLimpias().length);

  /** Primer problema de las máquinas, o null si están bien. */
  protected readonly errorMaquinas = computed<string | null>(() => {
    const filas = this.maquinas().filter((m) => m.nombre.trim() || m.codigo.trim());
    if (filas.some((m) => !m.nombre.trim())) return 'Cada máquina necesita un nombre.';
    if (filas.some((m) => !m.codigo.trim())) return 'Cada máquina necesita un código.';

    const codigos = filas.map((m) => m.codigo.trim().toLowerCase());
    if (new Set(codigos).size !== codigos.length) {
      return 'Hay dos máquinas con el mismo código.';
    }

    // Los numéricos son opcionales, pero si se escriben tienen que ser válidos: un SLA
    // negativo o un texto suelto no deben llegar al backend (que respondería 422).
    if (filas.some((m) => !this.slaValido(m.slaHoras))) {
      return 'El SLA debe ser un número entre 0 y 8760 horas (o quedar vacío).';
    }
    if (filas.some((m) => !this.costoValido(m.costoInactividad))) {
      return 'El costo de inactividad debe ser un número mayor o igual a 0 (o quedar vacío).';
    }
    return null;
  });

  private slaValido(texto: string): boolean {
    const limpio = (texto ?? '').trim();
    if (!limpio) return true;
    const n = Number(limpio);
    return Number.isFinite(n) && n >= 0 && n <= 8760;
  }

  private costoValido(texto: string): boolean {
    const limpio = (texto ?? '').trim();
    if (!limpio) return true;
    const n = Number(limpio);
    return Number.isFinite(n) && n >= 0;
  }

  protected agregarDisciplina(): void {
    this.disciplinas.update((d) => [...d, '']);
  }

  protected quitarDisciplina(indice: number): void {
    this.disciplinas.update((d) => d.filter((_, i) => i !== indice));
  }

  protected cambiarDisciplina(indice: number, valor: string): void {
    this.disciplinas.update((d) => d.map((v, i) => (i === indice ? valor : v)));
  }

  protected agregarMaquina(): void {
    this.maquinas.update((m) => [
      ...m,
      { nombre: '', codigo: '', disciplina: '', slaHoras: '', costoInactividad: '' },
    ]);
  }

  protected quitarMaquina(indice: number): void {
    this.maquinas.update((m) => m.filter((_, i) => i !== indice));
  }

  protected cambiarMaquina(indice: number, campo: keyof MaquinaForm, valor: string): void {
    this.maquinas.update((m) => m.map((v, i) => (i === indice ? { ...v, [campo]: valor } : v)));
  }

  /** Valida y pasa al resumen. No envía nada todavía. */
  protected irAConfirmar(): void {
    this.f().markAsTouched();
    this.errorGeneral.set(null);
    if (!this.f().valid() || this.errorMaquinas()) return;
    this.paso.set('confirmar');
  }

  protected volver(): void {
    this.errorGeneral.set(null);
    this.paso.set('form');
  }

  protected guardar(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.errorGeneral.set(null);

    const planta = this.planta();

    // Edición: PATCH con nombre y ubicación. No se tocan disciplinas ni máquinas.
    if (planta) {
      this.catalogo
        .actualizarPlanta(planta.id, {
          nombre: this.model().nombre.trim(),
          ubicacion: this.model().ubicacion.trim() || null,
        })
        .subscribe({
          next: (respuesta) => {
            this.submitting.set(false);
            this.toast.success(`Planta «${respuesta.nombre}» actualizada.`);
            this.saved.emit(respuesta);
          },
          error: (err) => {
            this.submitting.set(false);
            const mensaje = apiErrorMessage(err, 'No se pudo actualizar la planta.');
            this.errorGeneral.set(mensaje);
            this.toast.error(mensaje);
          },
        });
      return;
    }

    const payload: PlantaCompletaPayload = {
      nombre: this.model().nombre.trim(),
      ubicacion: this.model().ubicacion.trim() || null,
      disciplinas: this.disciplinasLimpas(),
      maquinas: this.maquinasLimpias(),
    };

    this.catalogo.crearPlantaCompleta(payload).subscribe({
      next: (respuesta) => {
        this.submitting.set(false);
        const creadas = respuesta.disciplinas.filter((d) => d.creada).length;
        const reutilizadas = respuesta.disciplinas.length - creadas;
        const detalle =
          respuesta.disciplinas.length > 0
            ? ` ${creadas} disciplina(s) nueva(s), ${reutilizadas} reutilizada(s).`
            : '';
        this.toast.success(`Planta «${respuesta.nombre}» creada.${detalle}`);
        this.saved.emit(respuesta);
      },
      error: (err) => {
        this.submitting.set(false);
        // 409 (nombre de planta o código de máquina repetido) se muestra tal cual lo
        // explica el backend: es más útil que un mensaje genérico.
        const mensaje = apiErrorMessage(err, 'No se pudo crear la planta.');
        this.errorGeneral.set(mensaje);
        this.toast.error(mensaje);
      },
    });
  }
}

