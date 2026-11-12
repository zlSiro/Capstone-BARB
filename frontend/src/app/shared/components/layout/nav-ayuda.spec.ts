import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { ROLES, RUTAS } from '../../../core/permissions/permissions';
import { AuthService } from '../../../core/services/auth.service';
import { AvisosPendientes } from '../../../core/services/avisos-pendientes';
import { BottomNav } from './bottom-nav/bottom-nav';
import { NAV_ITEMS, esAyuda } from './nav-items';
import { SidebarComponent } from './sidebar/sidebar.component';

@Component({ template: '' })
class Vacio {}

const RUTAS_APP = ['avisos', 'work-orders', 'dashboard', 'topology', 'chat', 'documentos', 'empresas', 'transacciones', 'transacciones-empresa', 'usuarios', 'ayuda'];

function montar<T>(tipo: new () => T, role: string) {
  TestBed.configureTestingModule({
    imports: [tipo as never],
    providers: [
      provideRouter(RUTAS_APP.map((path) => ({ path, component: Vacio }))),
      { provide: AuthService, useValue: { user: signal({ role, name: 'Ana' }), logout: vi.fn() } },
      { provide: AvisosPendientes, useValue: { total: () => 0 } },
    ],
  });
  const fixture = TestBed.createComponent(tipo);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const textos = (nodos: NodeListOf<Element>) => Array.from(nodos).map((n) => n.textContent!.replace(/\s+/g, ' ').trim());

/** Ítems que el menú ya mostraba antes de agregar Ayuda, según la matriz: sirve para comprobar que el filtro no cambió. */
const itemsDeLaMatriz = (role: string) =>
  NAV_ITEMS.filter((i) => i.ruta && (RUTAS[i.ruta]?.[role] === true || RUTAS[i.ruta]?.[role] === 'ver')).map((i) => i.path);

describe('Pestaña «Ayuda» en la navegación', () => {
  it('es un ítem sin ruta de la matriz, con ícono propio y al final de la prioridad', () => {
    const ayuda = NAV_ITEMS.find(esAyuda)!;
    expect(ayuda).toBeDefined();
    expect(ayuda.ruta).toBeUndefined();
    expect(ayuda.path).toBe('/ayuda');
    expect(ayuda.icon).toBe('ayuda');
    expect(ayuda.prioridad).toBeGreaterThan(Math.max(...NAV_ITEMS.filter((i) => !esAyuda(i)).map((i) => i.prioridad)));
  });

  describe('menú lateral', () => {
    it.each(ROLES)('%s: «Ayuda» aparece, al final y separada del resto', (role) => {
      const { el } = montar(SidebarComponent, role);
      const enlaces = Array.from(el.querySelectorAll('nav a'));
      const ultimo = enlaces[enlaces.length - 1];
      expect(ultimo.getAttribute('href')).toBe('/ayuda');
      // Separada: va dentro de su propio contenedor con borde superior, empujado al fondo.
      const contenedor = el.querySelector('[data-testid="nav-ayuda"]')!;
      expect(contenedor.contains(ultimo)).toBe(true);
      expect(contenedor.className).toContain('border-t');
      expect(contenedor.className).toContain('mt-auto');
      expect(enlaces.filter((a) => a.getAttribute('href') === '/ayuda')).toHaveLength(1);
    });

    it.each(ROLES)('%s: el nombre está en el title (riel de tablet) y en texto para lectores de pantalla', (role) => {
      const { el } = montar(SidebarComponent, role);
      const enlace = el.querySelector('[data-testid="nav-ayuda"] a')!;
      expect(enlace.getAttribute('title')).toBe('Ayuda');
      expect(enlace.querySelector('.sr-only')!.textContent!.trim()).toBe('Ayuda');
    });

    it.each(ROLES)('%s: el resto de los ítems se sigue filtrando por la matriz', (role) => {
      const { el } = montar(SidebarComponent, role);
      const rutas = Array.from(el.querySelectorAll('nav a'))
        .map((a) => a.getAttribute('href'))
        .filter((h) => h !== '/ayuda');
      expect(rutas).toEqual(itemsDeLaMatriz(role));
    });
  });

  describe('celular (barra inferior y «Más»)', () => {
    it.each(ROLES)('%s: «Ayuda» nunca es un destino principal de la barra', (role) => {
      const { el } = montar(BottomNav, role);
      const principales = Array.from(el.querySelectorAll('nav a')).map((a) => a.getAttribute('href'));
      expect(principales).not.toContain('/ayuda');
      expect(principales.length).toBeLessThanOrEqual(4);
    });

    it.each(ROLES)('%s: «Ayuda» está en el menú «Más», al final', async (role) => {
      const { fixture, el } = montar(BottomNav, role);
      el.querySelector<HTMLButtonElement>('[data-testid="btn-mas"]')!.click();
      fixture.detectChanges();
      const enlaces = Array.from(el.querySelectorAll('app-modal nav a'));
      expect(enlaces.length).toBeGreaterThan(0);
      expect(enlaces[enlaces.length - 1].getAttribute('href')).toBe('/ayuda');
      expect(textos(el.querySelectorAll('app-modal nav a')).at(-1)).toContain('Ayuda');
    });

    it.each(ROLES)('%s: los destinos que no son Ayuda siguen la matriz', (role) => {
      const { fixture, el } = montar(BottomNav, role);
      el.querySelector<HTMLButtonElement>('[data-testid="btn-mas"]')!.click();
      fixture.detectChanges();
      // Barra + «Más» (el diálogo vive dentro del componente): enlaces únicos, sin Ayuda.
      const todos = new Set(Array.from(el.querySelectorAll('a')).map((e) => e.getAttribute('href')));
      todos.delete('/ayuda');
      expect([...todos].sort()).toEqual(itemsDeLaMatriz(role).sort());
    });
  });
});
