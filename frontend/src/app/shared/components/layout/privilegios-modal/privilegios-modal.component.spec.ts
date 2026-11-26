import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { translations } from '../../../../core/i18n/translations';
import { AuthService } from '../../../../core/services/auth.service';
import { PRIVILEGIOS_POR_ROL, PrivilegiosModalComponent } from './privilegios-modal.component';

const ROLES = Object.keys(PRIVILEGIOS_POR_ROL);
const BOTON = 'Comprendo los privilegios de mi perfil de usuario';

function montar(role: string, lang: 'es' | 'en' = 'es') {
  window.localStorage.setItem('barb.lang', lang);
  const aceptarPrivilegios = vi.fn();
  TestBed.configureTestingModule({
    providers: [{ provide: AuthService, useValue: { user: signal({ id: 1, name: 'Ana', role }), aceptarPrivilegios } }],
  });
  const fixture = TestBed.createComponent(PrivilegiosModalComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, aceptarPrivilegios };
}

const items = (el: HTMLElement, lista: 'puede' | 'no') => el.querySelectorAll(`[data-testid="privilegios-${lista}"] li`);

describe('PrivilegiosModalComponent', () => {
  it.each(ROLES)('%s: muestra lo que puede y lo que no puede hacer', (rol) => {
    const { el } = montar(rol);
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    expect(items(el, 'puede')).toHaveLength(PRIVILEGIOS_POR_ROL[rol].puede);
    expect(items(el, 'no')).toHaveLength(PRIVILEGIOS_POR_ROL[rol].no);
    expect(el.textContent).toContain('Lo que puedes hacer');
    expect(el.textContent).toContain('Lo que no puedes hacer');
    // Ninguna clave de texto quedó sin traducir.
    expect(el.textContent).not.toMatch(/privilegios\.[a-z]/);
  });

  it.each([
    ['operador', ['Mi actividad', 'Trazabilidad de una OT']],
    ['tecnico', ['Mi actividad', 'Trazabilidad de una OT']],
    ['supervisor', ['Resumen ejecutivo del periodo', 'Backlog y OT atrasadas', 'Avisos de falla', 'Calidad de datos']],
    ['engineer', ['Resumen ejecutivo del periodo', 'Máquinas con peor confiabilidad', 'Mezcla de mantenimiento']],
    ['gerente', ['Resumen ejecutivo del periodo', 'Costos por máquina y desviación', 'Avisos de falla']],
    ['admin', ['Trazabilidad de una OT', 'Calidad de datos']],
  ])('%s: lista los reportes que puede extraer', (rol, titulos) => {
    const { el } = montar(rol);
    const lista = el.querySelector('[data-testid="privilegios-reportes"]')!;
    expect(lista).not.toBeNull();
    for (const t of titulos) expect(lista.textContent, `${rol}: ${t}`).toContain(t);
    expect(el.textContent).toContain('Reportes que puedes extraer');
    expect(el.textContent).not.toMatch(/reportes\.r\d+_/);
  });

  it('cada perfil ve ni más ni menos reportes que su matriz permite', () => {
    const cuenta: Record<string, number> = { operador: 2, tecnico: 2, supervisor: 8, engineer: 6, gerente: 8, admin: 2 };
    for (const [rol, n] of Object.entries(cuenta)) {
      TestBed.resetTestingModule();
      const { el } = montar(rol);
      expect(el.querySelectorAll('[data-testid="privilegios-reportes"] li'), rol).toHaveLength(n);
    }
  });

  it('cada reporte va solo con su título: sin descripción adicional debajo', () => {
    const { el } = montar('supervisor');
    const lista = el.querySelector('[data-testid="privilegios-reportes"]')!;
    expect(lista.textContent).not.toContain('Las OT abiertas ahora');
    expect(lista.textContent).not.toContain('Cómo terminan los avisos');
    for (const li of Array.from(lista.querySelectorAll('li'))) expect(li.children.length).toBe(2); // viñeta + título
  });

  it('el superusuario no tiene reportes: la sección no aparece', () => {
    const { el } = montar('super_usuario');
    expect(el.querySelector('[data-testid="privilegios-reportes-seccion"]')).toBeNull();
    expect(el.textContent).not.toContain('Reportes que puedes extraer');
  });

  it('en inglés los reportes se muestran traducidos', () => {
    const { el } = montar('gerente', 'en');
    expect(el.textContent).toContain('Reports you can get');
    expect(el.textContent).toContain('Executive summary of the period');
    expect(el.textContent).not.toContain('Resumen ejecutivo');
  });

  it('el título nombra el perfil del usuario', () => {
    expect(montar('supervisor').el.querySelector('h2')!.textContent).toContain('Tus privilegios como Supervisor');
  });

  it('el superusuario ve su propio perfil', () => {
    expect(montar('super_usuario').el.querySelector('h2')!.textContent).toContain('Superusuario');
  });

  it('tiene el botón pedido y solo ese lo confirma', () => {
    const { el, aceptarPrivilegios } = montar('operador');
    const boton = el.querySelector('[data-testid="privilegios-aceptar"]') as HTMLButtonElement;
    expect(boton.textContent!.trim()).toBe(BOTON);
    expect(aceptarPrivilegios).not.toHaveBeenCalled();
    boton.click();
    expect(aceptarPrivilegios).toHaveBeenCalledTimes(1);
  });

  it('es obligatorio: sin X, y ni ESC ni el clic en el velo lo confirman', () => {
    const { fixture, el, aceptarPrivilegios } = montar('tecnico');
    expect(el.querySelector('button[aria-label="Cerrar"]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    (el.querySelector('.fixed.inset-0') as HTMLElement).click();
    fixture.detectChanges();
    expect(aceptarPrivilegios).not.toHaveBeenCalled();
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('en inglés se traduce completo', () => {
    const { el } = montar('gerente', 'en');
    expect(el.querySelector('h2')!.textContent).toContain('Your privileges as Manager');
    expect(el.textContent).toContain('What you can do');
    expect(el.querySelector('[data-testid="privilegios-aceptar"]')!.textContent!.trim()).toBe('I understand the privileges of my user profile');
    expect(el.textContent).not.toMatch(/privilegios\.[a-z]/);
  });

  it('un rol sin descripción no bloquea al usuario con un diálogo vacío', () => {
    const { el } = montar('rol_inventado');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('todas las claves de cada rol existen en español e inglés, y no sobra ninguna', () => {
    for (const lang of ['es', 'en'] as const) {
      const arbol = (translations as unknown as Record<string, Record<string, Record<string, string>>>)[lang]['privilegios'];
      for (const [rol, { puede, no }] of Object.entries(PRIVILEGIOS_POR_ROL)) {
        const usadas = new Set<string>([`rol_${rol}`]);
        for (let n = 1; n <= puede; n++) usadas.add(`${rol}_puede_${n}`);
        for (let n = 1; n <= no; n++) usadas.add(`${rol}_no_${n}`);
        for (const clave of usadas) expect(arbol[clave], `${lang} ${clave}`).toBeTruthy();
        for (const clave of Object.keys(arbol).filter((k) => k.startsWith(`${rol}_`))) expect(usadas.has(clave), `${lang} ${clave} sin usar`).toBe(true);
      }
    }
  });
});
