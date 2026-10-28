import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Aviso, AvisoGenerarOtResponse, EstadoAviso } from '../../core/models';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AvisosApi } from '../../core/services/avisos-api';
import { apiErrorMessage } from '../../core/utils/http-error';
import { rolLabel } from '../transacciones/etiquetas';
import { DescartarAviso } from './descartar-aviso';
import { ESTADO_META, estadoMeta, gravedadMeta } from './etiquetas';
import { GenerarOtAviso } from './generar-ot-aviso';
import { ReportarFalla } from './reportar-falla';
import { VerFotoAviso } from './ver-foto-aviso';

type Filtro = EstadoAviso | 'todos';

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'pendiente', label: ESTADO_META.pendiente.label },
  { value: 'con_ot', label: ESTADO_META.con_ot.label },
  { value: 'descartado', label: ESTADO_META.descartado.label },
  { value: 'todos', label: 'Todos' },
];

/**
 * Avisos de falla. Quien trabaja en planta reporta una falla y sigue en qué quedó; supervisor y gerente ven el
 * repositorio completo de la empresa y deciden: generar una OT o descartar el aviso con un motivo.
 */
@Component({
  selector: 'app-avisos',
  imports: [DatePipe, RouterLink, ReportarFalla, GenerarOtAviso, DescartarAviso, VerFotoAviso],
  templateUrl: './avisos.html',
})
export class Avisos {
  private readonly api = inject(AvisosApi);
  private readonly permisos = inject(PermissionsService);

  protected readonly puedeGestionar = computed(() => this.permisos.canPerform('gestionar_avisos'));
  protected readonly puedeReportar = computed(() => this.permisos.canPerform('reportar_falla'));

  protected readonly filtros = FILTROS;
  protected readonly avisos = signal<Aviso[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Quien decide parte de lo pendiente; quien solo reporta, de todo lo suyo. */
  protected readonly filtro = signal<Filtro>(this.permisos.canPerform('gestionar_avisos') ? 'pendiente' : 'todos');

  protected readonly reportando = signal(false);
  protected readonly generando = signal<Aviso | null>(null);
  protected readonly descartando = signal<Aviso | null>(null);
  protected readonly viendoFoto = signal<Aviso | null>(null);

  protected readonly conteos = computed(() => {
    const c: Record<Filtro, number> = { pendiente: 0, con_ot: 0, descartado: 0, todos: this.avisos().length };
    for (const a of this.avisos()) c[a.estado] += 1;
    return c;
  });

  protected readonly visibles = computed(() => {
    const f = this.filtro();
    return f === 'todos' ? this.avisos() : this.avisos().filter((a) => a.estado === f);
  });

  protected readonly estado = estadoMeta;
  protected readonly gravedad = gravedadMeta;
  protected readonly rol = rolLabel;

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (avisos) => {
        this.avisos.set(avisos);
        this.loading.set(false);
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

  protected onReportado(aviso: Aviso): void {
    this.reportando.set(false);
    this.avisos.update((lista) => [aviso, ...lista]);
    // Quien reporta quiere ver su aviso recién enviado, aunque estuviera filtrando otro estado.
    if (!this.puedeGestionar()) this.filtro.set('todos');
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
  }
}
