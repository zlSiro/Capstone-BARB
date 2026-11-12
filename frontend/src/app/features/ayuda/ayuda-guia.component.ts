import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Icon } from '../../shared/components/ui/icon/icon';
import { claveRecorrido } from './ayuda-contenido';
import { AyudaService } from './ayuda.service';
import { RecorridosService } from './recorridos.service';

/** Una guía de «Aprende BARB» (`/ayuda/guia/:id`): su resumen y sus pasos, con acceso al recorrido y a la pantalla. */
@Component({
  selector: 'app-ayuda-guia',
  imports: [Icon, RouterLink, TranslatePipe],
  template: `
    <section class="flex max-w-3xl flex-col gap-4" aria-labelledby="guia-titulo">
      <a routerLink="/ayuda" class="inline-flex items-center gap-1 text-sm text-tinta-suave hover:underline" data-testid="guia-volver">
        <app-icon name="atras" [size]="16" />
        {{ 'ayuda.guia_volver' | translate }}
      </a>

      @if (guia(); as g) {
        <div>
          <h1 id="guia-titulo" class="text-3xl font-bold leading-tight text-tinta" data-testid="guia-titulo">{{ claveRecorrido(g.id, 'titulo') | translate }}</h1>
          <p class="mt-2 text-base text-tinta" data-testid="guia-resumen">{{ claveRecorrido(g.id, 'resumen') | translate }}</p>
        </div>
        <section class="panel p-5" aria-labelledby="guia-pasos">
          <h2 id="guia-pasos" class="mb-2 text-base font-bold text-tinta-suave">{{ 'ayuda.guia_pasos' | translate }}</h2>
          <ol class="flex list-decimal flex-col gap-2 pl-5 text-base text-tinta" data-testid="guia-pasos">
            @for (n of g.pasos; track n) {
              <li>
                <span class="font-semibold">{{ claveRecorrido(g.id, 'p' + n + '_titulo') | translate }}.</span>
                {{ claveRecorrido(g.id, 'p' + n + '_texto') | translate }}
              </li>
            }
          </ol>
        </section>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary" data-testid="guia-mostrar" (click)="mostrar(g.id, $event)">
            <app-icon name="play" [size]="16" />
            {{ 'ayuda.preg_mostrar' | translate }}
          </button>
          @if (g.pantalla; as p) {
            <a class="btn-secondary" [routerLink]="p.path" data-testid="guia-ir">{{ 'ayuda.preg_ir' | translate: { v0: (p.nav | translate) } }}</a>
          }
        </div>
      } @else {
        <p class="rounded-hoja border border-dashed border-borde-control p-5 text-base text-tinta-suave" role="status" data-testid="guia-no-existe">
          {{ 'ayuda.guia_no_existe' | translate }}
        </p>
      }
    </section>
  `,
})
export class AyudaGuiaComponent {
  private readonly ayuda = inject(AyudaService);
  private readonly recorridos = inject(RecorridosService);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap, { requireSync: false });

  protected readonly claveRecorrido = claveRecorrido;

  /** La guía pedida, solo si el perfil actual puede verla (si no, o si no existe, se avisa). */
  protected readonly guia = computed(() => {
    const id = this.params()?.get('id');
    const def = id ? this.ayuda.recorrido(id) : null;
    return def ? { id: def.id, pasos: def.pasos.map((_, i) => i + 1), pantalla: this.ayuda.pantalla(def.pantalla) } : null;
  });

  protected mostrar(id: string, evento: Event): void {
    this.recorridos.iniciar(id, evento.currentTarget as HTMLElement);
  }
}
