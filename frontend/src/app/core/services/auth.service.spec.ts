import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth.service';

const RESPUESTA = { token: 'tok', user: { id: 1, name: 'Ana', role: 'supervisor' } };

function montar() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  return { auth: TestBed.inject(AuthService), http: TestBed.inject(HttpTestingController) };
}

function iniciarSesion(auth: AuthService, http: HttpTestingController) {
  auth.login('ana@x.cl', 'secreto').subscribe();
  http.expectOne((r) => r.url.endsWith('/auth/login')).flush(RESPUESTA);
}

describe('AuthService — aviso de privilegios tras el login', () => {
  beforeEach(() => localStorage.clear());

  it('sin sesión no hay nada pendiente', () => {
    expect(montar().auth.privilegiosPendientes()).toBe(false);
  });

  it('un login correcto deja pendiente la confirmación de privilegios', () => {
    const { auth, http } = montar();
    iniciarSesion(auth, http);
    expect(auth.privilegiosPendientes()).toBe(true);
  });

  it('un login fallido no deja nada pendiente', () => {
    const { auth, http } = montar();
    auth.login('ana@x.cl', 'mala').subscribe({ error: () => undefined });
    http.expectOne((r) => r.url.endsWith('/auth/login')).flush({ detail: 'no' }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.privilegiosPendientes()).toBe(false);
  });

  it('aceptarPrivilegios quita la marca', () => {
    const { auth, http } = montar();
    iniciarSesion(auth, http);
    auth.aceptarPrivilegios();
    expect(auth.privilegiosPendientes()).toBe(false);
  });

  it('si el usuario recarga la página sin confirmar, sigue pendiente', () => {
    const { auth, http } = montar();
    iniciarSesion(auth, http);
    TestBed.resetTestingModule();
    expect(montar().auth.privilegiosPendientes()).toBe(true);
  });

  it('si ya confirmó, recargar no lo vuelve a pedir', () => {
    const { auth, http } = montar();
    iniciarSesion(auth, http);
    auth.aceptarPrivilegios();
    TestBed.resetTestingModule();
    expect(montar().auth.privilegiosPendientes()).toBe(false);
  });

  it('cada login nuevo vuelve a pedir la confirmación', () => {
    const { auth, http } = montar();
    iniciarSesion(auth, http);
    auth.aceptarPrivilegios();
    iniciarSesion(auth, http);
    expect(auth.privilegiosPendientes()).toBe(true);
  });

  it('cerrar sesión limpia la marca', () => {
    const { auth, http } = montar();
    iniciarSesion(auth, http);
    auth.logout();
    http.expectOne((r) => r.url.endsWith('/auth/logout')).flush({});
    expect(auth.privilegiosPendientes()).toBe(false);
    TestBed.resetTestingModule();
    expect(montar().auth.privilegiosPendientes()).toBe(false);
  });
});
