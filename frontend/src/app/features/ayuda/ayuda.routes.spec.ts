import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it, vi } from 'vitest';

import { routes } from '../../app.routes';
import { ROLES } from '../../core/permissions/permissions';
import { AuthService } from '../../core/services/auth.service';

function montar(role: string | null) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter(routes),
      {
        provide: AuthService,
        useValue: {
          user: signal(role ? { id: 1, name: 'Ana', role, empresa_nombre: 'Planta' } : null),
          privilegiosPendientes: signal(false),
          aceptarPrivilegios: vi.fn(),
          isLoggedIn: () => role !== null,
          getToken: () => (role ? 'tok' : null),
          logout: vi.fn(),
        },
      },
    ],
  });
  return RouterTestingHarness.create();
}

describe('Ruta /ayuda', () => {
  it.each(ROLES)('%s: con sesión iniciada abre la ayuda (sin roleGuard)', async (role) => {
    const harness = await montar(role);
    await harness.navigateByUrl('/ayuda');
    expect(TestBed.inject(Router).url).toBe('/ayuda');
    expect(harness.routeNativeElement?.querySelector('app-ayuda')).not.toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('Aprende BARB');
  });

  it.each(ROLES)('%s: también abre «Pregúntale a la ayuda» y una guía', async (role) => {
    const harness = await montar(role);
    await harness.navigateByUrl('/ayuda/preguntar?q=hola');
    expect(TestBed.inject(Router).url).toBe('/ayuda/preguntar?q=hola');
    expect(harness.routeNativeElement?.querySelector('app-ayuda-preguntar')).not.toBeNull();
    await harness.navigateByUrl('/ayuda/guia/ver_ot');
    expect(TestBed.inject(Router).url).toBe('/ayuda/guia/ver_ot');
    expect(harness.routeNativeElement?.querySelector('app-ayuda-guia')).not.toBeNull();
  });

  it.each(['/ayuda', '/ayuda/preguntar', '/ayuda/guia/ver_ot'])('sin sesión %s redirige al login', async (ruta) => {
    const harness = await montar(null);
    await harness.navigateByUrl(ruta);
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('la ruta de ayuda no declara guardas de rol: solo hereda el authGuard del layout', () => {
    const layout = routes.find((r) => r.path === '' && r.children)!;
    expect(layout.canActivate?.length).toBe(1); // authGuard
    for (const path of ['ayuda', 'ayuda/preguntar', 'ayuda/guia/:id']) {
      const ruta = layout.children!.find((r) => r.path === path)!;
      expect(ruta, path).toBeDefined();
      expect(ruta.canActivate, path).toBeUndefined();
    }
  });
});
