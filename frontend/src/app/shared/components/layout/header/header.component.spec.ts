import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../../../core/services/auth.service';
import { HeaderComponent } from './header.component';

@Component({ template: '' })
class DummyComponent {}

async function setup(role: string, startUrl: string) {
  const logout = vi.fn();
  TestBed.configureTestingModule({
    imports: [HeaderComponent],
    providers: [
      provideRouter(
        ['empresas', 'usuarios', 'dashboard', 'topology', 'chat/history'].map((path) => ({ path, component: DummyComponent })),
      ),
      { provide: AuthService, useValue: { user: () => ({ role, name: 'T' }), logout } },
    ],
  });
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(HeaderComponent);
  await router.navigateByUrl(startUrl);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { router, fixture, el, logout, click: (id: string) => el.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click() };
}

const volver = (el: HTMLElement) => el.querySelector('[data-testid="btn-volver"]');

describe('HeaderComponent - Volver y Salir', () => {
  afterEach(() => vi.restoreAllMocks());

  it('"Volver" no aparece en la página de inicio del rol ni en vistas con salida propia', async () => {
    expect(volver((await setup('super_usuario', '/empresas')).el)).toBeNull();
    TestBed.resetTestingModule();
    expect(volver((await setup('admin', '/topology')).el)).toBeNull();
  });

  it('"Volver" aparece en las demás vistas y, sin historial interno, lleva al inicio del rol', async () => {
    const { router, fixture, el, click } = await setup('super_usuario', '/usuarios');
    expect(volver(el)).not.toBeNull();
    click('btn-volver');
    await fixture.whenStable();
    expect(router.url).toBe('/empresas');
  });

  it('"Salir" cierra la sesión solo si el usuario acepta', async () => {
    const { logout, click } = await setup('admin', '/usuarios');
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    click('btn-salir');
    expect(confirmar).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();

    confirmar.mockReturnValue(true);
    click('btn-salir');
    expect(logout).toHaveBeenCalledOnce();
  });
});
