import { Component, input, output } from '@angular/core';

import { Aviso } from '../../core/models';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { FotoAviso } from './foto-aviso';

/** Visor de la foto que adjuntó quien reportó la falla. */
@Component({
  selector: 'app-ver-foto-aviso',
  imports: [ModalComponent, FotoAviso],
  template: `
    <app-modal title="Foto de la falla" [subtitle]="aviso().numero_aviso + ', ' + aviso().machine_name" size="lg" (closed)="closed.emit()">
      <app-foto-aviso [aviso]="aviso()" />
    </app-modal>
  `,
})
export class VerFotoAviso {
  readonly aviso = input.required<Aviso>();
  readonly closed = output<void>();
}
