import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../core/services/auth.service';
import { AyudaComponent } from './ayuda.component';
import { AyudaProgresoService } from './ayuda-progreso.service';
import { RecorridosService } from './recorridos.service';

function montar(role: string, opciones: { privilegiosPendientes?: boolean; id?: number } = {}) {
  const privilegiosPendientes = signal(opciones.privilegiosPendientes ?? false);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { user: signal({ id: opciones.id ?? 5, name: 'Ana', role }), privilegiosPendientes } },
    ],
  });
  const fixture = TestBed.createComponent(AyudaComponent);
  fixture.detectChanges();
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    privilegiosPendientes,
    progreso: TestBed.inject(AyudaProgresoService),
    recorridos: TestBed.inject(RecorridosService),
  };
}

const q = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tareas = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-testid="ayuda-tareas"] > li'));

describe('AyudaComponent (inicio de «Aprende BARB»)', () => {
  beforeEach(() => localStorage.clear());

  it('muestra el encabezado y el chip con el perfil traducido', () => {
    const { el } = montar('tecnico');
    expect(el.querySelector('h1')!.textContent).toContain('Aprende BARB');
    expect(q(el, 'ayuda-perfil')!.textContent).toContain('Perfil: Técnico');
  });

  it('la tarjeta dice «Primeros pasos como {rol}» con «k de n» y la barra de avance', () => {
    const { el } = montar('tecnico');
    expect(el.querySelector('#ayuda-primeros')!.textContent).toContain('Primeros pasos como Técnico');
    // Con el aviso de privilegios ya aceptado, esa primera tarea cuenta como hecha.
    expect(q(el, 'ayuda-avance')!.textContent!.trim()).toBe('1 de 6');
    const barra = el.querySelector('[role="progressbar"]')!;
    expect(barra.getAttribute('aria-valuemax')).toBe('6');
    expect(barra.getAttribute('aria-valuenow')).toBe('1');
  });

  it('lista las tareas del perfil en orden, cada pendiente con «Mostrarme cómo»', () => {
    const { el } = montar('tecnico');
    expect(tareas(el).map((t) => t.getAttribute('data-testid'))).toEqual([
      'tarea-privilegios',
      'tarea-reportar_falla',
      'tarea-iniciar_ot',
      'tarea-enviar_validacion',
      'tarea-docchat',
      'tarea-reporte_mi_actividad',
    ]);
    // «Confirmar privilegios» (ya aceptado) no tiene recorrido ni botón. Las otras 4 pendientes sí.
    expect(el.querySelectorAll('[data-testid="tarea-mostrar"]')).toHaveLength(5);
    expect(q(el, 'tarea-privilegios')!.textContent).toContain('Confirmar tus privilegios');
  });

  it('«Confirmar privilegios» queda hecha solo cuando el aviso ya fue aceptado', () => {
    const { fixture, el, privilegiosPendientes } = montar('operador', { privilegiosPendientes: true });
    expect(q(el, 'tarea-privilegios')!.querySelector('[data-testid="tarea-hecha"]')).toBeNull();
    expect(q(el, 'ayuda-avance')!.textContent!.trim()).toBe('0 de 6');

    privilegiosPendientes.set(false); // el usuario acepta el aviso de privilegios
    fixture.detectChanges();
    expect(q(el, 'tarea-privilegios')!.querySelector('[data-testid="tarea-hecha"]')!.textContent).toContain('Hecho');
    expect(q(el, 'ayuda-avance')!.textContent!.trim()).toBe('1 de 6');
  });

  it('un recorrido terminado se puede repetir cuantas veces se quiera: el botón sigue y dice «Repetir recorrido»', () => {
    const { fixture, el, progreso, recorridos } = montar('tecnico');
    progreso.marcar('iniciar_enviar');
    fixture.detectChanges();
    const fila = q(el, 'tarea-iniciar_ot')!;
    expect(fila.querySelector('[data-testid="tarea-hecha"]')).not.toBeNull(); // sigue «Hecho»: el avance no se pierde
    const boton = q(fila, 'tarea-mostrar') as HTMLButtonElement;
    expect(boton).not.toBeNull();
    expect(boton.textContent).toContain('Repetir recorrido');
    expect(boton.getAttribute('aria-label')).toContain('Repetir el recorrido');
    const iniciar = vi.spyOn(recorridos, 'iniciar').mockImplementation(() => undefined);
    boton.click();
    boton.click();
    expect(iniciar).toHaveBeenCalledTimes(2);
    expect(iniciar.mock.calls[0][0]).toBe('iniciar_enviar');
  });

  it('en una sesión posterior (avance guardado) los recorridos ya hechos siguen disponibles', () => {
    localStorage.setItem('barb.ayuda.progreso.5', JSON.stringify(['reportar_falla', 'docchat', 'iniciar_enviar']));
    const { el } = montar('tecnico');
    for (const tarea of ['reportar_falla', 'iniciar_ot', 'enviar_validacion', 'docchat']) {
      const fila = q(el, `tarea-${tarea}`)!;
      expect(fila.querySelector('[data-testid="tarea-hecha"]'), tarea).not.toBeNull();
      expect(fila.querySelector('[data-testid="tarea-mostrar"]'), tarea).not.toBeNull();
    }
    // y la lista de «Recorridos guiados» nunca los oculta
    expect(el.querySelector('[data-testid="recorrido-reportar_falla"]')).not.toBeNull();
  });

  it('una tarea con su recorrido terminado aparece como «Hecho» y el avance se actualiza', () => {
    const { fixture, el, progreso } = montar('tecnico');
    progreso.marcar('iniciar_enviar'); // un solo recorrido respalda «iniciar» y «enviar a validación»
    fixture.detectChanges();
    expect(q(el, 'tarea-iniciar_ot')!.querySelector('[data-testid="tarea-hecha"]')).not.toBeNull();
    expect(q(el, 'ayuda-avance')!.textContent!.trim()).toBe('3 de 6');
    expect(el.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('3');
  });

  it('el avance guardado de este usuario se ve al abrir la ayuda', () => {
    localStorage.setItem('barb.ayuda.progreso.5', JSON.stringify(['reportar_falla', 'docchat']));
    const { el } = montar('tecnico', { id: 5 });
    expect(q(el, 'ayuda-avance')!.textContent!.trim()).toBe('3 de 6'); // privilegios + 2 guardadas
  });

  it('«Mostrarme cómo» inicia el recorrido de la tarea y le pasa el botón para devolverle el foco', () => {
    const { el, recorridos } = montar('tecnico');
    const iniciar = vi.spyOn(recorridos, 'iniciar').mockImplementation(() => undefined);
    const boton = q(q(el, 'tarea-iniciar_ot')!, 'tarea-mostrar') as HTMLButtonElement;
    boton.click();
    expect(iniciar).toHaveBeenCalledWith('iniciar_enviar', boton);
  });

  it('la lista «Recorridos guiados» muestra los del perfil con su número de pasos', () => {
    const { el, recorridos } = montar('tecnico');
    const fila = q(el, 'recorrido-iniciar_enviar')!;
    expect(fila.textContent).toContain('Iniciar y enviar a validación una OT');
    expect(fila.textContent).toContain('5 pasos');
    const iniciar = vi.spyOn(recorridos, 'iniciar').mockImplementation(() => undefined);
    fila.click();
    expect(iniciar).toHaveBeenCalledWith('iniciar_enviar', fila);
    // Un recorrido de otro perfil no aparece.
    expect(q(el, 'recorrido-crear_empresa')).toBeNull();
  });

  it('el superusuario ve sus recorridos y no los de DocChat ni del dashboard', () => {
    const { el } = montar('super_usuario');
    expect(q(el, 'recorrido-crear_empresa')).not.toBeNull();
    expect(q(el, 'recorrido-docchat')).toBeNull();
    expect(q(el, 'ayuda-ir-dashboard')).toBeNull();
    expect(q(el, 'ayuda-avance')!.textContent!.trim()).toBe('0 de 4'); // sin tarea de privilegios
  });

  it('«Explícame esta pantalla» lleva al dashboard solo si el perfil puede entrar', () => {
    expect(q(montar('gerente').el, 'ayuda-ir-dashboard')!.getAttribute('href')).toBe('/dashboard');
    TestBed.resetTestingModule();
    expect(q(montar('operador').el, 'ayuda-ir-dashboard')).toBeNull();
  });

  it('«Pregúntale a la ayuda»: la pregunta se envía a la vista de respuestas', () => {
    const { fixture, el } = montar('supervisor');
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const campo = q(el, 'ayuda-pregunta') as HTMLInputElement;
    campo.value = '  ¿Cómo devuelvo una OT?  ';
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(navegar).toHaveBeenCalledWith(['/ayuda/preguntar'], { queryParams: { q: '¿Cómo devuelvo una OT?' } });
  });

  it('una pregunta vacía no agrega parámetros', () => {
    const { el } = montar('supervisor');
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(navegar).toHaveBeenCalledWith(['/ayuda/preguntar'], { queryParams: {} });
  });

  it('no llama al backend: la ayuda no hace peticiones HTTP', () => {
    // Sin provideHttpClient: si el componente intentara pedir algo (p. ej. /api/chat), la inyección fallaría.
    expect(() => montar('gerente')).not.toThrow();
  });

  it.each(['operador', 'tecnico', 'supervisor', 'engineer', 'gerente', 'admin', 'super_usuario'])('%s: la vista se monta y muestra tareas', (rol) => {
    const { el } = montar(rol);
    expect(tareas(el).length).toBeGreaterThan(0);
    expect(el.querySelectorAll('[data-testid^="recorrido-"]').length).toBeGreaterThan(0);
  });
});
