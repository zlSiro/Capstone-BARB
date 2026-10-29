import { Component, computed, input } from '@angular/core';

import { EstadoAviso } from '../../core/models';
import { Icon } from '../../shared/components/ui/icon/icon';
import { estadoMeta } from './etiquetas';

/** Estado de un aviso: ícono y texto (reloj, ficha con visto, círculo tachado), con color de refuerzo. */
@Component({
  selector: 'app-estado-aviso',
  imports: [Icon],
  template: `
    <span [class]="meta().chip">
      <app-icon [name]="meta().icono" [size]="16" />
      {{ meta().label }}
    </span>
  `,
})
export class EstadoAvisoChip {
  readonly estado = input.required<EstadoAviso>();

  protected readonly meta = computed(() => estadoMeta(this.estado()));
}
