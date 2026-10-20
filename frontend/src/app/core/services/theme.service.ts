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

  /**
   * Tema inicial.
   *
   * Si el usuario ya eligio, se respeta su eleccion guardada. Si es la primera visita,
   * se arranca con el tema del sistema, que es lo que hacia Tailwind antes de que el
   * modo oscuro pasara a ser por clase: asi nadie ve un cambio inesperado la primera vez.
   */
  private loadStoredDark(): boolean {
    if (typeof window === 'undefined') return false;
    const guardado = window.localStorage.getItem(DARK_STORAGE_KEY);
    if (guardado === 'true') return true;
    if (guardado === 'false') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
}
