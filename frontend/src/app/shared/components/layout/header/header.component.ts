import { Component, inject } from '@angular/core';
import { AuthService } from '../../../../core/services/auth.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between transition-colors">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🏭</span>
        <h1 class="text-lg font-bold text-gray-800 dark:text-gray-100">{{ 'login.title' | translate }}</h1>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-600 dark:text-gray-300">{{ auth.user()?.name }}</span>
        <span class="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 px-2 py-1 rounded">
          {{ auth.user()?.role }}
        </span>
        <button
          (click)="theme.toggle()"
          class="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
          title="Tema">
          {{ theme.dark() ? '☀️' : '🌙' }}
        </button>
        <button
          (click)="i18n.toggleLang()"
          class="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium">
          🌐 {{ i18n.lang() === 'es' ? 'ES' : 'EN' }}
        </button>
        <button (click)="auth.logout()" class="text-sm text-red-600 dark:text-red-400 hover:text-red-800">
          {{ 'topbar.logout' | translate }}
        </button>
      </div>
    </header>
  `
})
export class HeaderComponent {
  auth = inject(AuthService);
  i18n = inject(I18nService);
  theme = inject(ThemeService);
}
