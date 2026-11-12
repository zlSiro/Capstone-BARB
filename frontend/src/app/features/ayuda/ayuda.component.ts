import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Icon } from '../../shared/components/ui/icon/icon';
import { RecorridoDef, claveRecorrido, claveTarea } from './ayuda-contenido';
import { AyudaService } from './ayuda.service';
import { RecorridosService } from './recorridos.service';

/**
 * Inicio de «Aprende BARB». Contenido fijo del frontend: lo ve toda sesión iniciada (lo protege `authGuard`), y dentro
 * de la ayuda cada perfil ve solo lo suyo (`AyudaService` filtra con la matriz de permisos).
 */
@Component({
  selector: 'app-ayuda',
  imports: [Icon, RouterLink, TranslatePipe],
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="ayuda-titulo">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 id="ayuda-titulo" class="text-3xl font-bold leading-tight text-tinta">{{ 'ayuda.titulo' | translate }}</h1>
          <p class="mt-1 max-w-prose text-base text-tinta-suave">{{ 'ayuda.subtitulo' | translate }}</p>
        </div>
        <span class="chip chip-accion" data-testid="ayuda-perfil">
          <app-icon name="usuario" [size]="18" />
          {{ 'ayuda.perfil' | translate: { v0: etiquetaRol() } }}
        </span>
      </div>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <!-- Primeros pasos -->
        <section class="panel flex flex-col gap-4 p-5" aria-labelledby="ayuda-primeros">
          <div class="flex items-baseline justify-between gap-3">
            <h2 id="ayuda-primeros" class="text-xl font-bold text-tinta">{{ 'ayuda.primeros_pasos' | translate: { v0: etiquetaRol() } }}</h2>
            <p class="codigo text-xl text-tinta" data-testid="ayuda-avance">{{ 'ayuda.avance' | translate: { v0: ayuda.hechas(), v1: ayuda.tareas().length } }}</p>
          </div>
          <div
            class="h-2 overflow-hidden rounded-full bg-borde"
            role="progressbar"
            aria-valuemin="0"
            [attr.aria-valuemax]="ayuda.tareas().length"
            [attr.aria-valuenow]="ayuda.hechas()"
            [attr.aria-label]="'ayuda.avance_aria' | translate: { v0: ayuda.hechas(), v1: ayuda.tareas().length }">
            <div class="h-full bg-ok transition-[width] duration-300" [style.width.%]="porcentaje()"></div>
          </div>

          @if (ayuda.tareas().length) {
            <ul class="flex flex-col" data-testid="ayuda-tareas">
              @for (t of ayuda.tareas(); track t.def.id) {
                <li class="flex items-center gap-3 border-t border-borde py-3 first:border-t-0" [attr.data-testid]="'tarea-' + t.def.id">
                  <app-icon [name]="t.hecha ? 'check-circulo' : 'reloj'" [size]="26" [class]="t.hecha ? 'text-ok' : 'text-tinta-suave'" />
                  <div class="min-w-0 flex-1">
                    <p class="text-base font-semibold text-tinta" [class.line-through]="t.hecha">{{ claveTarea(t.def.id, 'titulo') | translate }}</p>
                    <p class="text-sm text-tinta-suave">{{ claveTarea(t.def.id, 'desc') | translate }}</p>
                  </div>
                  @if (t.hecha) {
                    <span class="chip chip-ok" data-testid="tarea-hecha">{{ 'ayuda.hecho' | translate }}</span>
                  } @else {
                    <span class="sr-only">{{ 'ayuda.pendiente' | translate }}</span>
                    @if (t.def.recorrido; as recorrido) {
                      <button
                        type="button"
                        class="btn-secondary shrink-0"
                        data-testid="tarea-mostrar"
                        [attr.aria-label]="'ayuda.mostrarme_aria' | translate: { v0: (claveTarea(t.def.id, 'titulo') | translate) }"
                        (click)="iniciar(recorrido, $event)">
                        <app-icon name="play" [size]="16" />
                        {{ 'ayuda.mostrarme' | translate }}
                      </button>
                    }
                  }
                </li>
              }
            </ul>
          } @else {
            <p class="text-base text-tinta-suave">{{ 'ayuda.sin_tareas' | translate }}</p>
          }
        </section>

        <div class="flex flex-col gap-4">
          <!-- Pregúntale a la ayuda (búsqueda local sobre las guías del perfil) -->
          <section class="panel flex flex-col gap-3 p-5" aria-labelledby="ayuda-preguntale">
            <h2 id="ayuda-preguntale" class="text-xl font-bold text-tinta">{{ 'ayuda.preguntale_titulo' | translate }}</h2>
            <form class="flex flex-col gap-2" (submit)="$event.preventDefault(); preguntar()">
              <label for="ayuda-pregunta" class="sr-only">{{ 'ayuda.preguntale_label' | translate }}</label>
              <input
                id="ayuda-pregunta"
                type="search"
                class="fld-input"
                autocomplete="off"
                data-testid="ayuda-pregunta"
                [value]="pregunta()"
                [attr.placeholder]="'ayuda.preguntale_placeholder' | translate"
                (input)="pregunta.set($any($event.target).value)" />
              <p class="fld-ayuda">{{ 'ayuda.preguntale_nota' | translate }}</p>
            </form>
          </section>

          <!-- Recorridos guiados -->
          <section class="panel p-5" aria-labelledby="ayuda-recorridos">
            <h2 id="ayuda-recorridos" class="mb-2 text-base font-bold text-tinta-suave">{{ 'ayuda.recorridos' | translate }}</h2>
            @if (ayuda.recorridos().length) {
              <ul data-testid="ayuda-recorridos">
                @for (rec of ayuda.recorridos(); track rec.id) {
                  <li class="border-t border-borde first:border-t-0">
                    <button
                      type="button"
                      class="flex min-h-12 w-full items-center gap-3 rounded-control px-1 text-left text-base text-tinta hover:bg-superficie-2"
                      [attr.data-testid]="'recorrido-' + rec.id"
                      (click)="iniciar(rec.id, $event)">
                      <app-icon name="play" [size]="16" />
                      <span class="min-w-0 flex-1">{{ claveRecorrido(rec.id, 'titulo') | translate }}</span>
                      <span class="shrink-0 text-sm text-tinta-suave">{{ 'ayuda.pasos' | translate: { v0: rec.pasos.length } }}</span>
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-base text-tinta-suave">{{ 'ayuda.sin_recorridos' | translate }}</p>
            }
          </section>

          <!-- Explícame esta pantalla -->
          <section class="panel flex items-start gap-3 bg-superficie-2 p-5" aria-labelledby="ayuda-explicame">
            <app-icon name="foco" [size]="28" class="mt-0.5 text-accion" />
            <div class="min-w-0">
              <h2 id="ayuda-explicame" class="text-base font-bold text-tinta">{{ 'ayuda.explicame_titulo' | translate }}</h2>
              <p class="mt-1 text-sm text-tinta-suave">{{ 'ayuda.explicame_texto' | translate }}</p>
              @if (dashboard(); as d) {
                <a class="btn-secondary mt-3" [routerLink]="d.path" data-testid="ayuda-ir-dashboard">{{ 'ayuda.explicame_ir' | translate }}</a>
              }
            </div>
          </section>
        </div>
      </div>
    </section>
  `,
})
export class AyudaComponent {
  protected readonly ayuda = inject(AyudaService);
  private readonly recorridos = inject(RecorridosService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  protected readonly claveTarea = claveTarea;
  protected readonly claveRecorrido = claveRecorrido;

  protected readonly pregunta = signal('');

  /** Etiqueta del perfil, traducida (reutiliza los nombres de rol del aviso de privilegios). */
  protected readonly etiquetaRol = computed(() => {
    const rol = this.ayuda.rol();
    return rol ? this.i18n.tr(`privilegios.rol_${rol}`) : '';
  });

  protected readonly porcentaje = computed(() => {
    const total = this.ayuda.tareas().length;
    return total ? (this.ayuda.hechas() / total) * 100 : 0;
  });

  /** Solo se ofrece ir al dashboard si el perfil puede entrar (ahí está el botón «Explícame»). */
  protected readonly dashboard = computed(() => this.ayuda.pantalla('/dashboard'));

  protected iniciar(id: RecorridoDef['id'], evento: Event): void {
    this.recorridos.iniciar(id, evento.currentTarget as HTMLElement);
  }

  protected preguntar(): void {
    const q = this.pregunta().trim();
    void this.router.navigate(['/ayuda/preguntar'], { queryParams: q ? { q } : {} });
  }
}
