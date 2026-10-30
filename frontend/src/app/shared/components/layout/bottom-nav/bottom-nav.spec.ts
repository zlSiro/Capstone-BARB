import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../../../core/services/auth.service';
import { AvisosPendientes } from '../../../../core/services/avisos-pendientes';
import { ReportarFallaUi } from '../../../../core/services/reportar-falla-ui';
import { BottomNav } from './bottom-nav';

@Component({ template: '' })
class Vacio {}

const RUTAS = ['avisos', 'work-orders', 'dashboard', 'topology', 'chat', 'documentos', 'empresas', 'transacciones', 'usuarios'];

function montar(role: string, pendientes = 0) {
  const logout = vi.fn();
  TestBed.configureTestingModule({
    imports: [BottomNav],
    providers: [
      provideRouter(RUTAS.map((path) => ({ path, component: Vacio }))),
      { provide: AuthService, useValue: { user: signal({ role, name: 'Ana' }), logout } },
      { provide: AvisosPendientes, useValue: { total: () => pendientes } },
    ],
  });
  const fixture = TestBed.createComponent(BottomNav);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, logout, ui: TestBed.inject(ReportarFallaUi) };
}

const etiquetas = (el: HTMLElement) => Array.from(el.querySelectorAll('nav a')).map((a) => a.textContent!.trim());

describe('BottomNav (móvil)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('operador: 3 destinos, «Reportar falla» al centro y «Más»', () => {
    const { el } = montar('operador');
    expect(etiquetas(el)).toHaveLength(3);
    expect(el.querySelector('[data-testid="btn-reportar-nav"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="btn-mas"]')).not.toBeNull();
    const hijos = Array.from(el.querySelectorAll('ul > li'));
    const posicion = hijos.findIndex((li) => li.querySelector('[data-testid="btn-reportar-nav"]'));
    expect(posicion).toBeGreaterThan(0);
    expect(posicion).toBeLessThan(hijos.length - 1);
  });

  it('el botón central abre el diálogo de reporte desde cualquier pantalla', () => {
    const { el, ui } = montar('tecnico');
    el.querySelector<HTMLButtonElement>('[data-testid="btn-reportar-nav"]')!.click();
    expect(ui.abierto()).toBe(true);
  });

  it('admin no puede reportar: no hay botón central y se muestran 4 destinos', () => {
    const { el } = montar('admin');
    expect(el.querySelector('[data-testid="btn-reportar-nav"]')).toBeNull();
    expect(etiquetas(el)).toHaveLength(4);
  });

  it('super_usuario solo ve sus pantallas', () => {
    const { el } = montar('super_usuario');
    const texto = etiquetas(el).join(' ');
    expect(texto).toContain('Empresas');
    expect(texto).not.toContain('Avisos');
  });

  it('el supervisor ve el contador de avisos pendientes; el operador no', () => {
    expect(montar('supervisor', 3).el.querySelector('[aria-label*="avisos pendientes"]')?.textContent).toContain('3');
    TestBed.resetTestingModule();
    expect(montar('operador', 3).el.querySelector('[aria-label*="avisos pendientes"]')).toBeNull();
  });

  it('«Más» abre el menú con tema, idioma y salir; salir pide confirmación', () => {
    const { fixture, el, logout } = montar('operador');
    el.querySelector<HTMLButtonElement>('[data-testid="btn-mas"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    el.querySelector<HTMLButtonElement>('[data-testid="btn-salir-menu"]')!.click();
    expect(confirmar).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();
    confirmar.mockReturnValue(true);
    el.querySelector<HTMLButtonElement>('[data-testid="btn-salir-menu"]')!.click();
    expect(logout).toHaveBeenCalledOnce();
  });
});
