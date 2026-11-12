import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nService } from '../../core/i18n/i18n.service';
import { ROLES } from '../../core/permissions/permissions';
import { AuthService } from '../../core/services/auth.service';
import { RecorridoCapaComponent } from '../../shared/components/layout/recorrido-capa/recorrido-capa.component';
import { AyudaGuiaComponent } from './ayuda-guia.component';
import { AyudaPreguntarComponent } from './ayuda-preguntar.component';
import { AyudaComponent } from './ayuda.component';
import { AyudaService } from './ayuda.service';
import { RecorridosService } from './recorridos.service';

/**
 * Ninguna vista de la ayuda debe pedir una clave de texto que no exista: el `TranslatePipe` avisa con `console.warn`
 * («Clave no encontrada»). Se recorre toda la ayuda, con cada perfil y en los dos idiomas.
 */
function montar(role: string) {
  const router = { url: '/ayuda', navigateByUrl: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'ayuda', component: AyudaComponent },
        { path: 'ayuda/preguntar', component: AyudaPreguntarComponent },
        { path: 'ayuda/guia/:id', component: AyudaGuiaComponent },
      ]),
      { provide: AuthService, useValue: { user: signal({ id: 1, name: 'Ana', role }), privilegiosPendientes: signal(false) } },
    ],
  });
  return router;
}

const clavesFaltantes = (llamadas: unknown[][]): string[] => llamadas.map((c) => String(c[0])).filter((m) => m.includes('Clave no encontrada'));

describe('Ayuda: no faltan claves de texto en ninguna vista', () => {
  const llamadas: unknown[][] = [];
  beforeEach(() => {
    llamadas.length = 0;
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      llamadas.push(args);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(ROLES)('%s: inicio, respuestas y guías, en español e inglés', async (role) => {
    montar(role);
    const i18n = TestBed.inject(I18nService);
    const ayuda = TestBed.inject(AyudaService);
    // Un solo arnés por prueba: se navega entre las vistas de la ayuda.
    const harness = await RouterTestingHarness.create('/ayuda');
    for (const idioma of ['es', 'en'] as const) {
      i18n.setLang(idioma);
      const urls = [
        '/ayuda',
        '/ayuda/preguntar?q=' + encodeURIComponent('receta de cocina'),
        ...ayuda.recorridos().flatMap((guia) => [
          `/ayuda/guia/${guia.id}`,
          `/ayuda/preguntar?q=${encodeURIComponent(i18n.tr(`ayuda.r_${guia.id}_titulo`))}`,
        ]),
      ];
      for (const url of urls) {
        await harness.navigateByUrl(url);
        harness.detectChanges();
      }
    }
    expect(clavesFaltantes(llamadas)).toEqual([]);
  });

  it.each(ROLES)('%s: la burbuja de cada recorrido, en todos sus pasos y en los dos idiomas', async (role) => {
    vi.useFakeTimers();
    try {
      const router = montar(role);
      TestBed.overrideProvider(Router, { useValue: router });
      const fixture = TestBed.createComponent(RecorridoCapaComponent);
      const recorridos = TestBed.inject(RecorridosService);
      const i18n = TestBed.inject(I18nService);
      for (const idioma of ['es', 'en'] as const) {
        i18n.setLang(idioma);
        for (const guia of TestBed.inject(AyudaService).recorridos()) {
          recorridos.iniciar(guia.id);
          for (let paso = 0; paso < guia.pasos.length; paso++) {
            await vi.advanceTimersByTimeAsync(3_500);
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('[data-testid="recorrido-titulo"]')!.textContent.trim().length).toBeGreaterThan(0);
            recorridos.siguiente();
          }
          fixture.detectChanges();
        }
      }
      expect(clavesFaltantes(llamadas)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
