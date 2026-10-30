import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, form, required, validate } from '@angular/forms/signals';

import { Discipline, Machine, MaquinaActualizada, MaquinaCreada, MaquinaNuevaPayload, MaquinaUpdatePayload, Plant } from '../../core/models';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';

interface MaquinaModel {
  nombre: string;
  codigo: string;
  disciplina: string;
  /**
   * Se guardan como texto, no como number: un `<input type="number">` vacío debe
   * significar «usar el default», no 0. Un 0 explícito es un SLA válido (atención
   * inmediata), así que la distinción importa y se resuelve al enviar.
   */
  slaHoras: string;
  costoInactividad: string;
}

/**
 * Agrega una máquina a una planta existente (HU-25 / CGBIDA-461, CGBIDA-466).
 *
 * Es el complemento del alta masiva: aquel crea planta + dependencias de una vez; este
 * suma una máquina a una planta que ya existe, sin recrear nada.
 *
 * La disciplina es un texto libre con sugerencias (`datalist`) de las que ya usa la
 * empresa: si se escribe una nueva, el backend la crea; si coincide con una existente, la
 * reutiliza. Así no hace falta un selector que obligue a cargar el catálogo completo.
 */
@Component({
  selector: 'app-maquina-form-modal',
  imports: [FormField, ModalComponent],
  template: `
    <app-modal
      [title]="esEdicion() ? 'Editar máquina' : 'Agregar máquina'"
      [subtitle]="
        esEdicion()
          ? 'Cambia los datos de «' + maquina()!.name + '» en ' + planta().name + '.'
          : 'Se agregará a la planta «' + planta().name + '».'
      "
      (closed)="closed.emit()"
    >
      <form class="grid gap-4" (submit)="$event.preventDefault(); guardar()" novalidate>
        <div>
          <label for="maq-nombre" class="fld-label">Nombre de la máquina *</label>
          <input
            id="maq-nombre"
            type="text"
            class="fld-input"
            data-testid="maquina-nombre"
            placeholder="Compressor A1"
            [formField]="f.nombre"
            [attr.aria-invalid]="f.nombre().touched() && f.nombre().invalid()"
          />
          @if (f.nombre().touched() && f.nombre().invalid()) {
            <p role="alert" class="fld-error" data-testid="error-nombre">
              {{ f.nombre().errors()[0]?.message }}
            </p>
          }
        </div>

        <div>
          <label for="maq-codigo" class="fld-label">Código *</label>
          <input
            id="maq-codigo"
            type="text"
            class="fld-input"
            data-testid="maquina-codigo"
            placeholder="CMP-01"
            [formField]="f.codigo"
            [attr.aria-invalid]="f.codigo().touched() && f.codigo().invalid()"
          />
          @if (f.codigo().touched() && f.codigo().invalid()) {
            <p role="alert" class="fld-error" data-testid="error-codigo">
              {{ f.codigo().errors()[0]?.message }}
            </p>
          }
        </div>

        <div>
          @if (esEdicion()) {
            <!-- En edición se elige una disciplina existente: crear una nueva es parte del
                 alta de la planta, no de editar un equipo. -->
            <label for="maq-disciplina" class="fld-label">Disciplina</label>
            <select
              id="maq-disciplina"
              class="fld-input"
              data-testid="maquina-disciplina-select"
              [value]="model().disciplina"
              (change)="cambiarDisciplinaSelect($any($event.target).value)"
            >
              <option value="">Sin disciplina</option>
              @for (d of disciplinas(); track d.id) {
                <option [value]="d.id" [selected]="model().disciplina === '' + d.id">{{ d.name }}</option>
              }
            </select>
          } @else {
            <label for="maq-disciplina" class="fld-label">Disciplina</label>
            <input
              id="maq-disciplina"
              type="text"
              class="fld-input"
              list="disciplinas-existentes"
              placeholder="Mecánica, Eléctrica… (opcional)"
              data-testid="maquina-disciplina"
              [formField]="f.disciplina"
            />
            <datalist id="disciplinas-existentes">
              @for (d of nombresDisciplinas(); track d) {
                <option [value]="d"></option>
              }
            </datalist>
            <p class="mt-1 text-sm text-tinta-suave">
              Si no existe en tu empresa, se crea.
            </p>
          }
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="maq-sla-horas" class="fld-label">SLA de la máquina (horas)</label>
            <input
              id="maq-sla-horas"
              type="number"
              step="0.5"
              class="fld-input"
              placeholder="24"
              data-testid="maquina-sla-horas"
              [formField]="f.slaHoras"
            />
            <p class="mt-1 text-sm text-tinta-suave">
              Tiempo máximo para atender una OT de este equipo. Vacío = SLA general de la empresa.
            </p>
          </div>

          <div>
            <label for="maq-costo-inactividad" class="fld-label">Costo de inactividad (por minuto)</label>
            <input
              id="maq-costo-inactividad"
              type="number"
              step="100"
              class="fld-input"
              placeholder="2000"
              data-testid="maquina-costo-inactividad"
              [formField]="f.costoInactividad"
            />
            <p class="mt-1 text-sm text-tinta-suave">
              Cuánto cuesta cada minuto de esta máquina detenida. Vacío = sin valorización por equipo.
            </p>
          </div>
        </div>

        @if (errorGeneral(); as err) {
          <p role="alert" class="fld-error" data-testid="error-servidor">{{ err }}</p>
        }

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            class="rounded-control border border-borde px-4 py-2 text-sm text-tinta hover:bg-superficie focus:outline-none focus:ring-2 focus:ring-accion"
            (click)="closed.emit()"
            [disabled]="submitting()"
          >
            Cancelar
          </button>
          <button type="submit" class="btn-primary" data-testid="guardar-maquina" [disabled]="submitting()">
            {{ submitting() ? (esEdicion() ? 'Guardando…' : 'Agregando…') : (esEdicion() ? 'Guardar cambios' : 'Agregar máquina') }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class MaquinaFormModalComponent {
  private readonly catalogo = inject(CatalogService);
  private readonly toast = inject(ToastService);

  /** Planta destino. Obligatoria: el modal no tiene sentido sin ella. */
  readonly planta = input.required<Plant>();
  /** Disciplinas de la empresa, para sugerir en el campo de texto. */
  readonly disciplinas = input<Discipline[]>([]);

  readonly closed = output<void>();
  /** Máquina a editar. `null` = alta de una máquina nueva. */
  readonly maquina = input<Machine | null>(null);

  readonly saved = output<MaquinaCreada | MaquinaActualizada>();

  protected readonly submitting = signal(false);
  protected readonly errorGeneral = signal<string | null>(null);

  /** `true` = se está editando una máquina existente (PATCH); `false` = alta (POST). */
  protected readonly esEdicion = computed(() => this.maquina() !== null);

  /**
   * En edición se parte de la máquina; en alta, de campos vacíos. `linkedSignal` recalcula
   * el estado inicial cuando cambia el input, así el mismo componente sirve para los dos
   * casos sin duplicar el formulario.
   *
   * En edición, `disciplina` guarda el **id** de la disciplina (se elige de una lista); en
   * alta guarda el **nombre** (se puede escribir una nueva y el backend la crea).
   */
  protected readonly model = linkedSignal<MaquinaModel>(() => {
    const m = this.maquina();
    if (!m) {
      return { nombre: '', codigo: '', disciplina: '', slaHoras: '', costoInactividad: '' };
    }
    return {
      nombre: m.name,
      codigo: m.codigo ?? '',
      disciplina: m.discipline_id ? String(m.discipline_id) : '',
      slaHoras: m.sla_horas != null ? String(m.sla_horas) : '',
      costoInactividad:
        m.costo_inactividad_minuto != null ? String(m.costo_inactividad_minuto) : '',
    };
  });
  protected readonly f = form(this.model, (p) => {
    required(p.nombre, { message: 'Ingresa el nombre de la máquina.' });
    required(p.codigo, { message: 'Ingresa el código de la máquina.' });
    validate(p.codigo, ({ value }) =>
      value().trim().length >= 1
        ? undefined
        : { kind: 'required', message: 'Ingresa el código de la máquina.' },
    );
    // Los numéricos son opcionales, pero si se escriben tienen que ser válidos: un SLA
    // negativo o un texto suelto no deben llegar al backend.
    validate(p.slaHoras, ({ value }) => {
      const texto = value().trim();
      if (!texto) return undefined;
      const n = Number(texto);
      if (!Number.isFinite(n) || n < 0 || n > 8760) {
        return { kind: 'range', message: 'El SLA debe ser un número entre 0 y 8760 horas.' };
      }
      return undefined;
    });
    validate(p.costoInactividad, ({ value }) => {
      const texto = value().trim();
      if (!texto) return undefined;
      const n = Number(texto);
      if (!Number.isFinite(n) || n < 0) {
        return { kind: 'range', message: 'El costo debe ser un número mayor o igual a 0.' };
      }
      return undefined;
    });
  });

  protected readonly nombresDisciplinas = computed(() =>
    this.disciplinas().map((d) => d.name).sort((a, b) => a.localeCompare(b)),
  );

  /** `''` → null (sin dato); `'0'` → 0 (valor explícito). */
  private numeroOpcional(texto: string): number | null {
    const limpio = texto.trim();
    if (!limpio) return null;
    const n = Number(limpio);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Cambio de disciplina en modo edición. Va por `model.update` en vez de `[formField]`
   * porque el `<select>` compara `string` del DOM con el `number` del catálogo y el binding
   * de Signal Forms dejaba el control vacío.
   */
  protected cambiarDisciplinaSelect(valor: string): void {
    this.model.update((m) => ({ ...m, disciplina: valor }));
  }

  protected guardar(): void {
    if (this.submitting()) return;
    this.f().markAsTouched();
    if (!this.f().valid()) return;

    this.submitting.set(true);
    this.errorGeneral.set(null);

    if (this.esEdicion()) {
      const id = this.maquina()!.id;
      // En edición, `disciplina` guarda el id: se elige de la lista de la empresa.
      const texto = this.model().disciplina.trim();
      const payload: MaquinaUpdatePayload = {
        nombre: this.model().nombre.trim(),
        codigo: this.model().codigo.trim(),
        disciplina_id: texto ? Number(texto) : null,
        sla_horas: this.numeroOpcional(this.model().slaHoras),
        costo_inactividad_minuto: this.numeroOpcional(this.model().costoInactividad),
      };
      this.catalogo.actualizarMaquina(id, payload).subscribe({
        next: (maquina) => {
          this.submitting.set(false);
          this.toast.success(`Máquina «${maquina.nombre}» actualizada.`);
          this.saved.emit(maquina);
        },
        error: (err) => {
          this.submitting.set(false);
          const mensaje = apiErrorMessage(err, 'No se pudo actualizar la máquina.');
          this.errorGeneral.set(mensaje);
          this.toast.error(mensaje);
        },
      });
      return;
    }

    const payload: MaquinaNuevaPayload = {
      nombre: this.model().nombre.trim(),
      codigo: this.model().codigo.trim(),
      disciplina: this.model().disciplina.trim() || null,
      // Vacío → null (usa el default de la empresa). "0" es un valor válido y se respeta.
      sla_horas: this.numeroOpcional(this.model().slaHoras),
      costo_inactividad_minuto: this.numeroOpcional(this.model().costoInactividad),
    };

    this.catalogo.agregarMaquina(this.planta().id, payload).subscribe({
      next: (maquina) => {
        this.submitting.set(false);
        this.toast.success(`Máquina «${maquina.nombre}» agregada a ${this.planta().name}.`);
        this.saved.emit(maquina);
      },
      error: (err) => {
        this.submitting.set(false);
        // El 409 de código repetido trae un mensaje del dominio; se muestra tal cual.
        const mensaje = apiErrorMessage(err, 'No se pudo agregar la máquina.');
        this.errorGeneral.set(mensaje);
        this.toast.error(mensaje);
      },
    });
  }
}
