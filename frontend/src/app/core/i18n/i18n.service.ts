import { Injectable, signal, computed, effect } from '@angular/core';
import { translations, AppLang, TranslationTree } from './translations';

const LANG_STORAGE_KEY = 'barb.lang';
const DEFAULT_LANG: AppLang = 'es';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private _lang = signal<AppLang>(this.loadStoredLang());

  readonly lang = this._lang.asReadonly();
  readonly tree = computed<TranslationTree>(() => translations[this._lang()]);

  constructor() {
    effect(() => {
      const currentLang = this._lang();
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LANG_STORAGE_KEY, currentLang);
        document.documentElement.setAttribute('lang', currentLang);
      }
    });
  }

  setLang(lang: AppLang): void {
    if (lang === 'es' || lang === 'en') {
      this._lang.set(lang);
    }
  }

  toggleLang(): void {
    this._lang.set(this._lang() === 'es' ? 'en' : 'es');
  }

  t<S extends keyof TranslationTree>(section: S): TranslationTree[S] {
    return this.tree()[section];
  }

  get<S extends keyof TranslationTree, K extends keyof TranslationTree[S]>(
    section: S,
    key: K
  ): TranslationTree[S][K] {
    return this.tree()[section][key];
  }

  private loadStoredLang(): AppLang {
    if (typeof window === 'undefined') return DEFAULT_LANG;
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    return stored === 'en' || stored === 'es' ? stored : DEFAULT_LANG;
  }
}
