import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormField, form, validate } from '@angular/forms/signals';

import { Documento, Empresa } from '../../core/models';
import { DocumentsService } from '../../core/services/documents.service';
import { EmpresasService } from '../../core/services/empresas.service';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AuthService } from '../../core/services/auth.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/http-error';

const MAX_BYTES = 15 * 1024 * 1024; // mismo límite que el backend
const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.log';
const ALLOWED_EXT = ACCEPT.split(',');

interface UploadModel {
  title: string;
  notes: string;
  empresa_id: string; // solo super_usuario
}

/**
 * Documentación de la empresa. Es la ÚNICA fuente de conocimiento del chat IA:
 * la IA responde solo con los documentos activos de la empresa del usuario.
 */
@Component({
  selector: 'app-documentos',
  imports: [DatePipe, FormField],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="docs-title">
      <div>
        <h1 id="docs-title" class="text-2xl font-bold text-gray-800 dark:text-gray-100">
          Documentación ({{ documentos().length }})
        </h1>
        <p class="text-sm text-gray-600 dark:text-gray-300">
          @if (tenant.isSuper() && !tenant.empresaId()) {
            Documentos de todas las empresas.
          } @else {
            Documentos de {{ empresaNombre() }}.
          }
        </p>
      </div>

      <div class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900" role="note">
        <strong>Cómo se usa:</strong> el asistente de IA responde <em>únicamente</em> con la información de los documentos
        <strong>activos</strong> de la empresa. Si un tema no está documentado, la IA lo indicará en lugar de inventar.
        Formatos: PDF, DOCX, TXT, MD, CSV, JSON, LOG (máx. 15 MB; los PDF escaneados sin texto no se pueden indexar).
      </div>

      @if (permissions.canPerform('subir_documentos')) {
        <form class="grid gap-3 rounded-lg border border-slate-700 bg-slate-900 p-4 md:grid-cols-2"
              (submit)="$event.preventDefault(); upload()" novalidate aria-label="Subir documento">
          @if (tenant.isSuper()) {
            <div class="md:col-span-2">
              <label for="doc-empresa" class="fld-label">Empresa *</label>
              <select id="doc-empresa" class="fld-input" [formField]="f.empresa_id">
                <option value="">Selecciona una empresa</option>
                @for (e of empresas(); track e.empresa_id) {
                  <option [value]="e.empresa_id">{{ e.nombre }}</option>
                }
              </select>
              @if (f.empresa_id().touched() && f.empresa_id().invalid()) {
                <p role="alert" class="fld-error">{{ f.empresa_id().errors()[0]?.message }}</p>
              }
            </div>
          }
          <div>
            <label for="doc-file" class="fld-label">Archivo *</label>
            <input id="doc-file" type="file" [accept]="accept" (change)="onFile($event)"
                   class="fld-input file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-1 file:text-white" />
            @if (fileError()) {
              <p role="alert" class="fld-error">{{ fileError() }}</p>
            }
          </div>
          <div>
            <label for="doc-title" class="fld-label">Título</label>
            <input id="doc-title" type="text" class="fld-input" [formField]="f.title" placeholder="Por defecto: nombre del archivo" />
          </div>
          <div class="md:col-span-2">
            <label for="doc-notes" class="fld-label">Notas</label>
            <input id="doc-notes" type="text" class="fld-input" [formField]="f.notes" placeholder="Ej. Manual del fabricante, rev. 3" />
          </div>
          <div class="md:col-span-2 flex justify-end">
            <button type="submit" class="btn-primary" [disabled]="uploading()">
              {{ uploading() ? 'Subiendo e indexando…' : 'Subir documento' }}
            </button>
          </div>
        </form>
      }

      @if (loading()) {
        <div class="py-10 text-center text-gray-600" role="status">Cargando documentos…</div>
      } @else if (error()) {
        <div class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {{ error() }} <button type="button" class="ml-2 underline" (click)="load()">Reintentar</button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-lg border border-gray-100 bg-white shadow-sm">
          <table class="w-full text-sm text-gray-800">
            <caption class="sr-only">Documentos disponibles para la IA</caption>
            <thead class="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">Documento</th>
                @if (tenant.isSuper()) {
                  <th scope="col" class="px-4 py-2 text-left">Empresa</th>
                }
                <th scope="col" class="px-4 py-2 text-left">Subido por</th>
                <th scope="col" class="px-4 py-2 text-right">Tamaño</th>
                <th scope="col" class="px-4 py-2 text-right">Fragmentos</th>
                <th scope="col" class="px-4 py-2 text-left">Fecha</th>
                <th scope="col" class="px-4 py-2 text-left">Uso por la IA</th>
                <th scope="col" class="px-4 py-2 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (d of documentos(); track d.id) {
                <tr class="border-t border-gray-100 hover:bg-gray-50" [class.opacity-70]="!d.activo">
                  <td class="px-4 py-2">
                    <div class="font-medium">{{ d.title }}</div>
                    <div class="text-xs text-gray-600">{{ d.original_name }}@if (d.notes) { · {{ d.notes }} }</div>
                  </td>
                  @if (tenant.isSuper()) {
                    <td class="px-4 py-2">{{ d.empresa_nombre }}</td>
                  }
                  <td class="px-4 py-2">{{ d.subido_por ?? '—' }}</td>
                  <td class="px-4 py-2 text-right">{{ size(d.size_bytes) }}</td>
                  <td class="px-4 py-2 text-right">{{ d.chunks_indexed }}</td>
                  <td class="px-4 py-2">{{ d.created_at ? (d.created_at | date: 'dd-MM-yyyy') : '—' }}</td>
                  <td class="px-4 py-2">
                    <span class="rounded px-2 py-1 text-xs font-medium"
                          [class]="d.activo ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'">
                      {{ d.activo ? 'Activo' : 'Excluido' }}
                    </span>
                  </td>
                  <td class="px-4 py-2">
                    <div class="flex flex-wrap gap-1">
                      @if (permissions.canPerform('subir_documentos')) {
                        <button type="button" class="btn-secondary" (click)="toggle(d)"
                                [attr.aria-label]="(d.activo ? 'Excluir de la IA ' : 'Incluir en la IA ') + d.title">
                          {{ d.activo ? 'Excluir de la IA' : 'Incluir en la IA' }}
                        </button>
                      }
                      @if (permissions.canPerform('eliminar_documentos')) {
                        <button type="button" class="btn-danger" (click)="remove(d)" [attr.aria-label]="'Eliminar ' + d.title">Eliminar</button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="tenant.isSuper() ? 8 : 7" class="py-6 text-center text-gray-600">
                    Aún no hay documentos. La IA no podrá responder hasta que se suba documentación.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class DocumentosComponent {
  protected readonly permissions = inject(PermissionsService);
  protected readonly tenant = inject(TenantContextService);
  private readonly auth = inject(AuthService);
  private readonly service = inject(DocumentsService);
  private readonly empresasService = inject(EmpresasService);
  private readonly toast = inject(ToastService);

  protected readonly accept = ACCEPT;
  protected readonly documentos = signal<Documento[]>([]);
  protected readonly empresas = signal<Empresa[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly uploading = signal(false);
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);

  protected readonly empresaNombre = computed(() => {
    if (!this.tenant.isSuper()) return this.auth.user()?.empresa_nombre ?? 'tu empresa';
    return this.empresas().find(e => e.empresa_id === this.tenant.empresaId())?.nombre ?? 'la empresa seleccionada';
  });

  protected readonly model = signal<UploadModel>({
    title: '',
    notes: '',
    empresa_id: this.tenant.empresaId() ? String(this.tenant.empresaId()) : '',
  });
  protected readonly f = form(this.model, (p) => {
    validate(p.empresa_id, ({ value }) =>
      this.tenant.isSuper() && !value() ? { kind: 'required', message: 'Selecciona la empresa dueña del documento.' } : undefined);
  });

  constructor() {
    this.load();
    if (this.tenant.isSuper()) {
      this.empresasService.getAll().subscribe({ next: (e) => this.empresas.set(e) });
    }
  }

  protected size(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.getAll().subscribe({
      next: (docs) => {
        this.documentos.set(docs);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'No se pudieron cargar los documentos.'));
        this.loading.set(false);
      },
    });
  }

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] ?? null;
    this.fileError.set(null);
    this.file.set(null);
    if (!picked) return;

    const ext = picked.name.slice(picked.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      this.fileError.set(`Formato no soportado. Usa: ${ALLOWED_EXT.join(', ')}.`);
      input.value = '';
    } else if (picked.size > MAX_BYTES) {
      this.fileError.set('El archivo supera el máximo de 15 MB.');
      input.value = '';
    } else {
      this.file.set(picked);
    }
  }

  protected upload(): void {
    if (this.uploading()) return;
    this.f().markAsTouched();
    const file = this.file();
    if (!file) {
      this.fileError.set('Selecciona un archivo.');
      return;
    }
    if (!this.f().valid()) return;

    const m = this.model();
    const body = new FormData();
    body.append('file', file);
    if (m.title.trim()) body.append('title', m.title.trim());
    if (m.notes.trim()) body.append('notes', m.notes.trim());
    if (this.tenant.isSuper()) body.append('empresa_id', m.empresa_id);

    this.uploading.set(true);
    this.service.upload(body).subscribe({
      next: (doc) => {
        this.uploading.set(false);
        this.toast.success(`"${doc.title}" indexado (${doc.chunks_indexed} fragmentos).`);
        this.model.update(cur => ({ ...cur, title: '', notes: '' }));
        this.file.set(null);
        // El <input type=file> no es controlable por el modelo: se limpia directamente.
        const input = document.getElementById('doc-file') as HTMLInputElement | null;
        if (input) input.value = '';
        this.load();
      },
      error: (err) => {
        this.uploading.set(false);
        this.toast.error(apiErrorMessage(err, 'No se pudo subir el documento.'));
      },
    });
  }

  protected toggle(d: Documento): void {
    this.service.update(d.id, { activo: !d.activo }).subscribe({
      next: (updated) => {
        this.documentos.update(list => list.map(x => (x.id === updated.id ? updated : x)));
        this.toast.success(updated.activo ? 'La IA volverá a usar este documento.' : 'La IA dejará de usar este documento.');
      },
      error: (err) => this.toast.error(apiErrorMessage(err, 'No se pudo actualizar el documento.')),
    });
  }

  protected remove(d: Documento): void {
    if (!confirm(`¿Eliminar "${d.title}"? La IA dejará de poder responder con su contenido.`)) return;
    this.service.delete(d.id).subscribe({
      next: () => {
        this.documentos.update(list => list.filter(x => x.id !== d.id));
        this.toast.success('Documento eliminado.');
      },
      error: (err) => this.toast.error(apiErrorMessage(err, 'No se pudo eliminar el documento.')),
    });
  }
}
