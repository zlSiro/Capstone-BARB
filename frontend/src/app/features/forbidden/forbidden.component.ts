import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-forbidden',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-100">
      <div class="bg-white p-10 rounded-lg shadow-lg text-center max-w-md">
        <div class="text-6xl mb-4">🚫</div>
        <h1 class="text-2xl font-bold text-gray-800 mb-2">
          {{ 'common.forbiddenTitle' | translate }}
        </h1>
        <p class="text-sm text-gray-500 mb-6">
          {{ 'common.forbiddenMessage' | translate }}
        </p>
        <div class="flex gap-3 justify-center">
          <button
            (click)="goBack()"
            class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded text-sm font-medium">
            {{ 'common.back' | translate }}
          </button>
          <button
            (click)="goToMenu()"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium">
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
