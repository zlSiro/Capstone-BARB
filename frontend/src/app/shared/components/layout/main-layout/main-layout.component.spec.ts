import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../../../core/services/auth.service';
import { MainLayoutComponent } from './main-layout.component';

/** Layout principal con un AuthService falso: solo importa el estado de «privilegios pendientes». */
function montar(pendiente: boolean, role = 'supervisor') {
  const privilegiosPendientes = signal(pendiente);
  const aceptarPrivilegios = vi.fn(() => privilegiosPendientes.set(false));
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: AuthService,
        useValue: {
          user: signal({ id: 1, name: 'Ana', role, empresa_nombre: 'Planta' }),
          privilegiosPendientes,
          aceptarPrivilegios,
          isLoggedIn: () => true,
          logout: vi.fn(),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(MainLayoutComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, aceptarPrivilegios };
}

const dialogo = (el: HTMLElement) => el.querySelector('app-privilegios-modal [role="dialog"]');

describe('MainLayoutComponent — aviso de privilegios', () => {
  it('con la confirmación pendiente muestra el modal junto con la aplicación', () => {
    const { el } = montar(true);
    expect(dialogo(el)).not.toBeNull();
    expect(el.querySelector('app-header')).not.toBeNull(); // la herramienta se levanta, pero detrás del modal
  });

  it('sin confirmación pendiente no muestra el modal', () => {
    expect(dialogo(montar(false).el)).toBeNull();
  });

  it('al pulsar el botón el modal desaparece y se confirma una sola vez', () => {
    const { fixture, el, aceptarPrivilegios } = montar(true);
    (el.querySelector('[data-testid="privilegios-aceptar"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(aceptarPrivilegios).toHaveBeenCalledTimes(1);
    expect(dialogo(el)).toBeNull();
  });

  it('ESC no lo quita: solo el botón', () => {
    const { fixture, el, aceptarPrivilegios } = montar(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(aceptarPrivilegios).not.toHaveBeenCalled();
    expect(dialogo(el)).not.toBeNull();
  });
});
