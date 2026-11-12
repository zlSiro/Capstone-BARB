import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../core/services/auth.service';
import { AyudaProgresoService } from './ayuda-progreso.service';
import { ESPERA_ELEMENTO_MS, RecorridosService, esVisible } from './recorridos.service';

function montar(role = 'tecnico', url = '/dashboard') {
  const router = {
    url,
    navigateByUrl: vi.fn(async (destino: string) => {
      router.url = destino;
      return true;
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router },
      { provide: AuthService, useValue: { user: signal({ id: 1, name: 'Ana', role }), privilegiosPendientes: signal(false) } },
    ],
  });
  return { r: TestBed.inject(RecorridosService), router, progreso: TestBed.inject(AyudaProgresoService) };
}

/** Agrega al documento un elemento con `data-tour` (como lo haría la pantalla real). */
function marca(objetivo: string, etiqueta = 'div'): HTMLElement {
  const el = document.createElement(etiqueta);
  el.setAttribute('data-tour', objetivo);
  document.body.appendChild(el);
  return el;
}

const asentar = () => vi.advanceTimersByTimeAsync(0);

describe('RecorridosService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('inicia un recorrido: expone el activo, el paso actual (1) y el total', async () => {
    marca('ot-fila');
    const { r } = montar();
    r.iniciar('iniciar_enviar');
    await asentar();
    expect(r.activo()?.id).toBe('iniciar_enviar');
    expect(r.indice()).toBe(0);
    expect(r.total()).toBe(5);
    expect(r.paso()?.objetivo).toBe('ot-fila');
  });

  it('no inicia un recorrido que el perfil no puede hacer', () => {
    const { r } = montar('operador');
    r.iniciar('crear_empresa');
    r.iniciar('inventado');
    expect(r.activo()).toBeNull();
  });

  it('si el paso está en otra ruta, navega a ella y resalta el elemento cuando aparece', async () => {
    const { r, router } = montar('tecnico', '/dashboard');
    r.iniciar('iniciar_enviar');
    await asentar();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/work-orders');
    expect(r.elemento()).toBeNull(); // aún no se dibuja la pantalla
    expect(r.buscando()).toBe(true);

    const tabla = marca('ot-fila');
    await vi.advanceTimersByTimeAsync(200);
    expect(r.elemento()).toBe(tabla);
    expect(r.buscando()).toBe(false);
    expect(r.sinElemento()).toBe(false);
  });

  it('si ya está en la ruta del paso no vuelve a navegar', async () => {
    marca('ot-fila');
    const { r, router } = montar('tecnico', '/work-orders?x=1');
    r.iniciar('iniciar_enviar');
    await asentar();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('avanza y retrocede paso a paso, sin pasar de los extremos', async () => {
    marca('ot-fila');
    marca('ot-estado');
    const { r } = montar();
    r.iniciar('iniciar_enviar');
    await asentar();

    r.anterior(); // ya está en el primero
    expect(r.indice()).toBe(0);
    r.siguiente();
    r.siguiente();
    await asentar();
    expect(r.indice()).toBe(2);
    expect(r.paso()?.objetivo).toBe('ot-estado');
    r.anterior();
    expect(r.indice()).toBe(1);
  });

  it('nunca avanza solo: sin que el usuario pulse nada, el paso no cambia', async () => {
    marca('ot-fila');
    const { r } = montar();
    r.iniciar('iniciar_enviar');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(r.indice()).toBe(0);
    expect(r.activo()).not.toBeNull();
  });

  it('un paso sin objetivo se muestra sin buscar nada y sin aviso', async () => {
    marca('ot-fila');
    const { r } = montar();
    r.iniciar('iniciar_enviar');
    await asentar();
    for (let i = 0; i < 4; i++) r.siguiente(); // último paso: «El supervisor la revisa» (sin objetivo)
    await asentar();
    expect(r.paso()?.objetivo).toBeUndefined();
    expect(r.elemento()).toBeNull();
    expect(r.sinElemento()).toBe(false);
    expect(r.buscando()).toBe(false);
  });

  it('si el elemento no aparece a tiempo, el paso se muestra sin resaltado y con aviso; el usuario puede seguir', async () => {
    const { r } = montar();
    r.iniciar('iniciar_enviar');
    await vi.advanceTimersByTimeAsync(ESPERA_ELEMENTO_MS + 500);
    expect(r.sinElemento()).toBe(true);
    expect(r.elemento()).toBeNull();
    expect(r.buscando()).toBe(false);
    expect(r.paso()).not.toBeNull();

    // No queda trabado: puede avanzar, y el aviso se reinicia para el paso siguiente.
    r.siguiente();
    expect(r.indice()).toBe(1);
    expect(r.sinElemento()).toBe(false);
  });

  it('un elemento oculto (display: none) no cuenta como encontrado', async () => {
    const oculto = marca('ot-fila');
    oculto.style.display = 'none';
    const { r } = montar();
    r.iniciar('iniciar_enviar');
    await vi.advanceTimersByTimeAsync(ESPERA_ELEMENTO_MS + 500);
    expect(r.sinElemento()).toBe(true);
    expect(esVisible(oculto)).toBe(false);
  });

  it('si hay varias marcas iguales resalta la primera que se ve', async () => {
    const escondida = marca('aviso-generar', 'button');
    escondida.style.display = 'none';
    const visible = marca('aviso-generar', 'button');
    const { r } = montar('supervisor', '/avisos');
    r.iniciar('generar_ot');
    await asentar();
    expect(r.elemento()).toBe(visible);
  });

  it('terminar (último paso) cierra el recorrido y lo marca como hecho', async () => {
    marca('trx-tabla');
    const { r, progreso } = montar('super_usuario', '/transacciones');
    r.iniciar('mis_transacciones'); // 1 solo paso
    await asentar();
    expect(progreso.esHecho('mis_transacciones')).toBe(false);
    r.siguiente(); // en el último paso, «Siguiente» es «Terminar»
    expect(r.activo()).toBeNull();
    expect(progreso.esHecho('mis_transacciones')).toBe(true);
  });

  it('salir cierra el recorrido sin marcarlo como hecho', async () => {
    marca('ot-fila');
    const { r, progreso } = montar();
    r.iniciar('iniciar_enviar');
    await asentar();
    r.salir();
    expect(r.activo()).toBeNull();
    expect(r.elemento()).toBeNull();
    expect(progreso.esHecho('iniciar_enviar')).toBe(false);
  });

  it('el foco vuelve al botón que inició el recorrido, al salir y al terminar', async () => {
    marca('ot-fila');
    const { r } = montar();
    const boton = document.createElement('button');
    document.body.appendChild(boton);

    r.iniciar('iniciar_enviar', boton);
    await asentar();
    document.body.focus();
    r.salir();
    expect(document.activeElement).toBe(boton);

    r.iniciar('iniciar_enviar', boton);
    await asentar();
    document.body.focus();
    for (let i = 0; i < 5; i++) r.siguiente();
    expect(r.activo()).toBeNull();
    expect(document.activeElement).toBe(boton);
  });

  it('si el botón de origen ya no está en pantalla, salir no falla', async () => {
    marca('ot-fila');
    const { r } = montar();
    const boton = document.createElement('button');
    document.body.appendChild(boton);
    r.iniciar('iniciar_enviar', boton);
    boton.remove();
    expect(() => r.salir()).not.toThrow();
  });

  it('cambiar de paso rápido descarta la búsqueda del paso anterior', async () => {
    const { r } = montar();
    r.iniciar('iniciar_enviar');
    await vi.advanceTimersByTimeAsync(500); // sigue buscando 'ot-fila'
    r.siguiente(); // pasa al paso 2 (también 'ot-fila')
    const tabla = marca('ot-fila');
    await vi.advanceTimersByTimeAsync(200);
    expect(r.indice()).toBe(1);
    expect(r.elemento()).toBe(tabla);
  });

  it('reubicar vuelve a encontrar el elemento si la pantalla se redibujó', async () => {
    const original = marca('ot-fila');
    const { r } = montar('tecnico', '/work-orders');
    r.iniciar('iniciar_enviar');
    await asentar();
    expect(r.elemento()).toBe(original);

    original.remove();
    const nuevo = marca('ot-fila');
    r.reubicar();
    expect(r.elemento()).toBe(nuevo);
  });

  it('iniciar otro recorrido reemplaza al activo', async () => {
    marca('ot-fila');
    const { r } = montar();
    r.iniciar('iniciar_enviar');
    await asentar();
    r.iniciar('ver_ot');
    await asentar();
    expect(r.activo()?.id).toBe('ver_ot');
    expect(r.indice()).toBe(0);
  });

  describe('desplazamiento al elemento del paso', () => {
    function conScroll(alto: number) {
      const el = marca('ot-fila');
      el.scrollIntoView = vi.fn();
      el.getBoundingClientRect = () => ({ top: 0, bottom: alto, left: 0, right: 100, width: 100, height: alto, x: 0, y: 0, toJSON: () => ({}) });
      return el;
    }

    it('lleva el registro a la vista de inmediato, sin animación, centrado', async () => {
      const el = conScroll(60);
      const { r } = montar('tecnico', '/work-orders');
      r.iniciar('iniciar_enviar');
      await asentar();
      expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'auto' });
    });

    it('si el elemento es más alto que la pantalla se alinea por arriba para ver su comienzo', async () => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
      const el = conScroll(3000);
      const { r } = montar('tecnico', '/work-orders');
      r.iniciar('iniciar_enviar');
      await asentar();
      expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'start', inline: 'nearest', behavior: 'auto' });
    });
  });
});
