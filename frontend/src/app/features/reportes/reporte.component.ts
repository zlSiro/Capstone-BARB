import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';

import { FiltrosReporte, ReporteId, VistaReporte } from '../../core/models';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { MtbfUnitService } from '../../core/services/mtbf-unit.service';
import { Icon } from '../../shared/components/ui/icon/icon';
import { columnasDisponibles, columnasElegidas } from './columnas';
import { GraficoBarrasComponent } from './comun/grafico-barras.component';
import { GraficoLineaComponent } from './comun/grafico-linea.component';
import { exportacionPermitida } from './cuadratura/cuadratura';
import { CuadraturaPanelComponent } from './cuadratura/cuadratura-panel.component';
import { celdaPantalla, descargarCsv, encabezado, generarCsv, nombreArchivo } from './export/csv';
import { etiquetasFiltros } from './filtros/etiquetas';
import { CATALOGOS_VACIOS, Catalogos, ClaveFiltro, Descarte, aQuery, filtrosPorDefecto, filtrosSoloCliente, parsearFiltros } from './filtros/filtros-url';
import { FiltrosReporteComponent } from './filtros/filtros-reporte.component';
import { Contexto, Formato } from './logica/tipos';
import { EntradaCargada, ReportesDatosService, construirVista } from './reportes-datos.service';
import { ReporteDef, puedeVerReporte, reportePorId } from './reportes-catalogo';

const PAGINA = 100;
const CLASE_IMPRESION = 'imprimiendo-reporte';

/**
 * Pantalla de un reporte. Una sola página sirve a los 10: carga lo que el reporte necesita (`ReportesDatosService`), arma la vista
 * con funciones puras (`construirVista`) y la dibuja, la exporta a CSV y la imprime como PDF.
 *
 * La URL es la fuente de verdad de los filtros: cada cambio navega con `replaceUrl`, y al abrir o recargar el enlace el reporte
 * queda igual. Solo se vuelve a pedir datos si cambió algo que el backend entiende; los demás filtros se aplican en el cliente.
 */
@Component({
  selector: 'app-reporte',
  imports: [CuadraturaPanelComponent, FiltrosReporteComponent, GraficoBarrasComponent, GraficoLineaComponent, Icon, RouterLink, TranslatePipe],
  template: `
    @if (def(); as d) {
      <section class="flex flex-col gap-4" aria-labelledby="reporte-titulo" data-testid="reporte">
        <!-- Encabezado de la hoja impresa (solo en el PDF): quién, qué, con qué filtros y cuándo. -->
        <header class="hidden border-b border-borde pb-3 print:block" data-testid="hoja-encabezado">
          <p class="text-xl font-bold">{{ empresa() }}</p>
          <p class="text-lg">{{ 'reportes.' + d.id + '_titulo' | translate }}</p>
          <p class="text-sm">{{ 'reportes.hoja_filtros' | translate }}: {{ filtrosTexto() }}</p>
          <p class="text-sm">{{ 'reportes.hoja_generado' | translate: { v0: generado(), v1: usuario(), v2: perfil() } }}</p>
        </header>

        <div class="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div class="min-w-0">
            <a routerLink="/reportes" class="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-accion" data-testid="volver">
              <app-icon name="atras" [size]="16" />{{ 'reportes.volver' | translate }}
            </a>
            <h1 id="reporte-titulo" class="text-3xl font-bold leading-tight text-tinta">{{ 'reportes.' + d.id + '_titulo' | translate }}</h1>
            <p class="mt-1 max-w-prose text-base text-tinta-suave">{{ 'reportes.' + d.id + '_desc' | translate }}</p>
          </div>
          <div class="flex flex-wrap gap-2" data-tour="reporte-exportar">
            <button type="button" class="btn-secondary" (click)="exportar()" [disabled]="!puedeExportar()" data-testid="exportar-csv">
              <app-icon name="clip" [size]="18" />{{ 'reportes.exportar_csv' | translate }}
            </button>
            <button type="button" class="btn-secondary" (click)="imprimir()" [disabled]="!puedeExportar()" data-testid="exportar-pdf">
              <app-icon name="registro" [size]="18" />{{ 'reportes.exportar_pdf' | translate }}
            </button>
          </div>
        </div>

        <app-filtros-reporte
          [id]="d.id"
          [filtros]="filtros()"
          [cat]="cat()"
          [columnas]="columnasTodas()"
          [columnasMostradas]="columnas()"
          (cambio)="alCambiar($event)"
          (limpiar)="limpiar()"
          (buscar)="buscar($event)" />

        @if (descartes().length) {
          <p role="status" class="rounded-control bg-alerta-suave p-3 text-sm text-tinta print:hidden" data-testid="aviso-descartes">
            {{ 'reportes.filtros_descartados' | translate: { v0: descartesTexto() } }}
          </p>
        }
        @if (avisoTopologia()) {
          <p role="alert" class="rounded-control bg-peligro-suave p-3 text-sm font-medium text-peligro print:hidden" data-testid="aviso-topologia">
            {{ 'reportes.aviso_topologia_ajena' | translate }}
          </p>
        }

        @if (chips().length) {
          <ul class="flex flex-wrap gap-2 print:hidden" [attr.aria-label]="'reportes.filtros_activos' | translate" data-testid="chips">
            @for (c of chips(); track c.clave) {
              <li class="chip chip-accion">{{ c.texto }}</li>
            }
          </ul>
        }

        @switch (estado()) {
          @case ('cargando') {
            <p role="status" class="text-base text-tinta-suave" data-testid="cargando">{{ 'reportes.cargando' | translate }}</p>
          }
          @case ('error') {
            <div role="alert" class="panel flex flex-col gap-2 p-4" data-testid="error">
              <p class="text-base font-medium text-peligro">{{ 'reportes.error_carga' | translate }}</p>
              <button type="button" class="btn-secondary self-start" (click)="recargar()">{{ 'reportes.volver_a_cargar' | translate }}</button>
            </div>
          }
          @default {
            @if (vista(); as v) {
              @for (a of v.avisos; track a) {
                <p role="note" class="rounded-control bg-alerta-suave p-3 text-sm text-tinta" data-testid="aviso">{{ a }}</p>
              }

              @if (v.tarjetas.length) {
                <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="tarjetas">
                  @for (k of v.tarjetas; track k.id) {
                    <li class="panel flex flex-col gap-1 p-4 print:break-inside-avoid" [attr.data-testid]="'tarjeta-' + k.id">
                      <span class="text-sm font-semibold text-tinta-suave">{{ k.etiqueta }}</span>
                      <span class="codigo text-3xl text-tinta">{{ k.valor }}</span>
                      @if (k.detalle) {
                        <span class="text-sm text-tinta-suave">{{ k.detalle }}</span>
                      }
                      @if (k.aviso) {
                        <span class="text-sm text-tinta-suave">{{ k.aviso }}</span>
                      }
                    </li>
                  }
                </ul>
                @if (v.noCambiaCon.length) {
                  <p class="text-sm text-tinta-suave" data-testid="no-cambia-con">
                    {{ 'reportes.no_cambia_con' | translate }}: {{ noCambiaConTexto() }}
                  </p>
                }
              }

              @if (v.resumen) {
                <section class="panel p-4 print:break-inside-avoid" aria-labelledby="resumen-titulo" data-testid="resumen">
                  <h2 id="resumen-titulo" class="mb-1 text-lg font-bold text-tinta">{{ 'reportes.resumen_titulo' | translate }}</h2>
                  <p class="text-base text-tinta">{{ v.resumen }}</p>
                </section>
              }

              @if (v.lineas.length || v.barras.length) {
                <div class="grid gap-4 lg:grid-cols-2">
                  @for (g of v.lineas; track g.id) {
                    <div class="panel p-4 print:break-inside-avoid"><app-grafico-linea [grafico]="g" /></div>
                  }
                  @for (g of v.barras; track g.id) {
                    <div class="panel p-4 print:break-inside-avoid"><app-grafico-barras [grafico]="g" /></div>
                  }
                </div>
              }

              @if (v.columnas.length) {
                <section class="flex flex-col gap-2" aria-labelledby="tabla-titulo" data-tour="reporte-tabla">
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="tabla-titulo" class="text-lg font-bold text-tinta">{{ 'reportes.tabla_titulo' | translate }}</h2>
                    <p class="text-sm text-tinta-suave" data-testid="mostrando">
                      {{ 'reportes.mostrando' | translate: { v0: v.filas.length, v1: v.totalSinFiltrar } }}
                    </p>
                  </div>
                  @if (v.filas.length) {
                    <div class="overflow-x-auto rounded-control border border-borde">
                      <table class="w-full min-w-max border-collapse text-left text-sm" data-testid="tabla">
                        <thead class="bg-superficie-2">
                          <tr>
                            @for (c of columnas(); track c.id) {
                              <th scope="col" class="border-b border-borde px-3 py-2 font-semibold text-tinta">{{ encabezadoDe(c) }}</th>
                            }
                          </tr>
                        </thead>
                        <tbody>
                          @for (f of filasVisibles(); track $index) {
                            <tr class="border-b border-borde last:border-b-0 print:break-inside-avoid" data-testid="fila-reporte">
                              @for (c of columnas(); track c.id) {
                                <td class="px-3 py-2 text-tinta" [class.codigo]="c.tipo !== 'texto' && c.tipo !== 'enum'">{{ celda(f[c.id] ?? null, c) }}</td>
                              }
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    @if (hayMas()) {
                      <button type="button" class="btn-secondary self-start print:hidden" (click)="verMas()" data-testid="ver-mas">
                        {{ 'reportes.ver_mas' | translate: { v0: restantes() } }}
                      </button>
                    }
                  } @else {
                    <p class="panel p-4 text-base text-tinta-suave" data-testid="sin-filas">{{ 'reportes.sin_filas' | translate }}</p>
                  }
                </section>
              }

              @if (v.detalleMaquinas?.length) {
                <section class="flex flex-col gap-2" aria-labelledby="detalle-titulo" data-testid="detalle-maquinas">
                  <h2 id="detalle-titulo" class="text-lg font-bold text-tinta">{{ 'reportes.detalle_titulo' | translate }}</h2>
                  @for (m of v.detalleMaquinas; track m.id) {
                    <details class="panel p-3">
                      <summary class="cursor-pointer text-base font-semibold text-tinta">{{ m.nombre }}</summary>
                      <p class="mt-2 text-sm text-tinta-suave">{{ 'reportes.detalle_mttr' | translate: { v0: m.filasMttr.length } }}</p>
                      <ul class="mb-2 flex flex-wrap gap-2">
                        @for (f of m.filasMttr; track $index) {
                          <li class="chip chip-neutro codigo">{{ f['numero_ot'] }} · {{ f['tiempo_reparacion_min'] }} min</li>
                        }
                      </ul>
                      <p class="text-sm text-tinta-suave">{{ 'reportes.detalle_mtbf' | translate: { v0: m.filasMtbf.length } }}</p>
                      <ul class="flex flex-wrap gap-2">
                        @for (f of m.filasMtbf; track $index) {
                          <li class="chip chip-neutro codigo">{{ f['numero_ot'] }}</li>
                        }
                      </ul>
                    </details>
                  }
                </section>
              }

              <app-cuadratura-panel [controles]="v.controles" (recargar)="recargar()" />

              @if (v.ficha.length) {
                <section class="flex flex-col gap-2 print:break-inside-avoid" aria-labelledby="ficha-titulo" data-testid="como-se-calcula">
                  <h2 id="ficha-titulo" class="text-lg font-bold text-tinta">{{ 'reportes.como_se_calcula' | translate }}</h2>
                  @for (fi of v.ficha; track fi.id) {
                    <details class="panel p-3" [open]="imprimiendo()">
                      <summary class="cursor-pointer text-base font-semibold text-tinta">{{ fi.indicador }}</summary>
                      <dl class="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
                        <dt class="font-semibold text-tinta-suave">{{ 'reportes.ficha_formula' | translate }}</dt><dd class="text-tinta">{{ fi.formula }}</dd>
                        <dt class="font-semibold text-tinta-suave">{{ 'reportes.ficha_unidad' | translate }}</dt><dd class="text-tinta">{{ fi.unidad }}</dd>
                        <dt class="font-semibold text-tinta-suave">{{ 'reportes.ficha_ventana' | translate }}</dt><dd class="text-tinta">{{ fi.ventana }}</dd>
                        @if (fi.advertencia) {
                          <dt class="font-semibold text-tinta-suave">{{ 'reportes.ficha_advertencia' | translate }}</dt><dd class="text-tinta">{{ fi.advertencia }}</dd>
                        }
                      </dl>
                    </details>
                  }
                </section>
              }
            }
          }
        }
      </section>
    }
  `,
})
export class ReporteComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datos = inject(ReportesDatosService);
  private readonly i18n = inject(I18nService);
  private readonly permisos = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly currency = inject(CurrencyService);
  private readonly mtbfUnit = inject(MtbfUnitService);

  protected readonly def = signal<ReporteDef | null>(null);
  protected readonly cat = signal<Catalogos>(CATALOGOS_VACIOS);
  protected readonly filtros = signal<FiltrosReporte>(filtrosPorDefecto('r1'));
  protected readonly descartes = signal<Descarte[]>([]);
  protected readonly estado = signal<'cargando' | 'listo' | 'error'>('cargando');
  protected readonly avisoTopologia = signal(false);
  protected readonly imprimiendo = signal(false);
  protected readonly limite = signal(PAGINA);

  private readonly entrada = signal<EntradaCargada | null>(null);
  private readonly ahora = signal(Date.now());
  private claveActual = '';
  private carga?: Subscription;
  private catalogosListos = false;

  protected readonly puedeFinanzas = computed(() => this.permisos.canPerform('ver_kpis_financieros'));

  /** Formateo del idioma, la moneda y la unidad de MTBF activos. Cambiarlos reconstruye la vista sin volver a pedir datos. */
  protected readonly fmt = computed<Formato>(() => {
    const lang = this.i18n.lang();
    const arbol = this.i18n.tree().financial;
    const sufijo = { horas: arbol.mtbfUnitShortHoras, dias: arbol.mtbfUnitShortDias, meses: arbol.mtbfUnitShortMeses }[this.mtbfUnit.unidad()];
    const numero = (v: number, dec = 0) => new Intl.NumberFormat(lang === 'es' ? 'es-CL' : 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    const dos = (n: number) => String(n).padStart(2, '0');
    return {
      idioma: lang,
      t: (clave, params) => this.i18n.tr(clave, params),
      numero,
      moneda: (clp) => this.currency.formatear(clp),
      convertir: (clp) => this.currency.convertir(clp),
      monedaCodigo: this.currency.monedaEfectiva(),
      mtbf: (horas) => `${numero(this.mtbfUnit.convertir(horas) ?? 0, 1)} ${sufijo}`,
      fecha: (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
      },
    };
  });

  private readonly ctx = computed<Contexto>(() => ({
    f: this.filtros(),
    cat: this.cat(),
    fmt: this.fmt(),
    ahora: this.ahora(),
    puedeFinanzas: this.puedeFinanzas(),
    usuarioId: Number(this.auth.user()?.id ?? NaN) || null,
  }));

  protected readonly vista = computed<VistaReporte | null>(() => {
    const e = this.entrada();
    return e ? construirVista(e, this.ctx()) : null;
  });

  protected readonly columnasTodas = computed(() => (this.def() ? columnasDisponibles(this.def()!.id, this.puedeFinanzas()) : []));
  protected readonly columnas = computed(() => (this.def() ? columnasElegidas(this.def()!.id, this.filtros().cols, this.puedeFinanzas()) : []));
  protected readonly chips = computed(() => (this.def() ? etiquetasFiltros(this.def()!.id, this.filtros(), this.cat(), this.fmt()) : []));
  protected readonly filtrosTexto = computed(() => this.chips().map((c) => c.texto).join(' · ') || this.fmt().t('reportes.sin_filtros'));
  protected readonly noCambiaConTexto = computed(() =>
    this.def() ? filtrosSoloCliente(this.filtros(), this.def()!.id).map((c: ClaveFiltro) => this.fmt().t(`reportes.fn_${c}`)).join(', ') : '',
  );
  protected readonly descartesTexto = computed(() => this.descartes().map((d) => d.param).join(', '));

  protected readonly puedeExportar = computed(() => {
    const v = this.vista();
    return this.estado() === 'listo' && !!v && v.filas.length > 0 && exportacionPermitida(v.controles);
  });

  protected readonly filasVisibles = computed(() => {
    const filas = this.vista()?.filas ?? [];
    return this.imprimiendo() ? filas : filas.slice(0, this.limite());
  });
  protected readonly hayMas = computed(() => !this.imprimiendo() && (this.vista()?.filas.length ?? 0) > this.limite());
  protected readonly restantes = computed(() => (this.vista()?.filas.length ?? 0) - this.limite());

  protected readonly empresa = computed(() => this.auth.user()?.empresa_nombre ?? '');
  protected readonly usuario = computed(() => this.auth.user()?.name ?? '');
  protected readonly perfil = computed(() => this.auth.user()?.role ?? '');
  protected readonly generado = computed(() => this.fmt().fecha(new Date(this.ahora()).toISOString()));

  constructor() {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => this.alNavegar(params.get('id'), Object.fromEntries(query.keys.map((k) => [k, query.get(k)]))));
    this.destroyRef.onDestroy(() => {
      this.carga?.unsubscribe();
      document.body.classList.remove(CLASE_IMPRESION);
    });
  }

  // ------------------------------------------------------------------------------------------------ navegación y carga
  private alNavegar(id: string | null, query: Record<string, string | null>): void {
    const def = reportePorId(id);
    // Un id desconocido, o un reporte que el perfil no puede ver, lleva a la biblioteca sin mostrar nada.
    if (!def || !puedeVerReporte(def, this.permisos)) {
      void this.router.navigate(['/reportes'], { replaceUrl: true });
      return;
    }
    if (this.def()?.id !== def.id) {
      this.def.set(def);
      this.entrada.set(null);
      this.claveActual = '';
    }
    if (!this.catalogosListos) {
      this.estado.set('cargando');
      this.datos.catalogos().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (cat) => {
          this.cat.set(cat);
          this.catalogosListos = true;
          this.aplicar(def.id, query);
        },
        error: () => this.estado.set('error'),
      });
      return;
    }
    this.aplicar(def.id, query);
  }

  private aplicar(id: ReporteId, query: Record<string, string | null>): void {
    const columnas = columnasDisponibles(id, this.puedeFinanzas()).map((c) => c.id);
    const { filtros, descartes } = parsearFiltros(id, query, this.cat(), columnas);
    this.filtros.set(filtros);
    this.descartes.set(descartes);
    if (descartes.length) {
      // La URL se corrige: lo inválido o ajeno a la empresa se quita (el aviso queda a la vista).
      void this.router.navigate([], { queryParams: aQuery(id, filtros), replaceUrl: true });
      return;
    }
    const clave = this.datos.claveCarga(id, filtros);
    if (clave !== this.claveActual || this.entrada() === null) this.cargar(id, filtros, clave);
  }

  private cargar(id: ReporteId, filtros: FiltrosReporte, clave: string): void {
    this.claveActual = clave;
    this.carga?.unsubscribe();
    this.estado.set('cargando');
    this.limite.set(PAGINA);
    this.carga = this.datos
      .cargar(id, { f: filtros, cat: this.cat() }, { dashboard: this.permisos.canAccess('dashboard'), bitacora: this.permisos.canAccess('transacciones_empresa') })
      .subscribe({
        next: (e) => {
          this.ahora.set(Date.now());
          this.avisoTopologia.set(false);
          this.entrada.set(e);
          this.estado.set('listo');
        },
        error: (err: unknown) => {
          // 404 de la API de KPIs = planta/disciplina/máquina que no es de la empresa: se explica y se quita ese filtro.
          if (err instanceof HttpErrorResponse && err.status === 404 && (filtros.planta !== null || filtros.disciplina !== null || filtros.maquina !== null)) {
            this.avisoTopologia.set(true);
            this.claveActual = '';
            void this.router.navigate([], { queryParams: aQuery(id, { ...filtros, planta: null, disciplina: null, maquina: null }), replaceUrl: true });
            return;
          }
          this.claveActual = '';
          this.estado.set('error');
        },
      });
  }

  // ------------------------------------------------------------------------------------------------------- acciones
  protected alCambiar(f: FiltrosReporte): void {
    const id = this.def()!.id;
    this.limite.set(PAGINA);
    void this.router.navigate([], { queryParams: aQuery(id, f), replaceUrl: true });
  }

  protected limpiar(): void {
    this.alCambiar({ ...filtrosPorDefecto(this.def()!.id), cols: this.filtros().cols });
  }

  protected buscar(numero: string): void {
    this.alCambiar({ ...this.filtros(), numeroOt: numero.trim() });
  }

  protected recargar(): void {
    const id = this.def()!.id;
    this.cargar(id, this.filtros(), this.datos.claveCarga(id, this.filtros()));
  }

  protected verMas(): void {
    this.limite.update((n) => n + PAGINA);
  }

  protected encabezadoDe(c: { clave: string; tipo: string; id: string }): string {
    return encabezado(c as Parameters<typeof encabezado>[0], this.fmt());
  }

  protected celda(valor: string | number | null, c: { clave: string; tipo: string; id: string }): string {
    return celdaPantalla(valor, c as Parameters<typeof celdaPantalla>[1], this.fmt());
  }

  /** CSV solo con las columnas elegidas y las filas filtradas. Con un control de cuadratura en ✗ no se exporta. */
  protected exportar(): void {
    const v = this.vista();
    if (!v || !this.puedeExportar()) return;
    descargarCsv(nombreArchivo(this.def()!.id, this.filtros(), new Date()), generarCsv(this.columnas(), v.filas, this.fmt()));
  }

  /** PDF = hoja de impresión del navegador (`@media print`): sin menú ni botones, con encabezado y todas las filas. */
  protected imprimir(): void {
    if (!this.puedeExportar()) return;
    this.imprimiendo.set(true);
    document.body.classList.add(CLASE_IMPRESION);
    const terminar = () => {
      document.body.classList.remove(CLASE_IMPRESION);
      this.imprimiendo.set(false);
      window.removeEventListener('afterprint', terminar);
    };
    window.addEventListener('afterprint', terminar);
    // Un tick para que la tabla se redibuje con todas las filas antes de abrir el diálogo.
    setTimeout(() => window.print(), 50);
  }
}
