import { Component, computed, DestroyRef, effect, inject, output, signal } from '@angular/core';
import { form, required, validate, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

import { PermissionsService } from '../../core/permissions/permissions.service';
import { Aviso, Discipline, Machine, Plant } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { Icon } from '../../shared/components/ui/icon/icon';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { sintomasFrecuentes } from './etiquetas';
import { reducirImagen } from './reducir-imagen';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
interface ReportarFallaModel {
  machineId: string;
  descripcion: string;
}

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FOTO_MB = 5;
const CLAVE_BORRADOR = 'barb.aviso.borrador';
const CLAVE_RECIENTES = 'barb.aviso.maquinas';
const MAX_RECIENTES = 4;

const modeloInicial = (): ReportarFallaModel => ({ machineId: '', descripcion: '' });

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
 * Reportar una falla, pensado para hacerse de pie, con una mano y a veces con guantes:
 * planta → disciplina → máquina → qué pasa → foto. En móvil es una hoja inferior con el
 * botón de enviar siempre visible. El aviso llega al supervisor, que decide si se genera
 * una orden de trabajo y con qué gravedad. Lo escrito se guarda como borrador si se cierra
 * sin enviar.
 */
@Component({
  selector: 'app-reportar-falla',
  imports: [FormField, ModalComponent, Icon, TranslatePipe],
  template: `
    <app-modal
      [title]="(creado() ? 'avisos.aviso_enviado' : 'avisos.reportar_una_falla') | translate"
      [subtitle]="creado() ? '' : ('avisos.tu_aviso_llega_al' | translate)"
      (closed)="cerrar()">
      @if (creado(); as aviso) {
        <div class="grid justify-items-center gap-3 py-6 text-center" data-testid="aviso-confirmacion" role="status">
          <span class="text-ok"><app-icon name="check-circulo" [size]="64" /></span>
          <p class="text-lg">{{ 'avisos.tu_aviso_quedo_registrado' | translate }}</p>
          <p class="codigo text-4xl text-accion" data-testid="aviso-numero">{{ aviso.numero_aviso }}</p>
          <p class="max-w-sm text-tinta-suave">
            {{ 'avisos.el_supervisor_lo_revisara' | translate: { v0: (puedeGestionar() ? 'avisos.la_bandeja' : 'avisos.mis_avisos') | translate } }}
          </p>
        </div>
      } @else {
        <div class="grid gap-6">
          <!--
            Filtros en cascada: planta -> disciplina -> maquina. Con 21 maquinas el select
            unico obligaba a buscar a mano; acotando por planta y disciplina el operario
            llega al equipo en dos toques. Planta manda: sin ella la disciplina y la
            maquina quedan deshabilitadas.
          -->
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label for="aviso-planta" class="fld-label">{{ 'avisos.planta' | translate }}</label>
              <select
                id="aviso-planta"
                class="fld-input"
                data-testid="select-planta"
                [value]="plantaId()"
                (change)="cambiarPlanta($any($event.target).value)">
                <option value="">{{ 'avisos.selecciona_la_planta' | translate }}</option>
                @for (p of plantas(); track p.id) {
                  <option [value]="p.id" [selected]="plantaId() === '' + p.id">{{ p.name }}</option>
                }
              </select>
            </div>
            <div>
              <label for="aviso-disciplina" class="fld-label">{{ 'avisos.disciplina' | translate }}</label>
              <select
                id="aviso-disciplina"
                class="fld-input"
                data-testid="select-disciplina"
                [disabled]="!plantaId()"
                [value]="disciplinaId()"
                (change)="cambiarDisciplina($any($event.target).value)">
                <option value="">{{ 'avisos.todas_las_disciplinas' | translate }}</option>
                @for (d of disciplinasDePlanta(); track d.id) {
                  <option [value]="d.id" [selected]="disciplinaId() === '' + d.id">{{ d.name }}</option>
                }
              </select>
              @if (!plantaId()) {
                <p class="fld-ayuda" data-testid="ayuda-planta">{{ 'avisos.elige_planta_primero' | translate }}</p>
              }
            </div>
          </div>

          <div>
            <label for="aviso-machine" class="fld-label">{{ 'avisos.1_que_maquina_tiene' | translate }}</label>
            @if (recientes().length) {
              <div class="mb-2 flex flex-wrap gap-2" role="group" [attr.aria-label]="'avisos.maquinas_recientes' | translate">
                @for (m of recientes(); track m.id) {
                  <button type="button" class="pill" [attr.aria-pressed]="model().machineId === '' + m.id" (click)="elegirMaquina(m.id)">
                    {{ m.name }}
                  </button>
                }
              </div>
            }
            <!--
              El select de máquina va dentro de un fieldset deshabilitado: Signal Forms no
              permite [disabled] sobre el mismo nodo que [formField], y un fieldset
              deshabilitado desactiva a sus hijos de forma nativa.
            -->
            <fieldset class="m-0 min-w-0 border-0 p-0" [disabled]="!plantaId()" data-testid="campo-maquina">
              <select
                id="aviso-machine"
                [formField]="avisoForm.machineId"
                [attr.aria-invalid]="avisoForm.machineId().touched() && avisoForm.machineId().invalid()"
                [attr.aria-describedby]="avisoForm.machineId().touched() && avisoForm.machineId().invalid() ? 'aviso-machine-error' : null"
                class="fld-input">
                <option value="">{{ 'avisos.selecciona_la_maquina' | translate }}</option>
                @for (m of maquinasFiltradas(); track m.id) {
                  <!-- selected ademas de value: las opciones se crean despues del
                       cambio de planta, y sin esto el select se queda en blanco. -->
                  <option [value]="m.id" [selected]="model().machineId === '' + m.id">{{ m.name }}</option>
                }
              </select>
            </fieldset>
            @if (avisoForm.machineId().touched() && avisoForm.machineId().invalid()) {
              <p id="aviso-machine-error" role="alert" class="fld-error">{{ avisoForm.machineId().errors()[0]?.message | translate }}</p>
            }
          </div>

          <div>
            <label for="aviso-descripcion" class="fld-label">{{ 'avisos.2_que_esta_pasando' | translate }}</label>
            <div class="mb-2 flex flex-wrap gap-2" role="group" [attr.aria-label]="'avisos.sintomas_frecuentes' | translate">
              @for (s of sintomas(); track s) {
                <button type="button" class="pill" (click)="agregarSintoma(s)">{{ s }}</button>
              }
            </div>
            <textarea
              id="aviso-descripcion"
              rows="4"
              [formField]="avisoForm.descripcion"
              [attr.aria-invalid]="avisoForm.descripcion().touched() && avisoForm.descripcion().invalid()"
              [attr.aria-describedby]="avisoForm.descripcion().touched() && avisoForm.descripcion().invalid() ? 'aviso-descripcion-error' : null"
              [attr.placeholder]="'avisos.ej_vibracion_anormal_y' | translate"
              class="fld-input resize-none"></textarea>
            @if (avisoForm.descripcion().touched() && avisoForm.descripcion().invalid()) {
              <p id="aviso-descripcion-error" role="alert" class="fld-error">{{ avisoForm.descripcion().errors()[0]?.message | translate }}</p>
            }
          </div>

          <div>
            <span id="aviso-foto-label" class="fld-label">{{ 'avisos.4_foto_de_la' | translate }}</span>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="btn-secondary" data-testid="btn-camara" (click)="camara.click()">
                <app-icon name="camara" [size]="22" />
                {{ 'avisos.tomar_foto' | translate }}
              </button>
              <button type="button" class="btn-secondary" data-testid="btn-galeria" (click)="galeria.click()">
                <app-icon name="imagen" [size]="22" />
                {{ 'avisos.elegir_de_la_galeria' | translate }}
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
                <img [src]="src" [attr.alt]="'avisos.vista_previa_de_la' | translate" class="max-h-40 max-w-[60%] rounded-control border border-borde object-contain" />
                <div class="grid gap-1">
                  <p class="text-sm text-tinta-suave" aria-live="polite">{{ foto()?.name }}</p>
                  <button type="button" class="btn-ghost justify-start" (click)="quitarFoto()">
                    <app-icon name="x" [size]="18" />
                    {{ 'avisos.quitar' | translate }}
                  </button>
                </div>
              </div>
            } @else {
              <p class="fld-ayuda" aria-live="polite">{{ (procesandoFoto() ? 'avisos.preparando_la_foto' : 'avisos.sin_foto') | translate }}</p>
            }
            <p class="fld-ayuda">{{ 'avisos.jpeg_png_o_webp' | translate }}</p>
          </div>
        </div>
      }

      <div modal-footer>
        @if (creado()) {
          <div class="grid gap-2 sm:grid-cols-2">
            <button type="button" class="btn-secondary" data-testid="btn-otra" (click)="reportarOtra()">{{ 'avisos.reportar_otra' | translate }}</button>
            <button type="button" class="btn-primary" data-testid="btn-ver-avisos" (click)="verAvisos()">
              {{ (puedeGestionar() ? 'avisos.ver_bandeja' : 'avisos.ver_mis_avisos') | translate }}
            </button>
          </div>
        } @else {
          <div class="grid gap-2 sm:flex sm:justify-end">
            <button type="button" class="btn-ghost order-2 sm:order-1" (click)="cerrar()">{{ 'avisos.cancelar' | translate }}</button>
            <button type="button" class="btn-primary order-1 min-h-14 text-lg sm:order-2 sm:min-h-10 sm:text-sm" [disabled]="enviando()" (click)="enviar()">
              {{ (enviando() ? 'avisos.enviando' : 'avisos.enviar_aviso') | translate }}
            </button>
          </div>
        }
      </div>
    </app-modal>
  `,
})
export class ReportarFalla {
  private readonly i18n = inject(I18nService);
  private readonly api = inject(AvisosApi);
  private readonly catalog = inject(CatalogService);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly permissions = inject(PermissionsService);

  readonly closed = output<void>();
  readonly created = output<Aviso>();

  protected readonly sintomas = computed(() => sintomasFrecuentes());
  protected readonly machines = signal<Machine[]>([]);
  protected readonly recientes = signal<Machine[]>([]);
  protected readonly enviando = signal(false);
  protected readonly procesandoFoto = signal(false);
  protected readonly creado = signal<Aviso | null>(null);
  protected readonly foto = signal<File | null>(null);
  protected readonly preview = signal<SafeUrl | null>(null);
  private previewUrl: string | null = null;

  /** Catálogos de los filtros en cascada. */
  protected readonly plantas = signal<Plant[]>([]);
  protected readonly disciplinas = signal<Discipline[]>([]);
  protected readonly plantaId = signal('');
  protected readonly disciplinaId = signal('');

  /**
   * Disciplinas que tienen al menos una máquina en la planta elegida.
   *
   * Se derivan de las máquinas en vez de listar todas: así no se ofrece una disciplina
   * que en esa planta no tiene equipos y el select nunca queda en un callejón sin salida.
   */
  protected readonly disciplinasDePlanta = computed(() => {
    const planta = this.plantaId();
    if (!planta) return [];
    const ids = new Set(
      this.machines()
        .filter((m) => String(m.plant_id) === planta && m.discipline_id !== null)
        .map((m) => m.discipline_id as number)
    );
    return this.disciplinas().filter((d) => ids.has(d.id));
  });

  /** Máquinas de la planta y la disciplina elegidas (la disciplina es opcional). */
  protected readonly maquinasFiltradas = computed(() => {
    const planta = this.plantaId();
    if (!planta) return [];
    const disciplina = this.disciplinaId();
    return this.machines().filter(
      (m) => String(m.plant_id) === planta && (!disciplina || String(m.discipline_id) === disciplina)
    );
  });

  protected readonly model = signal<ReportarFallaModel>({ ...modeloInicial(), ...leer<Partial<ReportarFallaModel>>(CLAVE_BORRADOR, {}) });
  protected readonly avisoForm = form(this.model, (f) => {
    required(f.machineId, { message: 'avisos.selecciona_la_maquina_2' });
    required(f.descripcion, { message: 'avisos.describe_la_falla' });
    validate(f.descripcion, ({ value }) => (value().trim() ? undefined : { kind: 'blank', message: 'avisos.describe_la_falla' }));
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

    // Catálogos de los filtros. Si fallan, la cascada queda vacía pero el resto del
    // formulario sigue funcionando: no se bloquea el reporte por un catálogo caído.
    this.catalog.getPlants().subscribe({
      next: (plantas) => this.plantas.set(plantas ?? []),
      error: () => this.plantas.set([]),
    });
    this.catalog.getDisciplines().subscribe({
      next: (disciplinas) => this.disciplinas.set(disciplinas ?? []),
      error: () => this.disciplinas.set([]),
    });

    this.catalog.getMachines().subscribe({
      next: (machines) => {
        this.machines.set(machines ?? []);
        const ids = leer<number[]>(CLAVE_RECIENTES, []);
        this.recientes.set(ids.map((id) => (machines ?? []).find((m) => m.id === id)).filter((m): m is Machine => !!m));
        // Si el borrador tenía una máquina, se restauran planta y disciplina para que el
        // select pueda mostrarla: sin esto la máquina elegida quedaría fuera del filtro.
        const guardada = this.model().machineId;
        if (guardada) {
          const maquina = (machines ?? []).find((m) => String(m.id) === guardada);
          if (maquina) {
            this.plantaId.set(maquina.plant_id === null ? '' : String(maquina.plant_id));
            this.disciplinaId.set(
              maquina.discipline_id === null ? '' : String(maquina.discipline_id)
            );
          }
        }
      },
      error: () => this.toast.error(this.i18n.tr('avisos.no_se_pudieron_cargar_2')),
    });
  }

  protected cerrar(): void {
    this.closed.emit();
  }

  protected elegirMaquina(id: number): void {
    // Elegir una máquina (incluidas las recientes) sincroniza los filtros para que el
    // select la muestre seleccionada: si se elige desde el pill, la planta y la
    // disciplina se completan solas.
    const maquina = this.machines().find((m) => m.id === id);
    if (maquina) {
      this.plantaId.set(maquina.plant_id === null ? '' : String(maquina.plant_id));
      this.disciplinaId.set(maquina.discipline_id === null ? '' : String(maquina.discipline_id));
    }
    this.model.update((m) => ({ ...m, machineId: String(id) }));
  }

  /** Al cambiar de planta se limpia la disciplina y la máquina elegida: ya no aplican. */
  protected cambiarPlanta(planta: string): void {
    this.plantaId.set(planta);
    this.disciplinaId.set('');
    this.model.update((m) => (m.machineId ? { ...m, machineId: '' } : m));
  }

  /** Al cambiar de disciplina se limpia la máquina: puede no pertenecer a esa disciplina. */
  protected cambiarDisciplina(disciplina: string): void {
    this.disciplinaId.set(disciplina);
    this.model.update((m) => (m.machineId ? { ...m, machineId: '' } : m));
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
      this.toast.error(this.i18n.tr('avisos.solo_se_permiten_imagenes'));
      return;
    }
    // Se reduce primero (una foto de celular suele pesar más de 5 MB) y el límite se aplica a lo que de verdad se envía.
    this.procesandoFoto.set(true);
    const archivo = await reducirImagen(original);
    this.procesandoFoto.set(false);
    if (archivo.size > MAX_FOTO_MB * 1024 * 1024) {
      this.toast.error(this.i18n.tr('avisos.la_imagen_supera_el', { v0: MAX_FOTO_MB }));
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
    const payload = { maquina_id: Number(m.machineId), descripcion: m.descripcion.trim() };
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
        this.toast.error(apiErrorMessage(err, this.i18n.tr('avisos.no_se_pudo_enviar')));
      },
    });
  }

  protected reportarOtra(): void {
    this.creado.set(null);
    this.quitarFoto();
    // También se limpian los filtros: si quedara la planta, el select de máquina seguiría
    // habilitado y con las opciones de la falla anterior.
    this.plantaId.set('');
    this.disciplinaId.set('');
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
