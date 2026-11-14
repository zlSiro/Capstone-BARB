import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { Documento } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { DocumentosComponent } from './documentos.component';

const PLANTAS = [
  { id: 1, name: 'Planta Central' },
  { id: 2, name: 'Planta Norte' },
];

const MAQUINAS = [
  { id: 5, name: 'Compressor A1', codigo: 'COMP-A1', discipline_id: 1, plant_id: 1 },
  { id: 6, name: 'Pump E4', codigo: 'PUMP-E4', discipline_id: 1, plant_id: 1 },
  { id: 9, name: 'Molino SAG', codigo: 'SAG-1', discipline_id: 1, plant_id: 2 },
];

const doc = (parcial: Partial<Documento> = {}): Documento => ({
  id: 1,
  empresa_id: 1,
  empresa_nombre: 'Planta Demo',
  title: 'Manual A1',
  notes: null,
  original_name: 'a1.pdf',
  content_type: 'application/pdf',
  size_bytes: 2048,
  chunks_indexed: 3,
  activo: true,
  created_at: '2026-11-10T10:00:00Z',
  subido_por: 'Ana',
  maquina_id: null,
  maquina_nombre: null,
  maquina_codigo: null,
  ...parcial,
});

describe('Documentos: máquina del catálogo (HU-23)', () => {
  let http: HttpTestingController;

  function setup(role: string, documentos: Documento[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { user: () => ({ role, name: 'T', empresa_id: 1, empresa_nombre: 'Planta Demo' }) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DocumentosComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/documents')).flush(documentos);
    http.expectOne((r) => r.url.endsWith('/machines')).flush(MAQUINAS);
    http.expectOne((r) => r.url.endsWith('/plants')).flush(PLANTAS);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => http.verify());

  const selectFila = (el: HTMLElement) => el.querySelector<HTMLSelectElement>('[data-testid="doc-maquina-fila"]')!;

  function elegir(select: HTMLSelectElement, valor: string) {
    select.value = valor;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('el listado muestra la máquina asignada en el selector de la fila', () => {
    const { el } = setup('engineer', [doc({ maquina_id: 6, maquina_nombre: 'Pump E4', maquina_codigo: 'PUMP-E4' })]);

    const select = selectFila(el);
    expect(select.value).toBe('6');
    expect(select.selectedOptions[0].textContent).toContain('Pump E4');
  });

  it('un documento sin máquina queda en «Sin máquina»', () => {
    const { el } = setup('engineer', [doc()]);

    expect(selectFila(el).value).toBe('');
  });

  it('los selectores agrupan las máquinas por planta', () => {
    const { el } = setup('engineer', [doc()]);

    const grupos = Array.from(selectFila(el).querySelectorAll('optgroup')).map((g) => g.label);
    expect(grupos).toEqual(['Planta Central', 'Planta Norte']);
  });

  it('el selector de la fila tiene nombre accesible que identifica el documento', () => {
    const { el } = setup('engineer', [doc({ title: 'Manual A1' })]);

    expect(selectFila(el).getAttribute('aria-label')).toContain('Manual A1');
  });

  it('elegir una máquina envía PATCH con maquina_id y actualiza la fila', () => {
    const { fixture, el } = setup('engineer', [doc()]);

    elegir(selectFila(el), '5');
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/documents/1'));
    expect(req.request.body).toEqual({ maquina_id: 5 });
    req.flush(doc({ maquina_id: 5, maquina_nombre: 'Compressor A1', maquina_codigo: 'COMP-A1' }));
    fixture.detectChanges();

    expect(selectFila(el).value).toBe('5');
  });

  it('elegir «Sin máquina» desvincula enviando null', () => {
    const { el } = setup('engineer', [doc({ maquina_id: 5, maquina_nombre: 'Compressor A1' })]);

    elegir(selectFila(el), '');
    const req = http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/documents/1'));
    expect(req.request.body).toEqual({ maquina_id: null });
    req.flush(doc());
  });

  it('si el PATCH falla, el selector vuelve al valor guardado', () => {
    const { el } = setup('engineer', [doc({ maquina_id: 5, maquina_nombre: 'Compressor A1' })]);

    const select = selectFila(el);
    elegir(select, '9');
    http
      .expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/documents/1'))
      .flush({ detail: 'Máquina no encontrada.' }, { status: 404, statusText: 'Not Found' });

    expect(select.value).toBe('5');
  });

  it('un rol sin permiso de edición solo ve el nombre de la máquina, sin selector', () => {
    const { el } = setup('operador', [doc({ maquina_id: 6, maquina_nombre: 'Pump E4', maquina_codigo: 'PUMP-E4' })]);

    expect(selectFila(el)).toBeNull();
    expect(el.textContent).toContain('Pump E4');
  });

  it('al subir, el selector del formulario envía maquina_id en el FormData', () => {
    const { fixture, el } = setup('engineer', []);
    const componente = fixture.componentInstance;
    componente['file'].set(new File(['hola'], 'manual.txt', { type: 'text/plain' }));

    const selectForm = el.querySelector<HTMLSelectElement>('#doc-maquina')!;
    expect(selectForm.labels?.[0]?.textContent).toContain('Máquina');
    elegir(selectForm, '9');
    expect(componente['model']().maquina_id).toBe('9');

    componente['upload']();
    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/documents'));
    expect((req.request.body as FormData).get('maquina_id')).toBe('9');
    req.flush(doc({ id: 2, maquina_id: 9 }));
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/documents')).flush([]);
  });

  it('al subir sin máquina no envía maquina_id', () => {
    const { fixture } = setup('engineer', []);
    const componente = fixture.componentInstance;
    componente['file'].set(new File(['hola'], 'manual.txt', { type: 'text/plain' }));

    componente['upload']();
    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/documents'));
    expect((req.request.body as FormData).has('maquina_id')).toBe(false);
    req.flush(doc({ id: 2 }));
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/documents')).flush([]);
  });
});
