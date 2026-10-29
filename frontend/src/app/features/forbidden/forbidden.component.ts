import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-forbidden',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-superficie-2">
      <div class="bg-superficie p-10 rounded-control shadow-lg text-center max-w-md">
        <div class="text-6xl mb-4">🚫</div>
        <h1 class="text-2xl font-bold text-tinta mb-2">
          {{ 'common.forbiddenTitle' | translate }}
        </h1>
        <p class="text-sm text-tinta-suave mb-6">
          {{ 'common.forbiddenMessage' | translate }}
        </p>
        <div class="flex gap-3 justify-center">
          <button
            (click)="goBack()"
            class="px-4 py-2 bg-borde hover:bg-borde text-tinta rounded-control text-sm font-medium">
            {{ 'common.back' | translate }}
          </button>
          <button
            (click)="goToMenu()"
            class="px-4 py-2 bg-accion hover:bg-accion-hover text-sobre-accion rounded-control text-sm font-medium">
            {{ 'common.backToMenu' | translate }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ForbiddenComponent {
  private router = inject(Router);
  private i18n = inject(I18nService);

  goBack() {
    window.history.back();
  }

  goToMenu() {
    this.router.navigate(['/menu']);
  }
}
