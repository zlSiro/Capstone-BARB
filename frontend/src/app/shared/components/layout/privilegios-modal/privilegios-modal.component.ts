import { Component, computed, inject } from '@angular/core';

import { I18nService } from '../../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { ModalComponent } from '../../ui/modal/modal.component';

/**
 * Cantidad de privilegios que describen los textos de cada rol (`privilegios.<rol>_puede_N` / `<rol>_no_N`).
 * Fuente: `matriz_rol.md`. Un spec comprueba que cada clave existe en español e inglés.
 */
export const PRIVILEGIOS_POR_ROL: Record<string, { puede: number; no: number }> = {
  operador: { puede: 3, no: 2 },
  tecnico: { puede: 4, no: 3 },
  supervisor: { puede: 6, no: 3 },
  engineer: { puede: 4, no: 2 },
  gerente: { puede: 5, no: 3 },
  admin: { puede: 5, no: 3 },
  super_usuario: { puede: 3, no: 2 },
};

const claves = (rol: string, tipo: 'puede' | 'no', cantidad: number): string[] =>
  Array.from({ length: cantidad }, (_, i) => `privilegios.${rol}_${tipo}_${i + 1}`);

/**
 * Aviso obligatorio tras un login correcto: explica qué puede y qué no puede hacer el perfil del usuario.
 * No se cierra con ESC, con el velo ni con una X: solo el botón «Comprendo los privilegios de mi perfil de usuario»
 * lo quita (queda guardado hasta que lo confirme, aunque recargue la página).
 */
@Component({
  selector: 'app-privilegios-modal',
  imports: [ModalComponent, TranslatePipe],
  template: `
    @if (contenido(); as c) {
      <app-modal
        [title]="titulo()"
        [subtitle]="'privilegios.subtitulo' | translate"
        [dismissible]="false"
        size="lg">
        <div class="flex flex-col gap-5" data-testid="privilegios">
          <section aria-labelledby="priv-puedes">
            <h3 id="priv-puedes" class="mb-2 text-base font-bold text-ok">{{ 'privilegios.puedes' | translate }}</h3>
            <ul class="flex flex-col gap-2" data-testid="privilegios-puede">
              @for (clave of c.puede; track clave) {
                <li class="flex gap-2 text-base">
                  <span aria-hidden="true" class="font-bold text-ok">✓</span>
                  <span>{{ clave | translate }}</span>
                </li>
              }
            </ul>
          </section>

          <section aria-labelledby="priv-no">
            <h3 id="priv-no" class="mb-2 text-base font-bold text-peligro">{{ 'privilegios.no_puedes' | translate }}</h3>
            <ul class="flex flex-col gap-2" data-testid="privilegios-no">
              @for (clave of c.no; track clave) {
                <li class="flex gap-2 text-base">
                  <span aria-hidden="true" class="font-bold text-peligro">✕</span>
                  <span>{{ clave | translate }}</span>
                </li>
              }
            </ul>
          </section>

          <p class="text-sm text-tinta-suave">{{ 'privilegios.aviso' | translate }}</p>
        </div>

        <div modal-footer class="flex justify-end">
          <button type="button" class="btn-primary w-full md:w-auto" data-testid="privilegios-aceptar" (click)="aceptar()">
            {{ 'privilegios.boton' | translate }}
          </button>
        </div>
      </app-modal>
    }
  `,
})
export class PrivilegiosModalComponent {
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);

  private readonly rol = computed(() => String(this.auth.user()?.role ?? ''));

  /** Claves de texto del rol; `null` si el rol no tiene descripción (el aviso no se muestra en vez de bloquear al usuario). */
  protected readonly contenido = computed(() => {
    const rol = this.rol();
    const cantidades = PRIVILEGIOS_POR_ROL[rol];
    if (!cantidades) return null;
    return { puede: claves(rol, 'puede', cantidades.puede), no: claves(rol, 'no', cantidades.no) };
  });

  protected readonly titulo = computed(() =>
    this.i18n.tr('privilegios.titulo', { v0: this.i18n.tr(`privilegios.rol_${this.rol()}`) }),
  );

  protected aceptar(): void {
    this.auth.aceptarPrivilegios();
  }
}
