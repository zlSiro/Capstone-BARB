import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Icon } from '../../shared/components/ui/icon/icon';
import { buscarGuia } from './ayuda-buscador';
import { claveRecorrido } from './ayuda-contenido';
import { AyudaService } from './ayuda.service';
import { RecorridosService } from './recorridos.service';

interface RespuestaVista {
  id: string;
  /** Números de paso (1..n), para armar las claves de texto de cada paso. */
  pasos: number[];
  pantalla: { path: string; nav: string } | null;
}

/**
 * «Pregúntale a la ayuda»: búsqueda local sobre las guías del perfil y del idioma activos. Sin servidor y sin IA: la respuesta
 * es el resumen y los pasos de una guía que ya existe, con su fuente. Si nada coincide, lo dice y ofrece DocChat (si el perfil
 * lo tiene) o avisar al administrador; nunca inventa una respuesta ni llama a `/api/chat`.
 */
@Component({
  selector: 'app-ayuda-preguntar',
  imports: [Icon, RouterLink, TranslatePipe],
  template: `
    <section class="flex max-w-3xl flex-col gap-4" aria-labelledby="preguntar-titulo">
      <nav [attr.aria-label]="'ayuda.preg_miga_aria' | translate" class="text-sm text-tinta-suave">
        <a routerLink="/ayuda" class="hover:underline">{{ 'ayuda.preg_miga' | translate }}</a>
        <span aria-hidden="true"> › </span>
        <span aria-current="page" class="text-tinta">{{ 'ayuda.preg_titulo' | translate }}</span>
      </nav>
      <div>
        <h1 id="preguntar-titulo" class="text-3xl font-bold leading-tight text-tinta">{{ 'ayuda.preg_titulo' | translate }}</h1>
        <p class="mt-1 text-base text-tinta-suave">{{ 'ayuda.preg_sub' | translate }}</p>
      </div>

      <ol class="flex flex-col gap-4" data-testid="preguntar-conversacion">
        @for (c of conversacion(); track $index) {
          <li class="flex flex-col gap-3">
            <p class="self-end rounded-hoja bg-accion px-4 py-2.5 text-base text-sobre-accion" data-testid="pregunta-usuario">
              <span class="sr-only">{{ 'ayuda.preg_tu_pregunta' | translate }}: </span>{{ c.pregunta }}
            </p>

            @if (c.respuesta; as r) {
              <article class="panel flex flex-col gap-3 p-5" data-testid="respuesta" [attr.aria-label]="'ayuda.preg_respuesta_de' | translate">
                <p class="flex items-center gap-1.5 text-sm font-semibold text-accion">
                  <app-icon name="ayuda" [size]="16" />
                  {{ 'ayuda.preg_respuesta_de' | translate }}
                </p>
                <p class="text-base text-tinta" data-testid="respuesta-resumen">{{ claveRecorrido(r.id, 'resumen') | translate }}</p>
                <ol class="flex list-decimal flex-col gap-1.5 pl-5 text-base text-tinta" data-testid="respuesta-pasos">
                  @for (n of r.pasos; track n) {
                    <li>
                      <span class="font-semibold">{{ claveRecorrido(r.id, 'p' + n + '_titulo') | translate }}.</span>
                      {{ claveRecorrido(r.id, 'p' + n + '_texto') | translate }}
                    </li>
                  }
                </ol>
                <p class="flex items-center gap-1.5 border-t border-borde pt-3 text-sm text-tinta-suave" data-testid="respuesta-fuente">
                  <app-icon name="libro" [size]="16" />
                  {{ 'ayuda.preg_fuente' | translate: { v0: (claveRecorrido(r.id, 'titulo') | translate) } }}
                </p>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="btn-primary" data-testid="respuesta-mostrar" (click)="mostrar(r.id, $event)">
                    <app-icon name="play" [size]="16" />
                    {{ 'ayuda.preg_mostrar' | translate }}
                  </button>
                  @if (r.pantalla; as p) {
                    <a class="btn-secondary" [routerLink]="p.path" data-testid="respuesta-ir">
                      {{ 'ayuda.preg_ir' | translate: { v0: (p.nav | translate) } }}
                    </a>
                  }
                  <a class="btn-secondary" [routerLink]="['/ayuda/guia', r.id]" data-testid="respuesta-guia">
                    <app-icon name="libro" [size]="16" />
                    {{ 'ayuda.preg_abrir' | translate }}
                  </a>
                </div>
              </article>
            } @else {
              <article class="rounded-hoja border border-dashed border-borde-control p-5" data-testid="sin-respuesta">
                <p class="flex items-center gap-1.5 text-base font-bold text-tinta">
                  <app-icon name="info" [size]="18" />
                  {{ 'ayuda.preg_sin_titulo' | translate }}
                </p>
                <p class="mt-1 text-base text-tinta-suave">{{ 'ayuda.preg_sin_texto' | translate }}</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  @if (puedeDocChat()) {
                    <a class="btn-secondary" routerLink="/chat" data-testid="sin-respuesta-docchat">
                      <app-icon name="chat" [size]="16" />
                      {{ 'ayuda.preg_docchat' | translate }}
                    </a>
                  }
                  <button type="button" class="btn-secondary" data-testid="sin-respuesta-admin" [attr.aria-expanded]="adminVisible().includes($index)" (click)="alternarAdmin($index)">
                    <app-icon name="usuarios" [size]="16" />
                    {{ 'ayuda.preg_admin' | translate }}
                  </button>
                </div>
                @if (adminVisible().includes($index)) {
                  <p class="mt-3 rounded-control border-l-4 border-accion bg-accion-suave px-3 py-2 text-sm text-tinta" role="status" data-testid="sin-respuesta-admin-texto">
                    {{ 'ayuda.preg_admin_texto' | translate }}
                  </p>
                }
              </article>
            }
          </li>
        }
      </ol>

      <p class="flex items-start gap-2 rounded-hoja border border-dashed border-borde p-3 text-sm text-tinta-suave">
        <app-icon name="info" [size]="18" class="mt-0.5 shrink-0" />
        {{ 'ayuda.preg_nota' | translate }}
      </p>

      <form class="flex items-center gap-2" (submit)="$event.preventDefault(); enviar()">
        <label for="preguntar-entrada" class="sr-only">{{ 'ayuda.preguntale_label' | translate }}</label>
        <input
          id="preguntar-entrada"
          type="search"
          class="fld-input flex-1"
          autocomplete="off"
          data-testid="preguntar-entrada"
          [value]="entrada()"
          [attr.placeholder]="'ayuda.preg_otra' | translate"
          (input)="entrada.set($any($event.target).value)" />
        <button type="submit" class="btn-primary" data-testid="preguntar-enviar">{{ 'ayuda.preg_enviar' | translate }}</button>
      </form>
    </section>
  `,
})
export class AyudaPreguntarComponent {
  private readonly ayuda = inject(AyudaService);
  private readonly recorridos = inject(RecorridosService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);

  protected readonly claveRecorrido = claveRecorrido;

  protected readonly preguntas = signal<string[]>([]);
  protected readonly entrada = signal('');
  protected readonly adminVisible = signal<number[]>([]);

  /** DocChat solo se ofrece si el perfil tiene acceso (el superusuario no). Navega a `/chat` sin enviar nada. */
  protected readonly puedeDocChat = computed(() => this.ayuda.cumple({ ruta: 'docchat' }));

  /** Cada pregunta con su respuesta; se recalcula al cambiar la pregunta, el perfil o el idioma. */
  protected readonly conversacion = computed(() => {
    const guias = this.ayuda.guias();
    const idioma = this.i18n.lang();
    return this.preguntas().map((pregunta) => {
      const hallada = buscarGuia(pregunta, guias, idioma);
      const def = hallada ? this.ayuda.recorrido(hallada.guia.id) : null;
      const respuesta: RespuestaVista | null = def
        ? { id: def.id, pasos: def.pasos.map((_, i) => i + 1), pantalla: this.ayuda.pantalla(def.pantalla) }
        : null;
      return { pregunta, respuesta };
    });
  });

  constructor() {
    const inicial = this.route.snapshot.queryParamMap.get('q')?.trim();
    if (inicial) this.preguntas.set([inicial]);
  }

  protected enviar(): void {
    const q = this.entrada().trim();
    if (!q) return;
    this.preguntas.update((lista) => [...lista, q]);
    this.entrada.set('');
  }

  protected mostrar(id: string, evento: Event): void {
    this.recorridos.iniciar(id, evento.currentTarget as HTMLElement);
  }

  protected alternarAdmin(indice: number): void {
    this.adminVisible.update((lista) => (lista.includes(indice) ? lista.filter((i) => i !== indice) : [...lista, indice]));
  }
}
