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

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
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
  imports: [DatePipe, FormField, TranslatePipe],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="docs-title">
      <div>
        <h1 id="docs-title" class="text-2xl font-bold text-tinta ">
          {{ 'documentos.documentacion' | translate: { v0: documentos().length } }}
        </h1>
        <p class="text-sm text-tinta-suave ">
          @if (tenant.isSuper() && !tenant.empresaId()) {
            {{ 'documentos.documentos_de_todas_las' | translate }}
          } @else {
            {{ 'documentos.documentos_de' | translate: { v0: empresaNombre() } }}
          }
        </p>
      </div>

      <div class="rounded-control border border-accion bg-accion-suave px-4 py-3 text-sm text-accion" role="note">
        <strong>{{ 'documentos.como_se_usa' | translate }}</strong> {{ 'documentos.el_asistente_de_ia' | translate }} <em>{{ 'documentos.unicamente' | translate }}</em> {{ 'documentos.con_la_informacion_de' | translate }}
        <strong>{{ 'documentos.activos' | translate }}</strong> {{ 'documentos.de_la_empresa_si' | translate }}
      </div>

      @if (permissions.canPerform('subir_documentos')) {
        <form class="grid gap-3 rounded-control border border-borde bg-superficie p-4 md:grid-cols-2"
              (submit)="$event.preventDefault(); upload()" novalidate [attr.aria-label]="'documentos.subir_documento' | translate">
          @if (tenant.isSuper()) {
            <div class="md:col-span-2">
              <label for="doc-empresa" class="fld-label">{{ 'documentos.empresa_2' | translate }}</label>
              <select id="doc-empresa" class="fld-input" [formField]="f.empresa_id">
                <option value="">{{ 'documentos.selecciona_una_empresa' | translate }}</option>
                @for (e of empresas(); track e.empresa_id) {
                  <option [value]="e.empresa_id">{{ e.nombre }}</option>
                }
              </select>
              @if (f.empresa_id().touched() && f.empresa_id().invalid()) {
                <p role="alert" class="fld-error">{{ f.empresa_id().errors()[0]?.message | translate }}</p>
              }
            </div>
          }
          <div>
            <span id="doc-file-titulo" class="fld-label">{{ 'documentos.archivo' | translate }}</span>
            <!--
              El texto del <input type="file"> nativo («Seleccionar archivo», «Ningún archivo seleccionado») lo pone el
              navegador en SU idioma y no sigue el de la página. Por eso el input queda oculto (pero enfocable y accesible)
              y el botón y el nombre del archivo son propios, traducidos.
            -->
            <div class="flex flex-wrap items-center gap-3">
              <input id="doc-file" type="file" class="peer sr-only" [accept]="accept" (change)="onFile($event)"
                     aria-labelledby="doc-file-titulo doc-file-boton" [attr.aria-describedby]="fileError() ? 'doc-file-error' : null" />
              <label id="doc-file-boton" for="doc-file" data-testid="doc-elegir" data-tour="doc-subir"
                     class="btn-secondary cursor-pointer peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accion">
                {{ 'documentos.seleccionar_archivo' | translate }}
              </label>
              <span class="min-w-0 break-all text-sm text-tinta-suave" data-testid="doc-nombre-archivo" aria-live="polite">
                {{ file()?.name ?? ('documentos.ningun_archivo_seleccionado' | translate) }}
              </span>
            </div>
            @if (fileError()) {
              <p id="doc-file-error" role="alert" class="fld-error">{{ fileError() }}</p>
            }
          </div>
          <div>
            <label for="doc-title" class="fld-label">{{ 'documentos.titulo' | translate }}</label>
            <input id="doc-title" type="text" class="fld-input" [formField]="f.title" [attr.placeholder]="'documentos.por_defecto_nombre_del' | translate" />
          </div>
          <div class="md:col-span-2">
            <label for="doc-notes" class="fld-label">{{ 'documentos.notas' | translate }}</label>
            <input id="doc-notes" type="text" class="fld-input" [formField]="f.notes" [attr.placeholder]="'documentos.ej_manual_del_fabricante' | translate" />
          </div>
          <div class="md:col-span-2 flex justify-end">
            <button type="submit" class="btn-primary" [disabled]="uploading()">
              {{ (uploading() ? 'documentos.subiendo_e_indexando' : 'documentos.subir_documento') | translate }}
            </button>
          </div>
        </form>
      }

      @if (loading()) {
        <div class="py-10 text-center text-tinta-suave" role="status">{{ 'documentos.cargando_documentos' | translate }}</div>
      } @else if (error()) {
        <div class="rounded-control border border-peligro bg-peligro-suave px-4 py-3 text-sm text-peligro" role="alert">
          {{ error() }} <button type="button" class="ml-2 underline" (click)="load()">{{ 'documentos.reintentar' | translate }}</button>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-control border border-borde bg-superficie ">
          <table class="tabla-apilada w-full text-sm text-tinta">
            <caption class="sr-only">{{ 'documentos.documentos_disponibles_para_la' | translate }}</caption>
            <thead class="bg-superficie-2 text-sm text-tinta-suave">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">{{ 'documentos.documento' | translate }}</th>
                @if (tenant.isSuper()) {
                  <th scope="col" class="px-4 py-2 text-left">{{ 'documentos.empresa' | translate }}</th>
                }
                <th scope="col" class="px-4 py-2 text-left">{{ 'documentos.subido_por' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-right">{{ 'documentos.tamano' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-right">{{ 'documentos.fragmentos' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'documentos.fecha' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'documentos.uso_por_la_ia' | translate }}</th>
                <th scope="col" class="px-4 py-2 text-left">{{ 'documentos.acciones' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (d of documentos(); track d.id) {
                <tr class="border-t border-borde hover:bg-superficie-2" [class.opacity-70]="!d.activo">
                  <td class="px-4 py-2" [attr.data-label]="'documentos.documento' | translate">
                    <div class="font-medium">{{ d.title }}</div>
                    <div class="text-sm text-tinta-suave">{{ d.original_name }}@if (d.notes) { · {{ d.notes }} }</div>
                  </td>
                  @if (tenant.isSuper()) {
                    <td class="px-4 py-2" [attr.data-label]="'documentos.empresa' | translate">{{ d.empresa_nombre }}</td>
                  }
                  <td class="px-4 py-2" [attr.data-label]="'documentos.subido_por' | translate">{{ d.subido_por ?? '—' }}</td>
                  <td class="px-4 py-2 text-right" [attr.data-label]="'documentos.tamano' | translate">{{ size(d.size_bytes) }}</td>
                  <td class="px-4 py-2 text-right" [attr.data-label]="'documentos.fragmentos' | translate">{{ d.chunks_indexed }}</td>
                  <td class="px-4 py-2" [attr.data-label]="'documentos.fecha' | translate">{{ d.created_at ? (d.created_at | date: 'dd-MM-yyyy') : '—' }}</td>
                  <td class="px-4 py-2" [attr.data-label]="'documentos.uso_por_la_ia' | translate">
                    <span class="rounded-control px-2 py-1 text-sm font-medium"
                          [class]="d.activo ? 'bg-ok-suave text-ok' : 'bg-borde text-tinta'">
                      {{ (d.activo ? 'documentos.activo' : 'documentos.excluido') | translate }}
                    </span>
                  </td>
                  <td class="px-4 py-2" [attr.data-label]="'documentos.acciones' | translate">
                    <div class="flex flex-wrap gap-1">
                      @if (permissions.canPerform('subir_documentos')) {
                        <button type="button" class="btn-secondary" (click)="toggle(d)"
                                [attr.aria-label]="(d.activo ? 'documentos.excluir_de_la_ia' : 'documentos.incluir_en_la_ia') | translate: { v0: d.title }">
                          {{ (d.activo ? 'documentos.excluir_de_la_ia_2' : 'documentos.incluir_en_la_ia_2') | translate }}
                        </button>
                      }
                      @if (permissions.canPerform('eliminar_documentos')) {
                        <button type="button" class="btn-danger" (click)="remove(d)" [attr.aria-label]="'documentos.eliminar_2' | translate: { v0: d.title }">{{ 'documentos.eliminar' | translate }}</button>
                      }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="tenant.isSuper() ? 8 : 7" class="py-6 text-center text-tinta-suave">
                    {{ 'documentos.aun_no_hay_documentos' | translate }}
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
  private readonly i18n = inject(I18nService);
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
      this.tenant.isSuper() && !value() ? { kind: 'required', message: 'documentos.selecciona_la_empresa_duena' } : undefined);
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
        this.error.set(apiErrorMessage(err, this.i18n.tr('documentos.no_se_pudieron_cargar')));
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
      this.fileError.set(this.i18n.tr('documentos.formato_no_soportado_usa', { v0: ALLOWED_EXT.join(', ') }));
      input.value = '';
    } else if (picked.size > MAX_BYTES) {
      this.fileError.set(this.i18n.tr('documentos.el_archivo_supera_el'));
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
      this.fileError.set(this.i18n.tr('documentos.selecciona_un_archivo'));
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
        this.toast.error(apiErrorMessage(err, this.i18n.tr('documentos.no_se_pudo_subir')));
      },
    });
  }

  protected toggle(d: Documento): void {
    this.service.update(d.id, { activo: !d.activo }).subscribe({
      next: (updated) => {
        this.documentos.update(list => list.map(x => (x.id === updated.id ? updated : x)));
        this.toast.success(this.i18n.tr(updated.activo ? 'documentos.la_ia_volvera_a' : 'documentos.la_ia_dejara_de'));
      },
      error: (err) => this.toast.error(apiErrorMessage(err, this.i18n.tr('documentos.no_se_pudo_actualizar'))),
    });
  }

  protected remove(d: Documento): void {
    if (!confirm(this.i18n.tr('documentos.eliminar_la_ia_dejara', { v0: d.title }))) return;
    this.service.delete(d.id).subscribe({
      next: () => {
        this.documentos.update(list => list.filter(x => x.id !== d.id));
        this.toast.success(this.i18n.tr('documentos.documento_eliminado'));
      },
      error: (err) => this.toast.error(apiErrorMessage(err, this.i18n.tr('documentos.no_se_pudo_eliminar'))),
    });
  }
}
