import { Component, computed, input } from '@angular/core';

import { OtRealtimeState } from '../../../../core/services/ot-realtime.service';

import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
@Component({
  imports: [TranslatePipe],
  selector: 'app-ot-live-indicator',
  template: `
    <span
      role="status"
      aria-live="polite"
      class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium"
      [class]="state() === 'connected' ? 'bg-ok-suave text-ok' : 'bg-media-suave text-media'">
      <span
        aria-hidden="true"
        class="h-2 w-2 rounded-full"
        [class]="state() === 'connected' ? 'bg-ok' : state() === 'reconnecting' ? 'animate-pulse bg-media' : 'bg-media'"></span>
      {{ label() | translate }}
      @if (simulated()) {
        <span class="font-normal">{{ 'ot.simulado' | translate }}</span>
      }
    </span>
  `,
})
export class OtLiveIndicatorComponent {
  readonly state = input.required<OtRealtimeState>();
  /** Solo la demo con cambios falsos se rotula «(simulado)»; el canal real no. */
  readonly simulated = input(false);

  protected readonly label = computed(() =>
    this.state() === 'connected' ? 'ot.en_vivo' : this.state() === 'reconnecting' ? 'ot.reconectando' : 'ot.sin_conexion_en_vivo',
  );
}
