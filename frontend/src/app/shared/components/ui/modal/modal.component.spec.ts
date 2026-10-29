import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  template: `
    <app-modal title="Reportar una falla" subtitle="Ayuda" badge="AV-2026-0007" badgeLabel="Origen" (closed)="cerrado()">
      <input id="campo" />
      <div modal-footer><button id="principal" type="button">Enviar aviso</button></div>
    </app-modal>
  `,
})
class Anfitrion {
  cerrado = vi.fn();
}

@Component({ imports: [ModalComponent], template: `<app-modal title="Sin pie"><p>Contenido</p></app-modal>` })
class SinPie {}

function montar<T>(tipo: new () => T) {
  TestBed.configureTestingModule({ imports: [tipo as never] });
  const fixture = TestBed.createComponent(tipo);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('ModalComponent (hoja en móvil, diálogo en escritorio)', () => {
  it('es un diálogo accesible con título y botón de cierre', () => {
    const { el } = montar(Anfitrion);
    const dialogo = el.querySelector('[role="dialog"]')!;
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    const titulo = el.querySelector('h2')!;
    expect(dialogo.getAttribute('aria-labelledby')).toBe(titulo.id);
    expect(titulo.textContent).toContain('Reportar una falla');
    expect(el.querySelector('button[aria-label="Cerrar"]')).not.toBeNull();
  });

  it('el botón principal va en el pie fijo, fuera del área con scroll', () => {
    const { el } = montar(Anfitrion);
    const boton = el.querySelector('#principal')!;
    const contenido = el.querySelector('#campo')!;
    expect(boton.closest('.overflow-y-auto')).toBeNull();
    expect(contenido.closest('.overflow-y-auto')).not.toBeNull();
  });

  it('muestra la insignia de origen en la esquina, junto al botón de cierre', () => {
    const { el } = montar(Anfitrion);
    const insignia = el.querySelector('[data-testid="modal-badge"]')!;
    expect(insignia.textContent).toContain('AV-2026-0007');
    expect(insignia.parentElement!.querySelector('button[aria-label="Cerrar"]')).not.toBeNull();
  });

  it('cierra con ESC y con el botón', () => {
    const { fixture, el } = montar(Anfitrion);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    el.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click();
    expect(fixture.componentInstance.cerrado).toHaveBeenCalledTimes(2);
  });

  it('bloquea el scroll de la página mientras está abierto y lo libera al cerrarse', () => {
    const { fixture } = montar(Anfitrion);
    expect(document.body.style.overflow).toBe('hidden');
    fixture.destroy();
    expect(document.body.style.overflow).toBe('');
  });

  it('sin contenido de pie, el pie queda vacío (se oculta con CSS)', () => {
    const { el } = montar(SinPie);
    const pie = Array.from(el.querySelectorAll('div')).find((d) => d.className.includes('empty:hidden'))!;
    expect(pie.children.length).toBe(0);
  });
});
