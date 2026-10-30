import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Aviso } from '../models';
import { AvisosApi } from './avisos-api';
import { AvisosPendientes, INTERVALO_AVISOS_MS } from './avisos-pendientes';
import { ToastService } from './toast.service';

const aviso = (id: number, estado: Aviso['estado'] = 'pendiente') =>
  ({ aviso_id: id, estado, machine_name: 'Bomba 1', descripcion: 'Fuga' }) as Aviso;

describe('AvisosPendientes', () => {
  let list: ReturnType<typeof vi.fn>;
  let warning: ReturnType<typeof vi.fn>;

  function servicio() {
    list = vi.fn(() => of([aviso(1), aviso(2)]));
    warning = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AvisosApi, useValue: { list } },
        { provide: ToastService, useValue: { warning } },
      ],
    });
    return TestBed.inject(AvisosPendientes);
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('consulta al iniciar, cuenta los pendientes y no anuncia lo que ya estaba', () => {
    const s = servicio();
    s.iniciar();
    expect(list).toHaveBeenCalledWith('pendiente');
    expect(s.total()).toBe(2);
    expect(warning).not.toHaveBeenCalled();
    s.detener();
  });

  it('vuelve a consultar cada 30 s y avisa de los nuevos', () => {
    const s = servicio();
    s.iniciar();
    list.mockReturnValue(of([aviso(1), aviso(2), aviso(3)]));
    vi.advanceTimersByTime(INTERVALO_AVISOS_MS);
    expect(list).toHaveBeenCalledTimes(2);
    expect(s.total()).toBe(3);
    expect(warning).toHaveBeenCalledOnce();
    s.detener();
  });

  it('no lanza una consulta si ya hay una en curso', () => {
    const s = servicio();
    list.mockReturnValue(NEVER);
    s.iniciar();
    s.refrescar();
    s.refrescar();
    expect(list).toHaveBeenCalledTimes(1);
    s.detener();
  });

  it('se pausa con la pestaña oculta y refresca al volver', () => {
    const s = servicio();
    s.iniciar();
    const estado = vi.spyOn(document, 'visibilityState', 'get');
    estado.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(INTERVALO_AVISOS_MS * 3);
    expect(list).toHaveBeenCalledTimes(1);
    estado.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(list).toHaveBeenCalledTimes(2);
    s.detener();
  });

  it('si falla la consulta marca sin conexión y conserva la cifra anterior', () => {
    const s = servicio();
    s.iniciar();
    list.mockReturnValue(throwError(() => new Error('caído')));
    vi.advanceTimersByTime(INTERVALO_AVISOS_MS);
    expect(s.sinConexion()).toBe(true);
    expect(s.total()).toBe(2);
    s.detener();
  });

  it('sincronizar usa la lista de la bandeja sin otra solicitud', () => {
    const s = servicio();
    s.iniciar();
    s.sincronizar([aviso(1), aviso(2, 'con_ot'), aviso(3, 'descartado')]);
    expect(s.total()).toBe(1);
    expect(list).toHaveBeenCalledTimes(1);
    s.detener();
  });

  it('el título de la pestaña lleva el número de pendientes', () => {
    const s = servicio();
    s.iniciar();
    TestBed.tick();
    expect(TestBed.inject(Title).getTitle()).toMatch(/^\(2\) BARB/);
    s.detener();
    TestBed.tick();
    expect(TestBed.inject(Title).getTitle()).not.toMatch(/^\(/);
  });
});
