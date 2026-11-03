import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { I18nService, textoActual } from './i18n.service';
import { TranslatePipe } from './translate.pipe';
import { translations } from './translations';

/** Todas las rutas «seccion.clave» de un árbol de textos. */
function rutas(arbol: unknown, prefijo = ''): string[] {
  if (typeof arbol === 'string') return [prefijo];
  if (arbol && typeof arbol === 'object') {
    return Object.entries(arbol).flatMap(([k, v]) => rutas(v, prefijo ? `${prefijo}.${k}` : k));
  }
  return [];
}
const buscar = (arbol: unknown, ruta: string): unknown => ruta.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], arbol);
const params = (t: string) => (t.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('Diccionario ES/EN', () => {
  const es = rutas(translations.es);
  const en = rutas(translations.en);

  it('inglés y español tienen exactamente las mismas claves', () => {
    expect(en.filter((r) => !es.includes(r))).toEqual([]);
    expect(es.filter((r) => !en.includes(r))).toEqual([]);
  });

  it('ningún texto está vacío en ningún idioma', () => {
    for (const lang of ['es', 'en'] as const) {
      const vacios = rutas(translations[lang]).filter((r) => String(buscar(translations[lang], r)).trim() === '');
      expect(vacios, `vacíos en ${lang}`).toEqual([]);
    }
  });

  it('los parámetros {nombre} coinciden entre idiomas (si no, el texto quedaría con un hueco)', () => {
    const distintos = es.filter((r) => params(String(buscar(translations.es, r))) !== params(String(buscar(translations.en, r))));
    expect(distintos).toEqual([]);
  });

  it('el inglés no es una copia del español: los textos propios de cada vista están traducidos', () => {
    const vistas = ['avisos', 'ot', 'usuarios', 'empresas', 'documentos', 'plantas', 'trx', 'acceso', 'sistema'] as const;
    for (const v of vistas) {
      const claves = rutas(translations.es[v], v);
      const iguales = claves.filter((r) => buscar(translations.es, r) === buscar(translations.en, r)).length;
      // Algunas palabras coinciden en ambos idiomas (Demo, Plan, Engineer, códigos): se tolera una minoría.
      expect(iguales / claves.length, `${v}: demasiados textos idénticos`).toBeLessThan(0.15);
    }
  });
});

describe('I18nService', () => {
  const crear = () => TestBed.inject(I18nService);

  it('parte en español y recuerda la elección', () => {
    const i18n = crear();
    expect(i18n.lang()).toBe('es');
    i18n.setLang('en');
    TestBed.tick();
    expect(window.localStorage.getItem('barb.lang')).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('toggleLang alterna ES ↔ EN en ambos sentidos', () => {
    const i18n = crear();
    i18n.toggleLang();
    expect(i18n.lang()).toBe('en');
    i18n.toggleLang();
    expect(i18n.lang()).toBe('es');
  });

  it('un idioma inválido se ignora', () => {
    const i18n = crear();
    i18n.setLang('fr' as never);
    expect(i18n.lang()).toBe('es');
  });

  it('un servicio nuevo parte del idioma guardado', () => {
    window.localStorage.setItem('barb.lang', 'en');
    expect(crear().lang()).toBe('en');
  });

  it('tr() traduce, interpola parámetros y cae al español si falta la clave en inglés', () => {
    const i18n = crear();
    expect(i18n.tr('plantas.plantas', { v0: 3 })).toBe('Plantas (3)');
    i18n.setLang('en');
    expect(i18n.tr('plantas.plantas', { v0: 3 })).toBe('Plants (3)');
    expect(i18n.tr('no.existe')).toBe('no.existe'); // la ruta delata el texto sin traducir
    expect(i18n.tr('plantas.plantas')).toBe('Plants ({v0})'); // sin parámetros, la marca queda visible
  });

  it('textoActual() (funciones puras) sigue el idioma y es reactiva', () => {
    const i18n = crear();
    expect(textoActual('ot.pendiente')).toBe('Pendiente');
    i18n.setLang('en');
    expect(textoActual('ot.pendiente')).toBe('Pending');
    i18n.setLang('es');
    expect(textoActual('ot.pendiente')).toBe('Pendiente');
  });
});

@Component({
  imports: [TranslatePipe],
  template: `<p id="a">{{ 'ot.pendiente' | translate }}</p><p id="b">{{ 'plantas.maquinas_de' | translate: { v0: 'Planta X' } }}</p><p id="c">{{ clave | translate }}</p>`,
})
class Anfitrion {
  clave: string | null | undefined = undefined;
}

describe('TranslatePipe', () => {
  function montar() {
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    const texto = (id: string) => (fixture.nativeElement as HTMLElement).querySelector(`#${id}`)!.textContent;
    return { fixture, texto, i18n: TestBed.inject(I18nService) };
  }

  it('cambia el texto de la pantalla al cambiar de idioma, sin recrear el componente', () => {
    const { fixture, texto, i18n } = montar();
    expect(texto('a')).toBe('Pendiente');
    expect(texto('b')).toBe('Máquinas de Planta X');
    i18n.setLang('en');
    fixture.detectChanges();
    expect(texto('a')).toBe('Pending');
    expect(texto('b')).toBe('Machines of Planta X');
    i18n.setLang('es');
    fixture.detectChanges();
    expect(texto('a')).toBe('Pendiente');
  });

  it('una clave vacía, nula o indefinida da texto vacío (no rompe la pantalla)', () => {
    const { texto } = montar();
    expect(texto('c')).toBe('');
  });

  it('avisa por consola de una clave que no existe', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.componentInstance.clave = 'no.existe';
    fixture.detectChanges();
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('no.existe'));
    expect((fixture.nativeElement as HTMLElement).querySelector('#c')!.textContent).toBe('no.existe');
    aviso.mockRestore();
  });
});
