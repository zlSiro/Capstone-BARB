import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../core/services/auth.service';
import { ReportarFallaUi } from '../../core/services/reportar-falla-ui';
import { Aviso } from '../../core/models';
import { AyudaProgresoService } from './ayuda-progreso.service';

const CLAVE = (id: number | string) => `barb.ayuda.progreso.${id}`;

function montar(id: number | null = 7) {
  const user = signal<{ id: number; name: string; role: string } | null>(id === null ? null : { id, name: 'Ana', role: 'tecnico' });
  TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { user } }] });
  return { servicio: TestBed.inject(AyudaProgresoService), user, ui: TestBed.inject(ReportarFallaUi) };
}

describe('AyudaProgresoService (avance en localStorage)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('con localStorage vacío parte de cero', () => {
    expect(montar().servicio.hechos()).toEqual([]);
  });

  it('marca un recorrido, lo guarda con la clave del usuario y es idempotente', () => {
    const { servicio } = montar(7);
    servicio.marcar('iniciar_enviar');
    servicio.marcar('iniciar_enviar');
    expect(servicio.esHecho('iniciar_enviar')).toBe(true);
    expect(JSON.parse(localStorage.getItem(CLAVE(7))!)).toEqual(['iniciar_enviar']);
  });

  it('el avance es por usuario: cada uno ve el suyo', () => {
    localStorage.setItem(CLAVE(7), JSON.stringify(['ver_ot']));
    localStorage.setItem(CLAVE(8), JSON.stringify(['docchat']));
    expect(montar(7).servicio.hechos()).toEqual(['ver_ot']);
    TestBed.resetTestingModule();
    expect(montar(8).servicio.hechos()).toEqual(['docchat']);
  });

  it('al cambiar de usuario en la misma sesión se recarga su avance', () => {
    localStorage.setItem(CLAVE(7), JSON.stringify(['ver_ot']));
    localStorage.setItem(CLAVE(8), JSON.stringify(['docchat']));
    const { servicio, user } = montar(7);
    expect(servicio.hechos()).toEqual(['ver_ot']);
    user.set({ id: 8, name: 'Beto', role: 'operador' });
    expect(servicio.hechos()).toEqual(['docchat']);
    user.set(null);
    expect(servicio.hechos()).toEqual([]);
  });

  it.each([
    ['JSON corrupto', '{no es json'],
    ['un valor que no es lista', '{"a":1}'],
    ['un número', '42'],
    ['texto vacío', ''],
  ])('si el contenido guardado es %s, parte de cero sin romper', (_nombre, crudo) => {
    localStorage.setItem(CLAVE(7), crudo);
    expect(montar(7).servicio.hechos()).toEqual([]);
  });

  it('ignora elementos que no son texto dentro de la lista guardada', () => {
    localStorage.setItem(CLAVE(7), JSON.stringify(['ver_ot', 3, null, { x: 1 }, 'docchat']));
    expect(montar(7).servicio.hechos()).toEqual(['ver_ot', 'docchat']);
  });

  it('si leer localStorage lanza un error, parte de cero sin romper la vista', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(montar(7).servicio.hechos()).toEqual([]);
  });

  it('si escribir lanza un error (cuota llena), el avance sigue valiendo en esta sesión', () => {
    const { servicio } = montar(7);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => servicio.marcar('ver_ot')).not.toThrow();
    expect(servicio.esHecho('ver_ot')).toBe(true);
  });

  it('sin usuario no escribe nada en localStorage', () => {
    const { servicio } = montar(null);
    servicio.marcar('ver_ot');
    expect(servicio.esHecho('ver_ot')).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it('un aviso creado desde «Reportar falla» marca esa tarea sin pedir nada más', () => {
    const { servicio, ui } = montar(7);
    TestBed.tick();
    expect(servicio.esHecho('reportar_falla')).toBe(false);
    ui.notificarCreado({ aviso_id: 1, numero_aviso: 'AV-1' } as Aviso);
    TestBed.tick();
    expect(servicio.esHecho('reportar_falla')).toBe(true);
    expect(JSON.parse(localStorage.getItem(CLAVE(7))!)).toEqual(['reportar_falla']);
  });
});
