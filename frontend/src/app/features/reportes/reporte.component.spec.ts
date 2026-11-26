import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../core/services/auth.service';
import { CAT, ot, stats } from './fixtures';
import { ReporteComponent } from './reporte.component';

@Component({ template: '' })
class Vacio {}

const DIA = 86_400_000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA).toISOString();

function preparar(role: string, id: string, query: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', component: Vacio }]),
      { provide: AuthService, useValue: { user: signal({ id: 5, role, name: 'Ana', empresa_nombre: 'Demo SA' }), isLoggedIn: () => true } },
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id })), queryParamMap: of(convertToParamMap(query)) } },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  // La URL no se navega de verdad: se comprueba a dónde se pidió ir.
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(ReporteComponent);
  fixture.detectChanges();
  return { http, fixture, navegar };
}

/** Responde los 4 catálogos que el reporte pide al abrir. */
function catalogos(http: HttpTestingController) {
  http.expectOne((r) => r.url.endsWith('/plants')).flush(CAT.plantas);
  http.expectOne((r) => r.url.endsWith('/disciplines')).flush(CAT.disciplinas);
  http.expectOne((r) => r.url.endsWith('/machines')).flush(CAT.maquinas);
  http.expectOne((r) => r.url.endsWith('/technicians')).flush(CAT.tecnicos);
}

const q = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

const STATS_R5 = stats({
  por_tipo: [{ tipo: 'corrective', total: 2 }, { tipo: 'preventive', total: 1 }],
  salud_operacional: { ...stats().salud_operacional, desglose: { completadas: 0, en_curso: 0, pendientes: 3, por_validar: 0, canceladas: 0, total: 3 } },
});

describe('Pantalla de un reporte', () => {
  afterEach(() => vi.restoreAllMocks());

  it('R5 cuadra contra el backend: muestra los 4 tipos y deja exportar', async () => {
    const { http, fixture } = preparar('supervisor', 'r5');
    catalogos(http);
    http.expectOne((r) => r.url.includes('/stats/financial-impact') && r.url.includes('days=30')).flush(STATS_R5);
    http.expectOne((r) => r.url.endsWith('/work-orders')).flush([ot({ tipo: 'corrective', created_at: hace(2) }), ot({ tipo: 'corrective', created_at: hace(3) }), ot({ tipo: 'preventive', created_at: hace(4) })]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(q(el, 'tarjeta-total')?.textContent).toContain('3');
    expect(el.querySelectorAll('[data-testid="fila-reporte"]').length).toBe(4); // los 4 tipos, aunque haya 0 predictivas
    expect(q(el, 'cuadratura-estado')?.textContent).toContain('Todo cuadra');
    expect((q(el, 'exportar-csv') as HTMLButtonElement).disabled).toBe(false);
    http.verify();
  });

  it('si el listado no cuadra (p. ej. el [] silencioso del backend) la exportación queda deshabilitada y se explica', () => {
    const { http, fixture } = preparar('supervisor', 'r5');
    catalogos(http);
    http.expectOne((r) => r.url.includes('/stats/financial-impact')).flush(STATS_R5);
    http.expectOne((r) => r.url.endsWith('/work-orders')).flush([]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect((q(el, 'exportar-csv') as HTMLButtonElement).disabled).toBe(true);
    expect((q(el, 'exportar-pdf') as HTMLButtonElement).disabled).toBe(true);
    expect(q(el, 'cuadratura-bloqueo')?.textContent).toContain('deshabilitada');
    expect(el.querySelector('[data-testid="control-listado"][data-ok="false"]')).not.toBeNull();
  });

  it('el CSV trae solo las columnas elegidas y las filas filtradas, con BOM, y sin costos para quien no los ve', async () => {
    const { http, fixture } = preparar('supervisor', 'r5', { cols: 't_tipo,t_total' });
    catalogos(http);
    http.expectOne((r) => r.url.includes('/stats/financial-impact')).flush(STATS_R5);
    http.expectOne((r) => r.url.endsWith('/work-orders')).flush([ot({ tipo: 'corrective', created_at: hace(2) }), ot({ tipo: 'corrective', created_at: hace(3) }), ot({ tipo: 'preventive', created_at: hace(4) })]);
    fixture.detectChanges();
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:reporte';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    (q(fixture.nativeElement, 'exportar-csv') as HTMLButtonElement).click();
    const texto = await (blob as unknown as Blob).text();
    const lineas = texto.replace('﻿', '').trim().split('\r\n');
    expect(lineas).toHaveLength(5); // encabezado + 4 tipos
    expect(lineas[0].split(';')).toHaveLength(2);
    expect(texto).not.toContain('Porcentaje');
  });

  it('un id de reporte desconocido lleva a la biblioteca', () => {
    const { navegar } = preparar('supervisor', 'r99');
    expect(navegar).toHaveBeenCalledWith(['/reportes'], { replaceUrl: true });
  });

  it('un reporte que el perfil no puede ver (R1 para un operador, R6 para un supervisor) lleva a la biblioteca', () => {
    const a = preparar('operador', 'r1');
    expect(a.navegar).toHaveBeenCalledWith(['/reportes'], { replaceUrl: true });
    expect(a.http.match(() => true)).toEqual([]); // no pidió ningún dato
  });

  it('R6 (costos) no se abre sin ver_kpis_financieros', () => {
    const { navegar, http } = preparar('supervisor', 'r6');
    expect(navegar).toHaveBeenCalledWith(['/reportes'], { replaceUrl: true });
    expect(http.match(() => true)).toEqual([]);
  });

  it('un filtro inválido de la URL se descarta y se avisa', () => {
    const { http, fixture } = preparar('supervisor', 'r5', { dias: '45', planta: '999' });
    catalogos(http);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(q(el, 'aviso-descartes')?.textContent).toContain('dias');
    expect(q(el, 'aviso-descartes')?.textContent).toContain('planta');
  });

  it('con un filtro de planta, el chip lo muestra y la consulta lleva planta_id', () => {
    const { http, fixture } = preparar('supervisor', 'r5', { planta: '1' });
    catalogos(http);
    http.expectOne((r) => r.url.includes('/stats/financial-impact') && r.url.includes('planta_id=1')).flush(STATS_R5);
    http.expectOne((r) => r.url.endsWith('/work-orders')).flush([]);
    fixture.detectChanges();
    expect(q(fixture.nativeElement, 'chips')?.textContent).toContain('Norte');
  });

  it('R3 es una foto del momento: pide los KPIs sin days', () => {
    const { http, fixture } = preparar('supervisor', 'r3');
    catalogos(http);
    const sinDias = http.expectOne((r) => r.url.includes('/stats/financial-impact'));
    expect(sinDias.request.url).not.toContain('days=');
    sinDias.flush(stats());
    http.expectOne((r) => r.url.endsWith('/work-orders')).flush([]);
    fixture.detectChanges();
    expect(q(fixture.nativeElement, 'tarjeta-vencidas')?.textContent).toContain('Total del backend');
  });

  it('R9: sin número no pide la OT y explica qué escribir', () => {
    const { http, fixture } = preparar('tecnico', 'r9');
    catalogos(http);
    fixture.detectChanges();
    expect(http.match((r) => r.url.includes('/work-orders'))).toEqual([]);
    expect(q(fixture.nativeElement, 'aviso')?.textContent).toContain('Escribe el número');
  });
});
