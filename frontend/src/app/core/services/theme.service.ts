import { Injectable, signal, effect } from '@angular/core';

const DARK_STORAGE_KEY = 'barb.dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _dark = signal<boolean>(this.loadStoredDark());

  readonly dark = this._dark.asReadonly();

  constructor() {
    effect(() => {
      const isDark = this._dark();
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DARK_STORAGE_KEY, String(isDark));
        const root = document.documentElement;
        root.classList.toggle('dark', isDark);
        root.classList.toggle('light', !isDark);
      }
    });
  }

  toggle(): void {
    this._dark.update(v => !v);
  }

  set(value: boolean): void {
    this._dark.set(value);
  }

  private loadStoredDark(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DARK_STORAGE_KEY) === 'true';
  }
}
