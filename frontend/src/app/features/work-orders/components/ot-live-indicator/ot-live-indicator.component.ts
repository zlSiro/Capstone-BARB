import { Component, input } from '@angular/core';

import { LiveConnectionState } from '../../../../core/services/ot-live-simulator.service';

@Component({
  selector: 'app-ot-live-indicator',
  template: `
    <span
      role="status"
      aria-live="polite"
      class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
      [class]="state() === 'connected' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'">
      <span
        aria-hidden="true"
        class="h-2 w-2 rounded-full"
        [class]="state() === 'connected' ? 'bg-green-600' : 'animate-pulse bg-amber-600'"></span>
      {{ state() === 'connected' ? 'En vivo' : 'Reconectando…' }}
      <span class="font-normal">(simulado)</span>
    </span>
  `,
})
export class OtLiveIndicatorComponent {
  readonly state = input.required<LiveConnectionState>();
}
