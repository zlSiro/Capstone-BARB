import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';

import {
  OperacionTransaccion,
  RangoTransacciones,
  Transaccion,
  TransaccionesOpciones,
} from '../../core/models';
import { TransaccionesService } from '../../core/services/transacciones.service';
import { apiErrorMessage } from '../../core/utils/http-error';
import {
  OPERACION_LABEL,
  OPERACION_STYLE,
  PAGE_SIZE,
  RANGOS,
  columnasDeTransaccion,
  rolLabel,
  tablaLabel,
} from './etiquetas';

/** Vista del super_usuario con todo lo que hacen los usuarios de las empresas (INSERT/UPDATE/DELETE). */
@Component({
  selector: 'app-transacciones',
  imports: [DatePipe],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="trx-title">
      <div>
        <h1 id="trx-title" class="text-2xl font-bold text-tinta ">Transacciones</h1>
        <p class="text-sm text-tinta-suave ">
          Cambios realizados por los usuarios de las empresas en la plataforma. Solo se muestran los que tienen un usuario identificado.
        </p>
      </div>

      <form class="grid gap-3 rounded-control border border-borde bg-superficie p-4 sm:grid-cols-2 lg:grid-cols-4" (submit)="$event.preventDefault()" aria-label="Filtros de transacciones">
        <div class="flex flex-col gap-1">
          <label for="trx-empresa" class="text-sm font-medium text-tinta">Empresa</label>
          <select id="trx-empresa" class="fld-input" [value]="empresaId() ?? ''" (change)="onEmpresa($any($event.target).value)">
            <option value="">Todas las empresas</option>
            @for (e of opciones().empresas; track e.empresa_id) {
              <option [value]="e.empresa_id">{{ e.nombre }}</option>
            }
          </select>
        </div>

        <div class="flex flex-col gap-1">
          <label for="trx-rol" class="text-sm font-medium text-tinta">Rol</label>
          <select id="trx-rol" class="fld-input" [value]="rol()" (change)="onRol($any($event.target).value)">
            <option value="">Todos los roles</option>
            @for (r of opciones().roles; track r) {
              <option [value]="r">{{ rolLabel(r) }}</option>
            }
          </select>
        </div>

        <div class="flex flex-col gap-1">
          <label for="trx-usuario" class="text-sm font-medium text-tinta">Usuario</label>
          <select id="trx-usuario" class="fld-input" [value]="usuarioId() ?? ''" (change)="onUsuario($any($event.target).value)">
            <option value="">Todos los usuarios</option>
            @for (u of usuariosDisponibles(); track u.usuario_id) {
              <option [value]="u.usuario_id">{{ u.nombre }} ({{ rolLabel(u.rol) }})</option>
            }
          </select>
        </div>

        <div class="flex flex-col gap-1">
          <label for="trx-rango" class="text-sm font-medium text-tinta">Período</label>
          <select id="trx-rango" class="fld-input" [value]="rango()" (change)="onRango($any($event.target).value)">
            @for (r of rangos; track r.value) {
              <option [value]="r.value">{{ r.label }}</option>
            }
          </select>
        </div>

        @if (rango() === 'custom') {
          <div class="flex flex-col gap-1">
            <label for="trx-desde" class="text-sm font-medium text-tinta">Desde</label>
            <input id="trx-desde" type="date" class="fld-input" [value]="desde()" [max]="hasta() || null" (change)="onDesde($any($event.target).value)" />
          </div>
          <div class="flex flex-col gap-1">
            <label for="trx-hasta" class="text-sm font-medium text-tinta">Hasta</label>
            <input id="trx-hasta" type="date" class="fld-input" [value]="hasta()" [min]="desde() || null" (change)="onHasta($any($event.target).value)" />
          </div>
          @if (!customListo()) {
            <p class="self-end text-sm text-tinta-suave sm:col-span-2" role="status">Ingresa ambas fechas para aplicar el filtro.</p>
          }
        }
      </form>

      @if (error()) {
        <div class="rounded-control border border-peligro bg-peligro-suave px-4 py-3 text-sm text-peligro" role="alert">
          {{ error() }}
          <button type="button" class="ml-2 underline" (click)="load()">Reintentar</button>
        </div>
      } @else {
        <div class="flex flex-wrap items-center justify-between gap-2 text-sm text-tinta " aria-live="polite">
          <span>{{ loading() ? 'Cargando transacciones…' : total() + ' transacciones' }}</span>
          @if (total() > 0) {
            <span>Mostrando {{ desdeN() }}–{{ hastaN() }}</span>
          }
        </div>

        <div class="overflow-x-auto rounded-control border border-borde bg-superficie " [class.opacity-60]="loading()">
          <table class="tabla-apilada w-full text-sm text-tinta">
            <caption class="sr-only">Transacciones realizadas por los usuarios</caption>
            <thead class="bg-superficie-2 text-sm text-tinta-suave">
              <tr>
                <th scope="col" class="px-4 py-2 text-left">Fecha</th>
                <th scope="col" class="px-4 py-2 text-left">Empresa</th>
                <th scope="col" class="px-4 py-2 text-left">Usuario</th>
                <th scope="col" class="px-4 py-2 text-left">Rol</th>
                <th scope="col" class="px-4 py-2 text-left">Acción</th>
              </tr>
            </thead>
            <tbody>
              @for (t of items(); track t.transaccion_id) {
                <tr class="border-t border-borde align-top hover:bg-superficie-2">
                  <td class="whitespace-nowrap px-4 py-2" data-label="Fecha">{{ t.fecha | date: 'dd-MM-yyyy HH:mm:ss' }}</td>
                  <td class="px-4 py-2" data-label="Empresa">{{ t.empresa_nombre || '—' }}</td>
                  <td class="px-4 py-2" data-label="Usuario">
                    <div class="font-medium">{{ t.usuario_nombre }}</div>
                    <div class="text-sm text-tinta-suave">{{ t.usuario_email }}</div>
                  </td>
                  <td class="px-4 py-2" data-label="Rol">{{ rolLabel(t.perfil) }}</td>
                  <td class="px-4 py-2" data-label="Acción">
                    @if (t.operacion) {
                      <span class="mr-1 rounded-control px-2 py-1 text-sm font-medium" [class]="operacionStyle(t.operacion)">{{ operacionLabel(t.operacion) }}</span>
                    }
                    {{ tablaLabel(t.tabla) }}
                    @if (t.registro_id) {
                      <span class="text-sm text-tinta-suave">#{{ t.registro_id }}</span>
                    }
                    @if (columnas(t).length) {
                      <details class="mt-1 text-sm text-tinta">
                        <summary class="cursor-pointer focus:outline-none focus:ring-2 focus:ring-accion">Ver detalle</summary>
                        <ul class="mt-1 list-disc pl-5">
                          @for (c of columnas(t); track c.nombre) {
                            <li><span class="font-medium">{{ c.nombre }}</span>: {{ c.valor }}</li>
                          }
                        </ul>
                      </details>
                    }
                  </td>
                </tr>
              } @empty {
                @if (!loading()) {
                  <tr>
                    <td colspan="5" class="py-6 text-center text-tinta-suave">No hay transacciones para los filtros elegidos.</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        @if (total() > pageSize) {
          <nav class="flex items-center justify-end gap-2" aria-label="Paginación">
            <button type="button" class="btn-secondary" [disabled]="offset() === 0 || loading()" (click)="paginar(-1)">Anterior</button>
            <button type="button" class="btn-secondary" [disabled]="hastaN() >= total() || loading()" (click)="paginar(1)">Siguiente</button>
          </nav>
        }
      }
    </section>
  `,
})
export class TransaccionesComponent {
  private readonly service = inject(TransaccionesService);
  private pendiente?: Subscription;

  protected readonly rangos = RANGOS;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly opciones = signal<TransaccionesOpciones>({ empresas: [], roles: [], usuarios: [] });
  protected readonly items = signal<Transaccion[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly empresaId = signal<number | null>(null);
  protected readonly rol = signal('');
  protected readonly usuarioId = signal<number | null>(null);
  protected readonly rango = signal<RangoTransacciones>('7d');
  protected readonly desde = signal('');
  protected readonly hasta = signal('');

  /** Usuarios elegibles según la empresa y el rol ya seleccionados (filtros en cascada). */
  protected readonly usuariosDisponibles = computed(() =>
    this.opciones().usuarios.filter(
      (u) => (this.empresaId() === null || u.empresa_id === this.empresaId()) && (!this.rol() || u.rol === this.rol()),
    ),
  );

  protected readonly customListo = computed(() => !!this.desde() && !!this.hasta() && this.desde() <= this.hasta());
  protected readonly desdeN = computed(() => (this.total() ? this.offset() + 1 : 0));
  protected readonly hastaN = computed(() => Math.min(this.offset() + PAGE_SIZE, this.total()));

  constructor() {
    this.service.getFiltros().subscribe({
      next: (o) => this.opciones.set(o),
      error: (err) => this.error.set(apiErrorMessage(err, 'No se pudieron cargar los filtros.')),
    });
    this.load();
  }

  protected readonly rolLabel = rolLabel;
  protected readonly tablaLabel = tablaLabel;
  protected readonly columnas = columnasDeTransaccion;
  protected operacionLabel = (o: OperacionTransaccion) => OPERACION_LABEL[o];
  protected operacionStyle = (o: OperacionTransaccion) => OPERACION_STYLE[o];

  protected onEmpresa(value: string): void {
    this.empresaId.set(value ? Number(value) : null);
    this.descartarUsuarioNoDisponible();
    this.recargar();
  }

  protected onRol(value: string): void {
    this.rol.set(value);
    this.descartarUsuarioNoDisponible();
    this.recargar();
  }

  protected onUsuario(value: string): void {
    this.usuarioId.set(value ? Number(value) : null);
    this.recargar();
  }

  protected onRango(value: string): void {
    this.rango.set(value as RangoTransacciones);
    this.recargar();
  }

  protected onDesde(value: string): void {
    this.desde.set(value);
    this.recargar();
  }

  protected onHasta(value: string): void {
    this.hasta.set(value);
    this.recargar();
  }

  protected paginar(direccion: 1 | -1): void {
    this.offset.update((o) => Math.max(0, o + direccion * PAGE_SIZE));
    this.load();
  }

  private descartarUsuarioNoDisponible(): void {
    const actual = this.usuarioId();
    if (actual !== null && !this.usuariosDisponibles().some((u) => u.usuario_id === actual)) {
      this.usuarioId.set(null);
    }
  }

  private recargar(): void {
    this.offset.set(0);
    this.load();
  }

  load(): void {
    this.pendiente?.unsubscribe();

    // En "Personalizar" no se consulta hasta tener un rango de fechas válido.
    if (this.rango() === 'custom' && !this.customListo()) {
      this.loading.set(false);
      this.items.set([]);
      this.total.set(0);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.pendiente = this.service
      .getAll({
        empresa_id: this.empresaId(),
        rol: this.rol(),
        usuario_id: this.usuarioId(),
        rango: this.rango(),
        desde: this.desde(),
        hasta: this.hasta(),
        limit: PAGE_SIZE,
        offset: this.offset(),
      })
      .subscribe({
        next: (page) => {
          this.items.set(page.items);
          this.total.set(page.total);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(apiErrorMessage(err, 'No se pudieron cargar las transacciones.'));
          this.loading.set(false);
        },
      });
  }
}
