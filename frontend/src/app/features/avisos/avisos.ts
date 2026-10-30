import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Aviso, AvisoGenerarOtResponse, EstadoAviso } from '../../core/models';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AvisosApi } from '../../core/services/avisos-api';
import { AvisosPendientes } from '../../core/services/avisos-pendientes';
import { ReportarFallaUi } from '../../core/services/reportar-falla-ui';
import { apiErrorMessage } from '../../core/utils/http-error';
import { Icon } from '../../shared/components/ui/icon/icon';
import { rolLabel } from '../transacciones/etiquetas';
import { DescartarAviso } from './descartar-aviso';
import { ESTADO_META, estadoMeta, gravedadMeta } from './etiquetas';
import { EstadoAvisoChip } from './estado-aviso';
import { FotoAviso } from './foto-aviso';
import { GenerarOtAviso } from './generar-ot-aviso';
import { GravedadMedidor } from './gravedad-medidor';
import { VerFotoAviso } from './ver-foto-aviso';

type Filtro = EstadoAviso | 'todos';

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'pendiente', label: ESTADO_META.pendiente.label },
  { value: 'con_ot', label: ESTADO_META.con_ot.label },
  { value: 'descartado', label: ESTADO_META.descartado.label },
  { value: 'todos', label: 'Todos' },
];

/**
 * Avisos de falla. Quien trabaja en planta reporta una falla y sigue en qué quedó («Mis avisos»); supervisor y gerente ven
 * el repositorio completo de la empresa, con lo pendiente primero, y deciden: generar una OT o descartar con un motivo.
 * En pantalla ancha la bandeja es lista + detalle (foto grande y decisión a la vista); en móvil, tarjetas con los botones dentro.
 */
@Component({
  selector: 'app-avisos',
  imports: [DatePipe, RouterLink, Icon, GenerarOtAviso, DescartarAviso, VerFotoAviso, FotoAviso, EstadoAvisoChip, GravedadMedidor],
  templateUrl: './avisos.html',
})
export class Avisos {
  private readonly api = inject(AvisosApi);
  private readonly permisos = inject(PermissionsService);
  private readonly pendientesSvc = inject(AvisosPendientes);
  protected readonly reportarUi = inject(ReportarFallaUi);

  protected readonly puedeGestionar = computed(() => this.permisos.canPerform('gestionar_avisos'));
  protected readonly puedeReportar = computed(() => this.permisos.canPerform('reportar_falla'));

  protected readonly filtros = FILTROS;
  protected readonly avisos = signal<Aviso[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Quien decide parte de lo pendiente; quien solo reporta, de todo lo suyo. */
  protected readonly filtro = signal<Filtro>(this.permisos.canPerform('gestionar_avisos') ? 'pendiente' : 'todos');

  protected readonly generando = signal<Aviso | null>(null);
  protected readonly descartando = signal<Aviso | null>(null);
  protected readonly viendoFoto = signal<Aviso | null>(null);
  /** Aviso abierto en el panel de detalle (pantalla ancha). Por defecto, el primero de la lista. */
  private readonly elegido = signal<number | null>(null);

  protected readonly conteos = computed(() => {
    const c: Record<Filtro, number> = { pendiente: 0, con_ot: 0, descartado: 0, todos: this.avisos().length };
    for (const a of this.avisos()) c[a.estado] += 1;
    return c;
  });

  /** Lo pendiente primero; dentro de cada grupo, lo más reciente arriba. */
  protected readonly visibles = computed(() => {
    const f = this.filtro();
    const lista = f === 'todos' ? this.avisos() : this.avisos().filter((a) => a.estado === f);
    return [...lista].sort((a, b) => {
      const pa = a.estado === 'pendiente' ? 0 : 1;
      const pb = b.estado === 'pendiente' ? 0 : 1;
      return pa - pb || b.created_at.localeCompare(a.created_at);
    });
  });

  protected readonly detalle = computed(() => {
    const id = this.elegido();
    const lista = this.visibles();
    return lista.find((a) => a.aviso_id === id) ?? lista[0] ?? null;
  });

  protected readonly estado = estadoMeta;
  protected readonly gravedad = gravedadMeta;
  protected readonly rol = rolLabel;

  constructor() {
    this.load();

    // Un aviso enviado desde el diálogo global («Reportar falla» de la navegación) aparece aquí sin volver a pedir la lista.
    effect(() => {
      const nuevo = this.reportarUi.creado();
      if (!nuevo) return;
      untracked(() => this.agregar(nuevo));
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (avisos) => {
        this.avisos.set(avisos);
        this.loading.set(false);
        if (this.puedeGestionar()) this.pendientesSvc.sincronizar(avisos);
      },
      error: (err) => {
        this.error.set(apiErrorMessage(err, 'No se pudieron cargar los avisos.'));
        this.loading.set(false);
      },
    });
  }

  protected setFiltro(f: Filtro): void {
    this.filtro.set(f);
  }

  protected elegir(a: Aviso): void {
    this.elegido.set(a.aviso_id);
  }

  private agregar(aviso: Aviso): void {
    if (this.avisos().some((a) => a.aviso_id === aviso.aviso_id)) return;
    this.avisos.update((lista) => [aviso, ...lista]);
    // Quien reporta quiere ver su aviso recién enviado, aunque estuviera filtrando otro estado.
    if (!this.puedeGestionar()) this.filtro.set('todos');
    this.sincronizarPendientes();
  }

  protected onOtGenerada(res: AvisoGenerarOtResponse): void {
    this.generando.set(null);
    this.reemplazar(res.aviso);
  }

  protected onDescartado(aviso: Aviso): void {
    this.descartando.set(null);
    this.reemplazar(aviso);
  }

  private reemplazar(actualizado: Aviso): void {
    this.avisos.update((lista) => lista.map((a) => (a.aviso_id === actualizado.aviso_id ? actualizado : a)));
    this.sincronizarPendientes();
  }

  private sincronizarPendientes(): void {
    if (this.puedeGestionar()) this.pendientesSvc.sincronizar(this.avisos());
  }
}
