import { Component, DestroyRef, effect, inject, output, signal } from '@angular/core';
import { form, required, validate, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

import { PermissionsService } from '../../core/permissions/permissions.service';
import { Aviso, Machine, WorkOrderSeverity } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { Icon } from '../../shared/components/ui/icon/icon';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { GRAVEDADES, SINTOMAS } from './etiquetas';
import { GravedadMedidor } from './gravedad-medidor';
import { reducirImagen } from './reducir-imagen';

interface ReportarFallaModel {
  machineId: string;
  severidad: WorkOrderSeverity;
  descripcion: string;
}

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FOTO_MB = 5;
const CLAVE_BORRADOR = 'barb.aviso.borrador';
const CLAVE_RECIENTES = 'barb.aviso.maquinas';
const MAX_RECIENTES = 4;

const modeloInicial = (): ReportarFallaModel => ({ machineId: '', severidad: 'medium', descripcion: '' });

function leer<T>(clave: string, defecto: T): T {
  try {
    const crudo = typeof localStorage === 'undefined' ? null : localStorage.getItem(clave);
    return crudo ? (JSON.parse(crudo) as T) : defecto;
  } catch {
    return defecto;
  }
}

function guardar(clave: string, valor: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento local (modo privado, cuota): el borrador es una ayuda, no un requisito.
  }
}

function borrar(clave: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(clave);
  } catch {
    // ver `guardar`
  }
}

/**
 * Reportar una falla, pensado para hacerse de pie, con una mano y a veces con guantes: máquina → qué pasa → gravedad →
 * foto. En móvil es una hoja inferior con el botón de enviar siempre visible. El aviso llega al supervisor, que decide
 * si se genera una orden de trabajo. Lo escrito se guarda como borrador si se cierra sin enviar.
 */
@Component({
  selector: 'app-reportar-falla',
  imports: [FormField, ModalComponent, Icon, GravedadMedidor],
  template: `
    <app-modal
      [title]="creado() ? 'Aviso enviado' : 'Reportar una falla'"
      [subtitle]="creado() ? '' : 'Tu aviso llega al supervisor, que decide si se genera una orden de trabajo.'"
      (closed)="cerrar()">
      @if (creado(); as aviso) {
        <div class="grid justify-items-center gap-3 py-6 text-center" data-testid="aviso-confirmacion" role="status">
          <span class="text-ok"><app-icon name="check-circulo" [size]="64" /></span>
          <p class="text-lg">Tu aviso quedó registrado con el número</p>
          <p class="codigo text-4xl text-accion" data-testid="aviso-numero">{{ aviso.numero_aviso }}</p>
          <p class="max-w-sm text-tinta-suave">
            El supervisor lo revisará y decidirá si genera una orden de trabajo. Puedes seguir su estado en {{ puedeGestionar() ? 'la bandeja' : 'Mis avisos' }}.
          </p>
        </div>
      } @else {
        <div class="grid gap-6">
          <div>
            <label for="aviso-machine" class="fld-label">1. ¿Qué máquina tiene la falla?</label>
            @if (recientes().length) {
              <div class="mb-2 flex flex-wrap gap-2" role="group" aria-label="Máquinas recientes">
                @for (m of recientes(); track m.id) {
                  <button type="button" class="pill" [attr.aria-pressed]="model().machineId === '' + m.id" (click)="elegirMaquina(m.id)">
                    {{ m.name }}
                  </button>
                }
              </div>
            }
            <select
              id="aviso-machine"
              [formField]="avisoForm.machineId"
              [attr.aria-invalid]="avisoForm.machineId().touched() && avisoForm.machineId().invalid()"
              [attr.aria-describedby]="avisoForm.machineId().touched() && avisoForm.machineId().invalid() ? 'aviso-machine-error' : null"
              class="fld-input">
              <option value="">Selecciona la máquina</option>
              @for (m of machines(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
            @if (avisoForm.machineId().touched() && avisoForm.machineId().invalid()) {
              <p id="aviso-machine-error" role="alert" class="fld-error">{{ avisoForm.machineId().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label for="aviso-descripcion" class="fld-label">2. ¿Qué está pasando?</label>
            <div class="mb-2 flex flex-wrap gap-2" role="group" aria-label="Síntomas frecuentes">
              @for (s of sintomas; track s) {
                <button type="button" class="pill" (click)="agregarSintoma(s)">{{ s }}</button>
              }
            </div>
            <textarea
              id="aviso-descripcion"
              rows="4"
              [formField]="avisoForm.descripcion"
              [attr.aria-invalid]="avisoForm.descripcion().touched() && avisoForm.descripcion().invalid()"
              [attr.aria-describedby]="avisoForm.descripcion().touched() && avisoForm.descripcion().invalid() ? 'aviso-descripcion-error' : null"
              placeholder="Ej. Vibración anormal y ruido metálico en el motor al arrancar."
              class="fld-input resize-none"></textarea>
            @if (avisoForm.descripcion().touched() && avisoForm.descripcion().invalid()) {
              <p id="aviso-descripcion-error" role="alert" class="fld-error">{{ avisoForm.descripcion().errors()[0]?.message }}</p>
            }
          </div>

          <fieldset>
            <legend class="fld-label">3. ¿Qué tan grave es?</legend>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              @for (g of gravedades; track g.value) {
                <label
                  class="flex min-h-14 cursor-pointer items-center justify-center rounded-control border-2 px-2 py-2 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accion"
                  [class]="model().severidad === g.value ? 'border-accion bg-accion-suave' : 'border-borde-control bg-superficie hover:bg-superficie-2'">
                  <input
                    type="radio"
                    name="aviso-severidad"
                    class="sr-only"
                    [value]="g.value"
                    [checked]="model().severidad === g.value"
                    (change)="elegirGravedad(g.value)" />
                  <app-gravedad [severidad]="g.value" />
                </label>
              }
            </div>
            <p class="fld-ayuda">El supervisor define la prioridad real al atender el aviso.</p>
          </fieldset>

          <div>
            <span id="aviso-foto-label" class="fld-label">4. Foto de la falla (opcional)</span>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="btn-secondary" data-testid="btn-camara" (click)="camara.click()">
                <app-icon name="camara" [size]="22" />
                Tomar foto
              </button>
              <button type="button" class="btn-secondary" data-testid="btn-galeria" (click)="galeria.click()">
                <app-icon name="imagen" [size]="22" />
                Elegir de la galería
              </button>
              <input #camara id="aviso-foto-camara" type="file" class="hidden" accept="image/*" capture="environment" aria-hidden="true" tabindex="-1" (change)="onFoto($event)" />
              <input
                #galeria
                id="aviso-foto"
                type="file"
                class="hidden"
                accept="image/jpeg,image/png,image/webp"
                aria-labelledby="aviso-foto-label"
                tabindex="-1"
                (change)="onFoto($event)" />
            </div>
            @if (preview(); as src) {
              <div class="mt-3 flex items-start gap-3">
                <img [src]="src" alt="Vista previa de la foto adjunta" class="max-h-40 max-w-[60%] rounded-control border border-borde object-contain" />
                <div class="grid gap-1">
                  <p class="text-sm text-tinta-suave" aria-live="polite">{{ foto()?.name }}</p>
                  <button type="button" class="btn-ghost justify-start" (click)="quitarFoto()">
                    <app-icon name="x" [size]="18" />
                    Quitar
                  </button>
                </div>
              </div>
            } @else {
              <p class="fld-ayuda" aria-live="polite">{{ procesandoFoto() ? 'Preparando la foto…' : 'Sin foto' }}</p>
            }
            <p class="fld-ayuda">JPEG, PNG o WEBP, hasta 5 MB. Ayuda al supervisor a entender la falla.</p>
          </div>
        </div>
      }

      <div modal-footer>
        @if (creado()) {
          <div class="grid gap-2 sm:grid-cols-2">
            <button type="button" class="btn-secondary" data-testid="btn-otra" (click)="reportarOtra()">Reportar otra</button>
            <button type="button" class="btn-primary" data-testid="btn-ver-avisos" (click)="verAvisos()">
              {{ puedeGestionar() ? 'Ver bandeja' : 'Ver mis avisos' }}
            </button>
          </div>
        } @else {
          <div class="grid gap-2 sm:flex sm:justify-end">
            <button type="button" class="btn-ghost order-2 sm:order-1" (click)="cerrar()">Cancelar</button>
            <button type="button" class="btn-primary order-1 min-h-14 text-lg sm:order-2 sm:min-h-10 sm:text-sm" [disabled]="enviando()" (click)="enviar()">
              {{ enviando() ? 'Enviando…' : 'Enviar aviso' }}
            </button>
          </div>
        }
      </div>
    </app-modal>
  `,
})
export class ReportarFalla {
  private readonly api = inject(AvisosApi);
  private readonly catalog = inject(CatalogService);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly permissions = inject(PermissionsService);

  readonly closed = output<void>();
  readonly created = output<Aviso>();

  protected readonly gravedades = GRAVEDADES;
  protected readonly sintomas = SINTOMAS;
  protected readonly machines = signal<Machine[]>([]);
  protected readonly recientes = signal<Machine[]>([]);
  protected readonly enviando = signal(false);
  protected readonly procesandoFoto = signal(false);
  protected readonly creado = signal<Aviso | null>(null);
  protected readonly foto = signal<File | null>(null);
  protected readonly preview = signal<SafeUrl | null>(null);
  private previewUrl: string | null = null;

  protected readonly model = signal<ReportarFallaModel>({ ...modeloInicial(), ...leer<Partial<ReportarFallaModel>>(CLAVE_BORRADOR, {}) });
  protected readonly avisoForm = form(this.model, (f) => {
    required(f.machineId, { message: 'Selecciona la máquina.' });
    required(f.descripcion, { message: 'Describe la falla.' });
    validate(f.descripcion, ({ value }) => (value().trim() ? undefined : { kind: 'blank', message: 'Describe la falla.' }));
  });

  protected readonly puedeGestionar = () => this.permissions.canPerform('gestionar_avisos');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.liberarVistaPrevia());

    // Borrador: lo escrito sobrevive a un cierre accidental o a una pérdida de señal. Se borra al enviar.
    effect(() => {
      const m = this.model();
      if (this.creado()) return;
      if (m.machineId || m.descripcion.trim()) guardar(CLAVE_BORRADOR, m);
    });

    this.catalog.getMachines().subscribe({
      next: (machines) => {
        this.machines.set(machines ?? []);
        const ids = leer<number[]>(CLAVE_RECIENTES, []);
        this.recientes.set(ids.map((id) => (machines ?? []).find((m) => m.id === id)).filter((m): m is Machine => !!m));
      },
      error: () => this.toast.error('No se pudieron cargar las máquinas.'),
    });
  }

  protected cerrar(): void {
    this.closed.emit();
  }

  protected elegirMaquina(id: number): void {
    this.model.update((m) => ({ ...m, machineId: String(id) }));
  }

  protected elegirGravedad(severidad: WorkOrderSeverity): void {
    this.model.update((m) => ({ ...m, severidad }));
  }

  protected agregarSintoma(texto: string): void {
    this.model.update((m) => {
      const actual = m.descripcion.trim();
      return { ...m, descripcion: actual ? `${actual}. ${texto}` : texto };
    });
  }

  protected async onFoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const original = input.files?.[0] ?? null;
    input.value = ''; // permite volver a elegir el mismo archivo
    if (!original) return;

    if (!TIPOS_FOTO.includes(original.type)) {
      this.toast.error('Solo se permiten imágenes JPEG, PNG o WEBP.');
      return;
    }
    // Se reduce primero (una foto de celular suele pesar más de 5 MB) y el límite se aplica a lo que de verdad se envía.
    this.procesandoFoto.set(true);
    const archivo = await reducirImagen(original);
    this.procesandoFoto.set(false);
    if (archivo.size > MAX_FOTO_MB * 1024 * 1024) {
      this.toast.error(`La imagen supera el máximo de ${MAX_FOTO_MB} MB.`);
      return;
    }
    this.liberarVistaPrevia();
    this.previewUrl = URL.createObjectURL(archivo);
    // URL de un blob que acabamos de crear nosotros: es seguro.
    this.preview.set(this.sanitizer.bypassSecurityTrustUrl(this.previewUrl));
    this.foto.set(archivo);
  }

  protected quitarFoto(): void {
    this.liberarVistaPrevia();
    this.foto.set(null);
    this.preview.set(null);
  }

  private liberarVistaPrevia(): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
  }

  protected enviar(): void {
    if (this.enviando()) return;
    this.avisoForm().markAsTouched();
    if (!this.avisoForm().valid()) return;

    const m = this.model();
    this.enviando.set(true);
    const payload = { maquina_id: Number(m.machineId), descripcion: m.descripcion.trim(), severidad: m.severidad };
    this.api.create(payload, this.foto()).subscribe({
      next: (aviso) => {
        this.enviando.set(false);
        this.recordarMaquina(payload.maquina_id);
        borrar(CLAVE_BORRADOR);
        this.creado.set(aviso);
        this.created.emit(aviso);
      },
      error: (err) => {
        this.enviando.set(false);
        this.toast.error(apiErrorMessage(err, 'No se pudo enviar el aviso.'));
      },
    });
  }

  protected reportarOtra(): void {
    this.creado.set(null);
    this.quitarFoto();
    this.model.set(modeloInicial());
    this.avisoForm().reset();
  }

  protected verAvisos(): void {
    this.closed.emit();
    void this.router.navigateByUrl('/avisos');
  }

  private recordarMaquina(id: number): void {
    const ids = [id, ...leer<number[]>(CLAVE_RECIENTES, []).filter((x) => x !== id)].slice(0, MAX_RECIENTES);
    guardar(CLAVE_RECIENTES, ids);
  }
}
