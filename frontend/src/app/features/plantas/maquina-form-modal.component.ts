import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormField, form, required, validate } from '@angular/forms/signals';

import { Discipline, MaquinaCreada, MaquinaNuevaPayload, Plant } from '../../core/models';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';

interface MaquinaModel {
  nombre: string;
  codigo: string;
  disciplina: string;
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
      title="Agregar máquina"
      [subtitle]="'Se agregará a la planta «' + planta().name + '».'"
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
          <p class="mt-1 text-xs text-slate-400">
            Si no existe en tu empresa, se crea.
          </p>
        </div>

        @if (errorGeneral(); as err) {
          <p role="alert" class="fld-error" data-testid="error-servidor">{{ err }}</p>
        }

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            class="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            (click)="closed.emit()"
            [disabled]="submitting()"
          >
            Cancelar
          </button>
          <button type="submit" class="btn-primary" data-testid="guardar-maquina" [disabled]="submitting()">
            {{ submitting() ? 'Agregando…' : 'Agregar máquina' }}
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
  readonly saved = output<MaquinaCreada>();

  protected readonly submitting = signal(false);
  protected readonly errorGeneral = signal<string | null>(null);

  protected readonly model = signal<MaquinaModel>({ nombre: '', codigo: '', disciplina: '' });
  protected readonly f = form(this.model, (p) => {
    required(p.nombre, { message: 'Ingresa el nombre de la máquina.' });
    required(p.codigo, { message: 'Ingresa el código de la máquina.' });
    validate(p.codigo, ({ value }) =>
      value().trim().length >= 1
        ? undefined
        : { kind: 'required', message: 'Ingresa el código de la máquina.' },
    );
  });

  protected readonly nombresDisciplinas = computed(() =>
    this.disciplinas().map((d) => d.name).sort((a, b) => a.localeCompare(b)),
  );

  protected guardar(): void {
    if (this.submitting()) return;
    this.f().markAsTouched();
    if (!this.f().valid()) return;

    const payload: MaquinaNuevaPayload = {
      nombre: this.model().nombre.trim(),
      codigo: this.model().codigo.trim(),
      disciplina: this.model().disciplina.trim() || null,
    };

    this.submitting.set(true);
    this.errorGeneral.set(null);
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
