import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { Aviso, WorkOrder } from '../models';
import { AuthService } from '../services/auth.service';
import { AvisosPendientes } from '../services/avisos-pendientes';
import { TenantContextService } from '../services/tenant-context.service';
import { Avisos } from '../../features/avisos/avisos';
import { ESTADO_META, GRAVEDAD_META, GRAVEDADES, estadoMeta, gravedadMeta, motivosDescarte, sintomasFrecuentes } from '../../features/avisos/etiquetas';
import { DocumentosComponent } from '../../features/documentos/documentos.component';
import { EmpresasComponent } from '../../features/empresas/empresas.component';
import { ForbiddenComponent } from '../../features/forbidden/forbidden.component';
import { LoginComponent } from '../../features/auth/login/login.component';
import { OPERACION_LABEL, RANGOS, rolLabel, tablaLabel } from '../../features/transacciones/etiquetas';
import { ROLE_OPTIONS } from '../../features/usuarios/usuario-form-modal.component';
import { UsuariosComponent } from '../../features/usuarios/usuarios.component';
import { priorityMeta, roleLabel, statusMeta, tipoLabel } from '../../features/work-orders/utils/work-order-labels';
import { WorkOrdersListComponent } from '../../features/work-orders/pages/work-orders-list/work-orders-list.component';
import { I18nService } from './i18n.service';

/**
 * Cambio de idioma en cada vista: se monta en español, se cambia a inglés con el servicio (lo que hace el botón de la
 * cabecera), se comprueba que el texto cambia SIN recrear la pantalla, y que al volver a español queda como estaba.
 */
@Component({ template: '' })
class Vacio {}

function preparar(role: string, tenant: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', component: Vacio }]),
      { provide: AuthService, useValue: { user: signal({ role, name: 'Ana', empresa_nombre: 'Demo' }), isLoggedIn: () => true, login: () => ({ subscribe: () => undefined }) } },
      { provide: TenantContextService, useValue: { isSuper: () => role === 'super_usuario', empresaId: signal(null), clear: () => undefined, set: () => undefined, ...tenant } },
      { provide: AvisosPendientes, useValue: { total: () => 0, sincronizar: () => undefined, marcarVisto: () => undefined } },
    ],
  });
  return { http: TestBed.inject(HttpTestingController), i18n: TestBed.inject(I18nService) };
}

function ciclo(fixture: { detectChanges: () => void; nativeElement: unknown }, i18n: I18nService, esperado: { es: string[]; en: string[]; noEn?: string[] }) {
  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  fixture.detectChanges();
  for (const t of esperado.es) expect(texto(), `ES: falta «${t}»`).toContain(t);
  i18n.setLang('en');
  fixture.detectChanges();
  for (const t of esperado.en) expect(texto(), `EN: falta «${t}»`).toContain(t);
  for (const t of esperado.noEn ?? esperado.es) expect(texto(), `EN: sigue en español «${t}»`).not.toContain(t);
  i18n.setLang('es');
  fixture.detectChanges();
  for (const t of esperado.es) expect(texto(), `ES al volver: falta «${t}»`).toContain(t);
  for (const t of esperado.en) expect(texto(), `ES al volver: sigue en inglés «${t}»`).not.toContain(t);
}

const AVISO = {
  aviso_id: 1, numero_aviso: 'AV-2026-0001', maquina_id: 1, machine_name: 'Compresor', plant_name: 'Planta', empresa_id: 1, descripcion: 'Fuga',
  severidad: 'high', estado: 'pendiente', status: 'Pendiente', reportado_por: { id: 1, nombre: 'Op', rol: 'operador' }, created_at: '2026-10-28T12:00:00Z',
  resuelto_en: null, resuelto_por: null, motivo_descarte: null, numero_ot: null, foto: null,
} as unknown as Aviso;

const OT = {
  id: 'OT-1', numero_ot: 'OT-2026-0001', ot_id: 1, title: 'Vibración', machine_name: 'Compresor A1', plant_name: 'Planta', tecnico_nombre: null, tipo: 'corrective',
  priority: 'high', estado: 'pending', created_at: '2026-10-01T03:35:31Z', allowed_transitions: ['in_progress', 'cancelled'],
} as unknown as WorkOrder;

describe('Cambio de idioma en cada vista', () => {
  it('Avisos de falla (supervisor): título, filtros, estado, gravedad y botones', () => {
    const { http, i18n } = preparar('supervisor');
    const f = TestBed.createComponent(Avisos);
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/avisos')).flush([AVISO]);
    ciclo(f, i18n, {
      es: ['Avisos de falla (1)', 'Pendiente', 'Generar OT', 'Descartar', 'Actualizar'],
      en: ['Fault reports (1)', 'Pending', 'Generate work order', 'Discard', 'Refresh'],
    });
  });

  it('Avisos de falla (operador): «Mis avisos» y el estado vacío', () => {
    const { http, i18n } = preparar('operador');
    const f = TestBed.createComponent(Avisos);
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/avisos')).flush([]);
    ciclo(f, i18n, {
      es: ['Mis avisos de falla (0)', 'Todavía no hay avisos.', 'Reportar una falla'],
      en: ['My fault reports (0)', 'There are no reports yet.', 'Report a fault'],
    });
  });

  it('Órdenes de trabajo (supervisor): título, botón, columnas, estado y prioridad', () => {
    const { http, i18n } = preparar('supervisor');
    const f = TestBed.createComponent(WorkOrdersListComponent);
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/work-orders')).flush([OT]);
    ciclo(f, i18n, {
      es: ['Órdenes de Trabajo (1)', '+ Crear OT', 'Descripción', 'Técnico', 'Prioridad', 'Sin asignar', 'Alta'],
      en: ['Work orders (1)', '+ Create work order', 'Description', 'Technician', 'Priority', 'Unassigned', 'High'],
    });
  });

  it('Usuarios (admin): título, botón y encabezados', () => {
    const { http, i18n } = preparar('admin');
    const f = TestBed.createComponent(UsuariosComponent);
    f.detectChanges();
    for (const r of http.match(() => true)) r.flush([]);
    ciclo(f, i18n, {
      es: ['Usuarios (0)', '+ Nuevo usuario', 'Último acceso', 'No hay usuarios que coincidan.'],
      en: ['Users (0)', '+ New user', 'Last access', 'No users match.'],
    });
  });

  it('Empresas (super usuario): título, botón y encabezados', () => {
    const { http, i18n } = preparar('super_usuario');
    const f = TestBed.createComponent(EmpresasComponent);
    f.detectChanges();
    for (const r of http.match(() => true)) r.flush([]);
    ciclo(f, i18n, {
      es: ['Empresas (0)', '+ Nueva empresa', 'Usuarios', 'No hay empresas que coincidan.'],
      en: ['Companies (0)', '+ New company', 'Users', 'No companies match.'],
    });
  });

  it('Documentos (engineer): título, formulario de subida y estado vacío', () => {
    const { http, i18n } = preparar('engineer');
    const f = TestBed.createComponent(DocumentosComponent);
    f.detectChanges();
    for (const r of http.match(() => true)) r.flush([]);
    ciclo(f, i18n, {
      es: ['Documentación (0)', 'Subir documento', 'Cómo se usa:', 'Aún no hay documentos.', 'Seleccionar archivo', 'Ningún archivo seleccionado'],
      en: ['Documentation (0)', 'Upload document', 'How it works:', 'There are no documents yet.', 'Select file', 'No file selected'],
    });
  });

  it('Documentos: el selector de archivo no usa el texto nativo del navegador y muestra el nombre elegido', () => {
    const { http, i18n } = preparar('engineer');
    const f = TestBed.createComponent(DocumentosComponent);
    f.detectChanges();
    for (const r of http.match(() => true)) r.flush([]);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const input = el.querySelector('#doc-file') as HTMLInputElement;
    expect(input.classList.contains('sr-only')).toBe(true); // oculto: lo que se ve es el botón propio
    expect((el.querySelector('[data-testid="doc-elegir"]') as HTMLLabelElement).htmlFor).toBe('doc-file');
    const nombre = () => el.querySelector('[data-testid="doc-nombre-archivo"]')!.textContent!.trim();
    expect(nombre()).toBe('Ningún archivo seleccionado');

    const archivo = new File(['hola'], 'manual.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [archivo], configurable: true });
    input.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(nombre()).toBe('manual.txt'); // el nombre del archivo no se traduce

    i18n.setLang('en');
    f.detectChanges();
    expect(el.querySelector('[data-testid="doc-elegir"]')!.textContent!.trim()).toBe('Select file');
    expect(nombre()).toBe('manual.txt');
  });

  it('Ingreso: etiquetas y botón', () => {
    const { i18n } = preparar('operador');
    const f = TestBed.createComponent(LoginComponent);
    ciclo(f, i18n, { es: ['Usuario', 'Contraseña', 'Ingresar'], en: ['User', 'Password', 'Sign in'] });
  });

  it('Ingreso: el selector de idioma cambia la pantalla antes de iniciar sesión y recuerda la elección', () => {
    const { i18n } = preparar('operador');
    const f = TestBed.createComponent(LoginComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const boton = el.querySelector('[data-testid="login-idioma"]') as HTMLButtonElement;
    expect(boton.textContent).toContain('ES');
    boton.click();
    f.detectChanges();
    expect(boton.textContent).toContain('EN');
    expect(el.textContent).toContain('Sign in');
    expect(el.textContent).not.toContain('Ingresar');
    TestBed.tick();
    expect(window.localStorage.getItem('barb.lang')).toBe('en');
    boton.click();
    f.detectChanges();
    expect(el.textContent).toContain('Ingresar');
    expect(i18n.lang()).toBe('es');
  });

  it('Acceso denegado (403)', () => {
    const { i18n } = preparar('operador');
    const f = TestBed.createComponent(ForbiddenComponent);
    f.detectChanges();
    const es = (f.nativeElement as HTMLElement).textContent;
    i18n.setLang('en');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).not.toBe(es);
    expect((f.nativeElement as HTMLElement).textContent).toContain(i18n.tr('common.forbiddenTitle'));
  });
});

describe('Etiquetas que viven fuera de las plantillas siguen el idioma', () => {
  const en = () => TestBed.inject(I18nService).setLang('en');
  const es = () => TestBed.inject(I18nService).setLang('es');

  it('estado, prioridad, tipo y rol de una OT', () => {
    TestBed.inject(I18nService);
    expect([statusMeta('in_progress').label, priorityMeta('urgent').label, tipoLabel('preventive'), roleLabel('engineer')]).toEqual(['En curso', 'Urgente', 'Preventivo', 'Ingeniero']);
    en();
    expect([statusMeta('in_progress').label, priorityMeta('urgent').label, tipoLabel('preventive'), roleLabel('engineer')]).toEqual(['In progress', 'Urgent', 'Preventive', 'Engineer']);
    expect(statusMeta('completed').effect).toContain('final status');
    es();
    expect(statusMeta('completed').effect).toContain('estado final');
  });

  it('estado y gravedad de un aviso (objetos compartidos con textos calculados al leerlos)', () => {
    TestBed.inject(I18nService);
    expect([estadoMeta('con_ot').label, gravedadMeta('critical').label, GRAVEDADES.map((g) => g.label).join('|')]).toEqual(['Con OT', 'Crítica', 'Baja|Media|Alta|Crítica']);
    en();
    expect([ESTADO_META.descartado.label, GRAVEDAD_META.low.label, GRAVEDADES.map((g) => g.label).join('|')]).toEqual(['Discarded', 'Low', 'Low|Medium|High|Critical']);
    expect(sintomasFrecuentes()[0]).toBe('Abnormal noise');
    expect(motivosDescarte()[1]).toBe('False alarm');
    es();
    expect(sintomasFrecuentes()[0]).toBe('Ruido anormal');
  });

  it('transacciones: períodos, operaciones, tablas y roles', () => {
    TestBed.inject(I18nService);
    expect([RANGOS[0].label, OPERACION_LABEL.INSERT, tablaLabel('orden_trabajo'), rolLabel('gerente')]).toEqual(['Hace 24 horas', 'Creó', 'orden de trabajo', 'Gerente']);
    en();
    expect([RANGOS[0].label, OPERACION_LABEL.INSERT, tablaLabel('orden_trabajo'), rolLabel('gerente')]).toEqual(['24 hours ago', 'Created', 'work order', 'Manager']);
    expect(tablaLabel('tabla_desconocida')).toBe('tabla desconocida');
  });

  it('roles del formulario de usuarios', () => {
    TestBed.inject(I18nService);
    expect(ROLE_OPTIONS.find((r) => r.value === 'tecnico')?.label).toBe('Técnico');
    en();
    expect(ROLE_OPTIONS.find((r) => r.value === 'tecnico')?.label).toBe('Technician');
    expect(ROLE_OPTIONS.find((r) => r.value === 'admin')?.label).toBe('Company administrator');
  });
});
