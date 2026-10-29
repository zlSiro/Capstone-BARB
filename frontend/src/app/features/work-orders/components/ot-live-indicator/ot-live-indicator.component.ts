import { Component, input } from '@angular/core';

import { LiveConnectionState } from '../../../../core/services/ot-live-simulator.service';

@Component({
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
        [class]="state() === 'connected' ? 'bg-ok' : 'animate-pulse bg-media'"></span>
      {{ state() === 'connected' ? 'En vivo' : 'Reconectando…' }}
      <span class="font-normal">(simulado)</span>
    </span>
  `,
})
export class OtLiveIndicatorComponent {
  readonly state = input.required<LiveConnectionState>();
}
