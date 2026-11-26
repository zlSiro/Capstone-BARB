import { Service, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, expand, forkJoin, map, of, reduce, switchMap, throwError, EMPTY } from 'rxjs';

import { Aviso, FinancialStats, FiltrosReporte, HistoricoRespuesta, ReporteId, Transaccion, VistaReporte, WorkOrder } from '../../core/models';
import { AvisosApi } from '../../core/services/avisos-api';
import { CatalogService } from '../../core/services/catalog.service';
import { StatsService } from '../../core/services/stats.service';
import { TransaccionesEmpresaApi } from '../../core/services/transacciones-empresa-api';
import { WorkOrdersService } from '../../core/services/work-orders.service';
import { Catalogos, granularidadPorDefecto } from './filtros/filtros-url';
import { Contexto } from './logica/tipos';
import { construirR1, construirR2 } from './logica/r1-r2';
import { construirR3, construirR4, construirR5 } from './logica/r3-r5';
import { construirR10, construirR6, construirR7, construirR8, construirR9 } from './logica/r6-r10';

/** Lo que cada reporte necesita del backend, ya cargado. Sirve para volver a armar la vista sin pedir nada si solo cambian filtros de cliente. */
export type EntradaCargada =
  | { id: 'r1'; stats: FinancialStats; historico: HistoricoRespuesta; ots: WorkOrder[] }
  | { id: 'r2'; stats: FinancialStats; historico: HistoricoRespuesta }
  | { id: 'r3'; ots: WorkOrder[]; statsAhora: FinancialStats }
  | { id: 'r4' | 'r5' | 'r6'; stats: FinancialStats; ots: WorkOrder[] }
  | { id: 'r7'; avisos: Aviso[] }
  | { id: 'r8'; avisos: Aviso[]; ots: WorkOrder[] }
  | { id: 'r9'; ot: WorkOrder | null; buscada: boolean; bitacora: Transaccion[] | null }
  | { id: 'r10'; ots: WorkOrder[]; stats: FinancialStats | null };

/** Lo que se necesita saber del perfil para decidir qué pedir. */
export interface PerfilCarga {
  /** Tiene la ruta `dashboard` (KPIs de `stats`). */
  dashboard: boolean;
  /** Tiene la ruta `transacciones_empresa` (bitácora de la empresa: solo el gerente). */
  bitacora: boolean;
}

const un404 = (e: unknown): boolean => e instanceof HttpErrorResponse && e.status === 404;

const dia = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const DIA_MS = 86_400_000;
const PAGINA = 200;

/**
 * Datos de los reportes. Reúne las fuentes con `forkJoin` (para que todas se lean casi a la vez y el corte de tiempo del cliente
 * se parezca al `NOW()` del servidor) y delega todo el cálculo en funciones puras (`construirVista`).
 */
@Service()
export class ReportesDatosService {
  private readonly stats = inject(StatsService);
  private readonly ots = inject(WorkOrdersService);
  private readonly avisos = inject(AvisosApi);
  private readonly catalogo = inject(CatalogService);
  private readonly bitacora = inject(TransaccionesEmpresaApi);

  catalogos(): Observable<Catalogos> {
    return forkJoin({
      plantas: this.catalogo.getPlants(),
      disciplinas: this.catalogo.getDisciplines(),
      maquinas: this.catalogo.getMachines(),
      tecnicos: this.catalogo.getTechnicians(),
    });
  }

  /**
   * Clave de lo que obliga a volver a pedir datos: solo periodo, topología, granularidad y, según el reporte, el aviso con un solo
   * estado (R7) o el número de OT (R9). Los demás filtros se aplican en el cliente sobre lo ya cargado.
   */
  claveCarga(id: ReporteId, f: FiltrosReporte): string {
    const base: (string | number | null)[] = [id, f.dias, f.planta, f.disciplina, f.maquina];
    if (id === 'r1' || id === 'r2') base.push(f.granularidad ?? granularidadPorDefecto(f.dias));
    if (id === 'r7') base.push(f.estados.length === 1 ? f.estados[0] : '');
    if (id === 'r9') base.push(f.numeroOt);
    return base.join('|');
  }

  cargar(id: ReporteId, ctx: Pick<Contexto, 'f' | 'cat'>, perfil: PerfilCarga): Observable<EntradaCargada> {
    const { f } = ctx;
    const topo = { planta: f.planta, disciplina: f.disciplina, maquina: f.maquina };
    const statsPeriodo = () => this.stats.getFinancialImpactDias(f.dias, topo);
    const historico = () => this.stats.getHistoricalDias(f.granularidad ?? granularidadPorDefecto(f.dias), f.dias, topo);
    switch (id) {
      case 'r1':
        return forkJoin({ stats: statsPeriodo(), historico: historico(), ots: this.ots.getAll() }).pipe(map((x) => ({ id, ...x })));
      case 'r2':
        return forkJoin({ stats: statsPeriodo(), historico: historico() }).pipe(map((x) => ({ id, ...x })));
      case 'r3':
        // El backlog es una foto del momento: los KPIs se piden SIN `days` y con la misma topología.
        return forkJoin({ ots: this.ots.getAll(), statsAhora: this.stats.getFinancialImpactDias(null, topo) }).pipe(map((x) => ({ id, ...x })));
      case 'r4':
      case 'r5':
      case 'r6':
        return forkJoin({ stats: statsPeriodo(), ots: this.ots.getAll() }).pipe(map((x) => ({ id, ...x })));
      case 'r7':
        return this.avisos.list(f.estados.length === 1 ? (f.estados[0] as Aviso['estado']) : undefined).pipe(map((avisos) => ({ id, avisos })));
      case 'r8':
        return forkJoin({ avisos: this.avisos.list(), ots: this.ots.getAll() }).pipe(map((x) => ({ id, ...x })));
      case 'r9':
        return this.cargarTraza(f.numeroOt, perfil);
      case 'r10':
        return forkJoin({
          ots: this.ots.getAll(),
          stats: perfil.dashboard ? statsPeriodo().pipe(catchError(() => of(null))) : of(null),
        }).pipe(map((x) => ({ id, ...x })));
    }
  }

  private cargarTraza(numero: string, perfil: PerfilCarga): Observable<EntradaCargada> {
    if (!numero.trim()) return of({ id: 'r9', ot: null, buscada: false, bitacora: null });
    return this.ots.getByNumber(numero.trim()).pipe(
      // 404 = «no disponible» (no existe o el perfil no puede verla): el backend no distingue y la pantalla tampoco.
      catchError((e) => (un404(e) ? of(null) : throwError(() => e))),
      switchMap((ot) =>
        !ot || !perfil.bitacora
          ? of<EntradaCargada>({ id: 'r9', ot, buscada: true, bitacora: null })
          : this.bitacoraDe(ot).pipe(map((bitacora) => ({ id: 'r9' as const, ot, buscada: true, bitacora }))),
      ),
    );
  }

  /** Movimientos de la bitácora de una OT (solo gerente): rango desde la creación hasta el cierre (o hoy), recorrido por páginas. */
  private bitacoraDe(ot: WorkOrder): Observable<Transaccion[]> {
    const desde = dia(Date.parse(ot.created_at) - DIA_MS); // un día de margen por la zona horaria; el filtro exacto es por registro_id
    const hasta = dia((ot.fecha_cierre ? Date.parse(ot.fecha_cierre) : Date.now()) + DIA_MS);
    const pagina = (offset: number) => this.bitacora.getAll({ rango: 'custom', desde, hasta, limit: PAGINA, offset });
    return pagina(0).pipe(
      expand((p) => (p.offset + p.limit < p.total ? pagina(p.offset + p.limit) : EMPTY)),
      reduce((acc, p) => acc.concat(p.items), [] as Transaccion[]),
      map((items) => items.filter((t) => t.detalle?.tabla === 'orden_trabajo' && t.detalle?.registro_id === String(ot.ot_id))),
    );
  }
}

/** Arma la vista de un reporte a partir de lo cargado: función pura, sin HTTP. */
export function construirVista(e: EntradaCargada, ctx: Contexto): VistaReporte {
  switch (e.id) {
    case 'r1':
      return construirR1(e, ctx);
    case 'r2':
      return construirR2(e, ctx);
    case 'r3':
      return construirR3(e, ctx);
    case 'r4':
      return construirR4(e, ctx);
    case 'r5':
      return construirR5(e, ctx);
    case 'r6':
      return construirR6(e, ctx);
    case 'r7':
      return construirR7(e.avisos, ctx);
    case 'r8':
      return construirR8(e, ctx);
    case 'r9':
      return construirR9(e, ctx);
    case 'r10':
      return construirR10(e, ctx);
  }
}
