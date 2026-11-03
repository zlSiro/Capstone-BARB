import { Injectable, signal, computed, effect } from '@angular/core';
import { translations, AppLang, TranslationTree } from './translations';

const LANG_STORAGE_KEY = 'barb.lang';
const DEFAULT_LANG: AppLang = 'es';

export type ParamsTexto = Record<string, string | number | null | undefined>;

function idiomaGuardado(): AppLang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  return stored === 'en' || stored === 'es' ? stored : DEFAULT_LANG;
}

/**
 * Idioma actual, compartido por todo el programa. Es una señal a propósito: así `textoActual()` (que se usa en
 * funciones puras sin inyección, como las etiquetas de estado) también es reactiva, y una plantilla que la llame
 * se vuelve a pintar sola al cambiar de idioma.
 */
const idioma = signal<AppLang>(idiomaGuardado());

@Injectable({ providedIn: 'root' })
export class I18nService {
  private _lang = idioma;

  readonly lang = this._lang.asReadonly();
  readonly tree = computed<TranslationTree>(() => translations[this._lang()]);

  constructor() {
    // Se vuelve a leer lo guardado: la señal es única en el programa y un servicio nuevo (otra sesión de pruebas) debe partir de lo elegido.
    idioma.set(idiomaGuardado());
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

  /**
   * Texto de la interfaz por ruta «seccion.clave» en el idioma actual, con parámetros `{nombre}`.
   *
   * Lee la señal `tree()`, así que una plantilla o un `computed` que lo use se actualiza solo al cambiar de idioma.
   * Si la clave no existe en el idioma actual cae al español (y, en último caso, devuelve la propia ruta): un
   * texto sin traducir se nota, pero nunca deja la pantalla en blanco.
   */
  tr(path: string, params?: ParamsTexto): string {
    const texto = this.buscar(this.tree(), path) ?? this.buscar(translations.es, path) ?? path;
    if (!params) return texto;
    return texto.replace(/\{(\w+)\}/g, (marca, nombre: string) => {
      const valor = params[nombre];
      return valor === null || valor === undefined ? marca : String(valor);
    });
  }

  /** ¿Existe la clave en el idioma actual? (la usa el pipe para avisar de claves faltantes). */
  has(path: string): boolean {
    return this.buscar(this.tree(), path) !== undefined;
  }

  private buscar(arbol: unknown, path: string): string | undefined {
    let actual: unknown = arbol;
    for (const parte of path.split('.')) {
      if (actual === null || typeof actual !== 'object') return undefined;
      actual = (actual as Record<string, unknown>)[parte];
    }
    return typeof actual === 'string' ? actual : undefined;
  }

}

/**
 * Traduce fuera de un componente o servicio (funciones puras como `apiErrorMessage` o las etiquetas de estado, donde no
 * hay inyección). Lee la señal del idioma, así que dentro de una plantilla o un `computed` es reactiva.
 */
export function textoActual(path: string, params?: ParamsTexto): string {
  const lang = idioma();
  const buscar = (arbol: unknown): string | undefined => {
    let actual: unknown = arbol;
    for (const parte of path.split('.')) {
      if (actual === null || typeof actual !== 'object') return undefined;
      actual = (actual as Record<string, unknown>)[parte];
    }
    return typeof actual === 'string' ? actual : undefined;
  };
  const texto = buscar(translations[lang]) ?? buscar(translations.es) ?? path;
  return params ? texto.replace(/\{(\w+)\}/g, (marca, nombre: string) => (params[nombre] == null ? marca : String(params[nombre]))) : texto;
}

/** Solo para pruebas: vuelve al idioma por defecto (español) y borra la elección guardada, para que un test no herede el idioma de otro. */
export function reiniciarIdiomaParaPruebas(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(LANG_STORAGE_KEY);
  idioma.set(DEFAULT_LANG);
  if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', DEFAULT_LANG);
}
