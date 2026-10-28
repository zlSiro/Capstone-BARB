import { Component, DestroyRef, inject, output, signal } from '@angular/core';
import { form, required, validate, FormField } from '@angular/forms/signals';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

import { Aviso, Machine, WorkOrderSeverity } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { CatalogService } from '../../core/services/catalog.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import { GRAVEDADES } from './etiquetas';

interface ReportarFallaModel {
  machineId: string;
  severidad: WorkOrderSeverity;
  descripcion: string;
}

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FOTO_MB = 5;

const modeloInicial = (): ReportarFallaModel => ({ machineId: '', severidad: 'medium', descripcion: '' });

/** Diálogo para reportar una falla. El aviso llega al repositorio del supervisor, que decide si genera una OT. */
@Component({
  selector: 'app-reportar-falla',
  imports: [FormField],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" (click)="cerrar()">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reportar-falla-title"
        class="max-h-full w-full max-w-xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="reportar-falla-title" class="text-xl font-bold text-slate-100">Reportar una falla</h2>
            <p class="text-sm text-slate-400">Tu aviso llega al supervisor, que decide si se genera una orden de trabajo.</p>
          </div>
          <button type="button" (click)="cerrar()" class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Cerrar">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div class="grid gap-4 px-6 py-5">
          <div>
            <label for="aviso-machine" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Máquina *</label>
            <select
              id="aviso-machine"
              [formField]="avisoForm.machineId"
              [attr.aria-invalid]="avisoForm.machineId().touched() && avisoForm.machineId().invalid()"
              [attr.aria-describedby]="avisoForm.machineId().touched() && avisoForm.machineId().invalid() ? 'aviso-machine-error' : null"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecciona la máquina con la falla</option>
              @for (m of machines(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
            @if (avisoForm.machineId().touched() && avisoForm.machineId().invalid()) {
              <p id="aviso-machine-error" role="alert" class="mt-1 text-xs text-red-400">{{ avisoForm.machineId().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <label for="aviso-severidad" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Gravedad que percibes</label>
            <select
              id="aviso-severidad"
              [formField]="avisoForm.severidad"
              class="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
              @for (g of gravedades; track g.value) {
                <option [value]="g.value">{{ g.label }}</option>
              }
            </select>
            <p class="mt-1 text-xs text-slate-400">El supervisor define la prioridad real al atender el aviso.</p>
          </div>

          <div>
            <label for="aviso-descripcion" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">¿Qué está pasando? *</label>
            <textarea
              id="aviso-descripcion"
              rows="4"
              [formField]="avisoForm.descripcion"
              [attr.aria-invalid]="avisoForm.descripcion().touched() && avisoForm.descripcion().invalid()"
              [attr.aria-describedby]="avisoForm.descripcion().touched() && avisoForm.descripcion().invalid() ? 'aviso-descripcion-error' : null"
              placeholder="Ej. Vibración anormal y ruido metálico en el motor al arrancar."
              class="w-full resize-none rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            @if (avisoForm.descripcion().touched() && avisoForm.descripcion().invalid()) {
              <p id="aviso-descripcion-error" role="alert" class="mt-1 text-xs text-red-400">{{ avisoForm.descripcion().errors()[0]?.message }}</p>
            }
          </div>

          <div>
            <span id="aviso-foto-label" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Foto de la falla (opcional)</span>
            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button"
                (click)="fileInput.click()"
                aria-describedby="aviso-foto-label"
                class="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <span aria-hidden="true">📎</span> {{ foto() ? 'Cambiar foto' : 'Adjuntar foto' }}
              </button>
              <span class="text-sm text-slate-400" aria-live="polite">{{ foto()?.name ?? 'Sin foto' }}</span>
              @if (foto()) {
                <button type="button" (click)="quitarFoto(fileInput)" class="text-sm text-slate-300 underline hover:text-white">Quitar</button>
              }
              <input
                #fileInput
                id="aviso-foto"
                type="file"
                class="hidden"
                accept="image/jpeg,image/png,image/webp"
                aria-labelledby="aviso-foto-label"
                (change)="onFoto($event)" />
            </div>
            @if (preview(); as src) {
              <img [src]="src" alt="Vista previa de la foto adjunta" class="mt-3 max-h-40 max-w-full rounded border border-slate-700 object-contain" />
            }
            <p class="mt-1 text-xs text-slate-400">JPEG, PNG o WEBP, hasta 5 MB. Ayuda al supervisor a entender la falla.</p>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <button type="button" (click)="cerrar()" class="text-sm font-medium text-slate-300 hover:text-white">Cancelar</button>
          <button
            type="button"
            [disabled]="enviando()"
            (click)="enviar()"
            class="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-800">
            {{ enviando() ? 'Enviando…' : 'Enviar aviso' }}
          </button>
        </div>
      </div>
    </div>
  `,
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class ReportarFalla {
  private readonly api = inject(AvisosApi);
  private readonly catalog = inject(CatalogService);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly closed = output<void>();
  readonly created = output<Aviso>();

  protected readonly gravedades = GRAVEDADES;
  protected readonly machines = signal<Machine[]>([]);
  protected readonly enviando = signal(false);
  protected readonly foto = signal<File | null>(null);
  protected readonly preview = signal<SafeUrl | null>(null);
  private previewUrl: string | null = null;

  protected readonly model = signal<ReportarFallaModel>(modeloInicial());
  protected readonly avisoForm = form(this.model, (f) => {
    required(f.machineId, { message: 'Selecciona la máquina.' });
    required(f.descripcion, { message: 'Describe la falla.' });
    validate(f.descripcion, ({ value }) => (value().trim() ? undefined : { kind: 'blank', message: 'Describe la falla.' }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.liberarVistaPrevia());
    this.catalog.getMachines().subscribe({
      next: (machines) => this.machines.set(machines ?? []),
      error: () => this.toast.error('No se pudieron cargar las máquinas.'),
    });
  }

  protected cerrar(): void {
    this.closed.emit();
  }

  protected onFoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0] ?? null;
    if (!archivo) {
      this.quitarFoto(input);
      return;
    }
    if (!TIPOS_FOTO.includes(archivo.type)) {
      this.toast.error('Solo se permiten imágenes JPEG, PNG o WEBP.');
      this.quitarFoto(input);
      return;
    }
    if (archivo.size > MAX_FOTO_MB * 1024 * 1024) {
      this.toast.error(`La imagen supera el máximo de ${MAX_FOTO_MB} MB.`);
      this.quitarFoto(input);
      return;
    }
    this.liberarVistaPrevia();
    this.previewUrl = URL.createObjectURL(archivo);
    // URL de un blob que acabamos de crear nosotros: es seguro.
    this.preview.set(this.sanitizer.bypassSecurityTrustUrl(this.previewUrl));
    this.foto.set(archivo);
  }

  protected quitarFoto(input?: HTMLInputElement): void {
    if (input) input.value = ''; // permite volver a elegir el mismo archivo
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
        this.toast.success(`Aviso ${aviso.numero_aviso} enviado al supervisor.`);
        this.created.emit(aviso);
      },
      error: (err) => {
        this.enviando.set(false);
        this.toast.error(apiErrorMessage(err, 'No se pudo enviar el aviso.'));
      },
    });
  }
}
