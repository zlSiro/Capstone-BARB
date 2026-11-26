import { Component, computed, input, output } from '@angular/core';

import { ColumnaDef, FiltrosReporte, ReporteId } from '../../../core/models';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { Icon } from '../../../shared/components/ui/icon/icon';
import {
  CAMPOS_FALTANTES,
  Catalogos,
  FILTROS_POR_REPORTE,
  GRANULARIDADES,
  PERIODOS,
  PRIORIDADES,
  SEVERIDADES,
  TIPOS,
  TRAMOS,
  ClaveFiltro,
  estadosPermitidos,
  limpiarCascada,
  maquinasVisibles,
} from './filtros-url';

const PERFILES_REPORTANTES = ['operador', 'tecnico', 'supervisor', 'engineer', 'gerente'] as const;

const valor = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value;
const entero = (v: string): number | null => (v === '' ? null : Number(v));

/**
 * Filtros de un reporte. Los comunes (periodo y topología en cascada) y los propios de cada reporte se muestran según
 * `FILTROS_POR_REPORTE`. Emite el objeto de filtros completo en cada cambio: la página lo guarda en la URL y vuelve a pedir datos
 * solo si cambió algo que el backend entiende.
 */
@Component({
  selector: 'app-filtros-reporte',
  imports: [Icon, TranslatePipe],
  template: `
    <section class="panel flex flex-col gap-3 p-4 print:hidden" aria-labelledby="filtros-titulo" data-testid="filtros-reporte" data-tour="reporte-filtros">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="filtros-titulo" class="text-lg font-bold text-tinta">{{ 'reportes.filtros' | translate }}</h2>
        <button type="button" class="btn-ghost" (click)="limpiar.emit()" data-testid="filtros-limpiar">
          <app-icon name="refrescar" [size]="18" />
          {{ 'reportes.limpiar' | translate }}
        </button>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        @if (usa('dias')) {
          <div>
            <label for="f-dias" class="fld-label">{{ 'reportes.f_periodo' | translate }}</label>
            <select id="f-dias" class="fld-input" data-testid="f-dias" (change)="poner('dias', valorDias($event))">
              @for (p of periodos; track p) {
                <option [value]="p === null ? 'hist' : p" [selected]="p === filtros().dias">
                  {{ p === null ? ('reportes.f_historico' | translate) : ('reportes.f_dias' | translate: { v0: p }) }}
                </option>
              }
            </select>
          </div>
        }
        @if (usa('planta')) {
          <div>
            <label for="f-planta" class="fld-label">{{ 'reportes.f_planta' | translate }}</label>
            <select id="f-planta" class="fld-input" data-testid="f-planta" (change)="poner('planta', entero($event))">
              <option value="">{{ 'reportes.f_todas' | translate }}</option>
              @for (p of cat().plantas; track p.id) {
                <option [value]="p.id" [selected]="p.id === filtros().planta">{{ p.name }}</option>
              }
            </select>
          </div>
        }
        @if (usa('disciplina')) {
          <div>
            <label for="f-disciplina" class="fld-label">{{ 'reportes.f_disciplina' | translate }}</label>
            <select id="f-disciplina" class="fld-input" data-testid="f-disciplina" (change)="poner('disciplina', entero($event))">
              <option value="">{{ 'reportes.f_todas' | translate }}</option>
              @for (d of cat().disciplinas; track d.id) {
                <option [value]="d.id" [selected]="d.id === filtros().disciplina">{{ d.name }}</option>
              }
            </select>
          </div>
        }
        @if (usa('maquina')) {
          <div>
            <label for="f-maquina" class="fld-label">{{ 'reportes.f_maquina' | translate }}</label>
            <select id="f-maquina" class="fld-input" data-testid="f-maquina" (change)="poner('maquina', entero($event))">
              <option value="">{{ 'reportes.f_todas' | translate }}</option>
              @for (m of maquinas(); track m.id) {
                <option [value]="m.id" [selected]="m.id === filtros().maquina">{{ m.name }}</option>
              }
            </select>
          </div>
        }
        @if (usa('granularidad')) {
          <div>
            <label for="f-gran" class="fld-label">{{ 'reportes.f_granularidad' | translate }}</label>
            <select id="f-gran" class="fld-input" data-testid="f-gran" (change)="poner('granularidad', texto($event))">
              <option value="">{{ 'reportes.f_automatica' | translate }}</option>
              @for (g of granularidades; track g) {
                <option [value]="g" [selected]="g === filtros().granularidad">{{ 'reportes.v_gran_' + g | translate }}</option>
              }
            </select>
          </div>
        }
        @if (usa('prioridad')) {
          <div>
            <label for="f-prioridad" class="fld-label">{{ 'reportes.f_prioridad' | translate }}</label>
            <select id="f-prioridad" class="fld-input" (change)="poner('prioridad', texto($event))">
              <option value="">{{ 'reportes.f_todas' | translate }}</option>
              @for (p of prioridades; track p) {
                <option [value]="p" [selected]="p === filtros().prioridad">{{ 'reportes.v_prioridad_' + p | translate }}</option>
              }
            </select>
          </div>
        }
        @if (usa('tipo')) {
          <div>
            <label for="f-tipo" class="fld-label">{{ 'reportes.f_tipo' | translate }}</label>
            <select id="f-tipo" class="fld-input" (change)="poner('tipo', texto($event))">
              <option value="">{{ 'reportes.f_todos' | translate }}</option>
              @for (x of tipos; track x) {
                <option [value]="x" [selected]="x === filtros().tipo">{{ 'reportes.v_tipo_' + x | translate }}</option>
              }
            </select>
          </div>
        }
        @if (usa('tecnico')) {
          <div>
            <label for="f-tecnico" class="fld-label">{{ 'reportes.f_tecnico' | translate }}</label>
            <select id="f-tecnico" class="fld-input" (change)="poner('tecnico', entero($event))">
              <option value="">{{ 'reportes.f_todos' | translate }}</option>
              @for (x of cat().tecnicos; track x.id) {
                <option [value]="x.id" [selected]="x.id === filtros().tecnico">{{ x.name }}</option>
              }
            </select>
          </div>
        }
        @if (usa('tramo')) {
          <div>
            <label for="f-tramo" class="fld-label">{{ 'reportes.f_tramo' | translate }}</label>
            <select id="f-tramo" class="fld-input" (change)="poner('tramo', texto($event))">
              <option value="">{{ 'reportes.f_todos' | translate }}</option>
              @for (x of tramos; track x) {
                <option [value]="x" [selected]="x === filtros().tramo">{{ 'reportes.v_tramo_' + x | translate }}</option>
              }
            </select>
          </div>
        }
        @if (usa('severidad')) {
          <div>
            <label for="f-severidad" class="fld-label">{{ 'reportes.f_severidad' | translate }}</label>
            <select id="f-severidad" class="fld-input" (change)="poner('severidad', texto($event))">
              <option value="">{{ 'reportes.f_todas' | translate }}</option>
              @for (x of severidades; track x) {
                <option [value]="x" [selected]="x === filtros().severidad">{{ 'reportes.v_severidad_' + x | translate }}</option>
              }
            </select>
          </div>
        }
        @if (usa('perfil')) {
          <div>
            <label for="f-perfil" class="fld-label">{{ 'reportes.f_perfil' | translate }}</label>
            <select id="f-perfil" class="fld-input" (change)="poner('perfil', texto($event))">
              <option value="">{{ 'reportes.f_todos' | translate }}</option>
              @for (x of perfiles; track x) {
                <option [value]="x" [selected]="x === filtros().perfil">{{ 'reportes.v_rol_' + x | translate }}</option>
              }
            </select>
          </div>
        }
        @if (usa('estadoOt')) {
          <div>
            <label for="f-estado-ot" class="fld-label">{{ 'reportes.f_estado_ot' | translate }}</label>
            <select id="f-estado-ot" class="fld-input" (change)="poner('estadoOt', texto($event))">
              <option value="">{{ 'reportes.f_todos' | translate }}</option>
              @for (x of estadosOt(); track x) {
                <option [value]="x" [selected]="x === filtros().estadoOt">{{ 'reportes.v_estado_' + x | translate }}</option>
              }
            </select>
          </div>
        }
        @if (usa('campoFaltante')) {
          <div>
            <label for="f-falta" class="fld-label">{{ 'reportes.f_campo_faltante' | translate }}</label>
            <select id="f-falta" class="fld-input" (change)="poner('campoFaltante', texto($event))">
              <option value="">{{ 'reportes.f_cualquiera' | translate }}</option>
              @for (x of camposFaltantes; track x) {
                <option [value]="x" [selected]="x === filtros().campoFaltante">{{ 'reportes.v_falta_' + x | translate }}</option>
              }
            </select>
          </div>
        }
        @if (usa('numeroOt')) {
          <form class="flex items-end gap-2 sm:col-span-2" data-tour="reporte-buscar" (submit)="$event.preventDefault(); buscar.emit(numero.value)">
            <div class="min-w-0 flex-1">
              <label for="f-numero-ot" class="fld-label">{{ 'reportes.f_numero_ot' | translate }}</label>
              <input #numero id="f-numero-ot" class="fld-input" type="text" autocomplete="off" placeholder="OT-2026-0001" data-testid="f-numero-ot" [value]="filtros().numeroOt" />
            </div>
            <button type="submit" class="btn-primary" data-testid="f-buscar">
              <app-icon name="lupa" [size]="18" />
              {{ 'reportes.f_buscar' | translate }}
            </button>
          </form>
        }
      </div>

      @if (usa('estados')) {
        <fieldset class="flex flex-wrap gap-x-4 gap-y-2" data-testid="f-estados">
          <legend class="fld-label">{{ 'reportes.f_estado' | translate }}</legend>
          @for (e of estados(); track e) {
            <label class="flex items-center gap-2 text-sm text-tinta">
              <input type="checkbox" [checked]="filtros().estados.includes(e)" (change)="alternarEstado(e)" />
              {{ (esAviso() ? 'reportes.v_aviso_' : 'reportes.v_estado_') + e | translate }}
            </label>
          }
        </fieldset>
      }
      @if (usa('soloDemoradas') || usa('soloDesviacion')) {
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          @if (usa('soloDemoradas')) {
            <label class="flex items-center gap-2 text-sm text-tinta">
              <input type="checkbox" [checked]="filtros().soloDemoradas" (change)="poner('soloDemoradas', marcado($event))" />
              {{ 'reportes.f_solo_demoradas' | translate }}
            </label>
          }
          @if (usa('soloDesviacion')) {
            <label class="flex items-center gap-2 text-sm text-tinta">
              <input type="checkbox" [checked]="filtros().soloDesviacion" (change)="poner('soloDesviacion', marcado($event))" />
              {{ 'reportes.f_solo_desviacion' | translate }}
            </label>
          }
        </div>
      }

      @if (columnas().length) {
        <details class="rounded-control border border-borde p-3" data-testid="f-columnas">
          <summary class="cursor-pointer text-sm font-semibold text-tinta">{{ 'reportes.f_columnas' | translate }}</summary>
          <p class="mt-2 text-sm text-tinta-suave">{{ 'reportes.f_columnas_ayuda' | translate }}</p>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            @for (c of columnas(); track c.id) {
              <label class="flex items-center gap-2 text-sm text-tinta">
                <input type="checkbox" [checked]="columnaActiva(c)" (change)="alternarColumna(c.id)" [attr.data-testid]="'col-' + c.id" />
                {{ c.clave | translate }}
              </label>
            }
          </div>
        </details>
      }
    </section>
  `,
})
export class FiltrosReporteComponent {
  readonly id = input.required<ReporteId>();
  readonly filtros = input.required<FiltrosReporte>();
  readonly cat = input.required<Catalogos>();
  /** Columnas disponibles para el perfil (el selector no ofrece nada más). */
  readonly columnas = input<readonly ColumnaDef[]>([]);
  /** Columnas que se están mostrando (las elegidas o las de por defecto). */
  readonly columnasMostradas = input<readonly ColumnaDef[]>([]);

  readonly cambio = output<FiltrosReporte>();
  readonly limpiar = output<void>();
  readonly buscar = output<string>();

  protected readonly periodos = PERIODOS;
  protected readonly granularidades = GRANULARIDADES;
  protected readonly prioridades = PRIORIDADES;
  protected readonly tipos = TIPOS;
  protected readonly tramos = TRAMOS;
  protected readonly severidades = SEVERIDADES;
  protected readonly perfiles = PERFILES_REPORTANTES;
  protected readonly camposFaltantes = CAMPOS_FALTANTES;

  protected readonly maquinas = computed(() => maquinasVisibles(this.cat(), this.filtros()));
  protected readonly estados = computed(() => estadosPermitidos(this.id()));
  protected readonly esAviso = computed(() => this.id() === 'r7' || this.id() === 'r8');
  protected readonly estadosOt = computed(() => estadosPermitidos('r6'));

  protected usa(clave: ClaveFiltro): boolean {
    return FILTROS_POR_REPORTE[this.id()].includes(clave);
  }

  protected texto(e: Event): string | null {
    return valor(e) || null;
  }
  protected entero(e: Event): number | null {
    return entero(valor(e));
  }
  protected valorDias(e: Event): number | null {
    const v = valor(e);
    return v === 'hist' ? null : Number(v);
  }
  protected marcado(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  protected poner(clave: ClaveFiltro, v: unknown): void {
    // Al cambiar planta o disciplina, una máquina que ya no corresponde se limpia (cascada).
    const { filtros } = limpiarCascada({ ...this.filtros(), [clave]: v } as FiltrosReporte, this.cat());
    this.cambio.emit(filtros);
  }

  protected alternarEstado(e: string): void {
    const actuales = this.filtros().estados;
    this.poner('estados', actuales.includes(e) ? actuales.filter((x) => x !== e) : [...actuales, e]);
  }

  protected columnaActiva(c: ColumnaDef): boolean {
    return this.columnasMostradas().some((x) => x.id === c.id);
  }

  protected alternarColumna(id: string): void {
    const mostradas = this.columnasMostradas().map((c) => c.id);
    const nuevas = mostradas.includes(id) ? mostradas.filter((x) => x !== id) : [...mostradas, id];
    // Siempre queda al menos una columna: si se quitaran todas, se volvería a las de por defecto sin avisar.
    this.cambio.emit({ ...this.filtros(), cols: nuevas.length ? nuevas : mostradas });
  }
}
