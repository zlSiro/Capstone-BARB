import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';

import {
  OperacionTransaccion,
  RangoTransacciones,
  Transaccion,
  TransaccionesEmpresaOpciones,
} from '../../core/models';
import { TransaccionesEmpresaApi } from '../../core/services/transacciones-empresa-api';
import { apiErrorMessage } from '../../core/utils/http-error';
import {
  OPERACION_LABEL,
  OPERACION_STYLE,
  PAGE_SIZE,
  RANGOS,
  columnasDeTransaccion,
  rolLabel,
  tablaLabel,
} from '../transacciones/etiquetas';

/** Vista del gerente: lo que hicieron los usuarios de su empresa (INSERT/UPDATE/DELETE). */
@Component({
  selector: 'app-transacciones-empresa',
  imports: [DatePipe],
  templateUrl: './transacciones-empresa.html',
  styleUrl: './transacciones-empresa.css',
})
export class TransaccionesEmpresa {
  private readonly api = inject(TransaccionesEmpresaApi);
  private pendiente?: Subscription;

  protected readonly rangos = RANGOS;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly rolLabel = rolLabel;
  protected readonly tablaLabel = tablaLabel;
  protected readonly columnas = columnasDeTransaccion;
  protected readonly operacionLabel = (o: OperacionTransaccion) => OPERACION_LABEL[o];
  protected readonly operacionStyle = (o: OperacionTransaccion) => OPERACION_STYLE[o];

  protected readonly opciones = signal<TransaccionesEmpresaOpciones>({ roles: [], usuarios: [] });
  protected readonly items = signal<Transaccion[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly rol = signal('');
  protected readonly usuarioId = signal<number | null>(null);
  protected readonly rango = signal<RangoTransacciones>('7d');
  protected readonly desde = signal('');
  protected readonly hasta = signal('');

  /** Usuarios elegibles según el rol ya seleccionado (filtros en cascada). */
  protected readonly usuariosDisponibles = computed(() =>
    this.opciones().usuarios.filter((u) => !this.rol() || u.rol === this.rol()),
  );

  protected readonly customListo = computed(() => !!this.desde() && !!this.hasta() && this.desde() <= this.hasta());
  protected readonly desdeN = computed(() => (this.total() ? this.offset() + 1 : 0));
  protected readonly hastaN = computed(() => Math.min(this.offset() + PAGE_SIZE, this.total()));

  constructor() {
    this.api.getFiltros().subscribe({
      next: (o) => this.opciones.set(o),
      error: (err) => this.error.set(apiErrorMessage(err, 'No se pudieron cargar los filtros.')),
    });
    this.load();
  }

  protected onRol(value: string): void {
    this.rol.set(value);
    const actual = this.usuarioId();
    if (actual !== null && !this.usuariosDisponibles().some((u) => u.usuario_id === actual)) {
      this.usuarioId.set(null);
    }
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
    this.pendiente = this.api
      .getAll({
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
