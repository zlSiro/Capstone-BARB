import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinancialStats } from '../../../core/models';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ExplicameComponent } from './explicame.component';

const STATS = {
  financials: {
    ahorro_generado: 0,
    disponibilidad_planta: 97.4,
    mttr: 312,
    efficiency: 87.5,
    costo_total_acumulado: 4_860_000,
    mtbfHours: 223.6,
    mtbf_visible: true,
  },
  trend14Days: [],
  machines: [],
  por_tipo: [],
  estancadas: { total: 2, vencidas: 0, demoradas: 2, umbral_dias: 7 },
  salud_operacional: { estado: 'amarillo', motivo: '2 OT(s) demorada(s) en curso.', sla: 87.5, estancadas: 2, vencidas: 0 },
} as unknown as FinancialStats;

function montar(stats: FinancialStats = STATS, rango: 7 | 30 | 90 | 'all' = 30) {
  window.localStorage.setItem('barb.lang', 'es');
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(ExplicameComponent);
  fixture.componentRef.setInput('stats', stats);
  fixture.componentRef.setInput('rango', rango);
  fixture.componentRef.setInput('etiquetaRango', 'Últimos 30 días');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const verCostos = vi.fn();
  fixture.componentInstance.verCostos.subscribe(verCostos);
  return { fixture, el, verCostos, i18n: TestBed.inject(I18nService) };
}

const q = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const abrir = async (ctx: ReturnType<typeof montar>) => {
  q(ctx.el, 'btn-explicame')!.click();
  ctx.fixture.detectChanges();
  await vi.advanceTimersByTimeAsync(10);
};

describe('ExplicameComponent (botón y panel «Explícame este dashboard»)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('muestra el botón «Explícame» con su ícono y el panel cerrado', () => {
    const { el } = montar();
    const boton = q(el, 'btn-explicame')!;
    expect(boton.textContent).toContain('Explícame');
    expect(boton.querySelector('app-icon')).not.toBeNull();
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    expect(q(el, 'explicame-panel')).toBeNull();
  });

  it('al pulsarlo abre el panel con las pestañas «Resumen» y «Cómo leerlo»', async () => {
    const ctx = montar();
    await abrir(ctx);
    const panel = q(ctx.el, 'explicame-panel')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-labelledby')).toBe('explicame-titulo');
    expect(panel.querySelector('h2')!.textContent).toContain('Explícame este dashboard');
    expect(q(ctx.el, 'btn-explicame')!.getAttribute('aria-expanded')).toBe('true');
    const tabs = Array.from(panel.querySelectorAll('[role="tab"]')).map((t) => t.textContent!.trim());
    expect(tabs).toEqual(['Resumen', 'Cómo leerlo']);
    expect(q(ctx.el, 'explicame-tab-resumen')!.getAttribute('aria-selected')).toBe('true');
  });

  it('el resumen trae las frases con las cifras del dashboard, el período y la nota', async () => {
    const ctx = montar();
    await abrir(ctx);
    expect(q(ctx.el, 'explicame-periodo')!.textContent).toContain('Período: Últimos 30 días');
    expect(q(ctx.el, 'frase-salud')!.textContent).toContain('La planta está en Atención. Motivo: 2 OT(s) demorada(s) en curso.');
    expect(q(ctx.el, 'frase-sla')!.textContent).toContain('Cumplimiento de SLA · 87,5 %');
    expect(q(ctx.el, 'frase-sla')!.textContent).toContain('De cada 8 OT cerradas, 7 se cerraron dentro de 24 h.');
    expect(q(ctx.el, 'frase-disponibilidad')!.textContent).toContain('unas 18,7 h de 720 h');
    expect(q(ctx.el, 'frase-mttr')!.textContent).toContain('5 h 12 min');
    expect(q(ctx.el, 'frase-costo')).not.toBeNull();
    expect(q(ctx.el, 'explicame-nota')!.textContent).toContain('No usa IA ni agrega datos');
  });

  it('en «Histórico» la disponibilidad no muestra horas', async () => {
    const ctx = montar(STATS, 'all');
    await abrir(ctx);
    expect(q(ctx.el, 'frase-disponibilidad')!.textContent).not.toMatch(/\d h de/);
  });

  it('la pestaña «Cómo leerlo» explica cada indicador', async () => {
    const ctx = montar();
    await abrir(ctx);
    q(ctx.el, 'explicame-tab-como')!.click();
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'explicame-tab-como')!.getAttribute('aria-selected')).toBe('true');
    expect(q(ctx.el, 'frase-sla')).toBeNull();
    for (const id of ['salud', 'sla', 'disponibilidad', 'mttr', 'mtbf', 'costo']) expect(q(ctx.el, `como-${id}`), id).not.toBeNull();
    expect(q(ctx.el, 'como-sla')!.textContent).toContain('Porcentaje de OT cerradas dentro de su plazo');
  });

  it('sin acceso a lo financiero no hay frase ni explicación de costo', async () => {
    const ctx = montar({ ...STATS, financieros_visibles: false } as FinancialStats);
    await abrir(ctx);
    expect(q(ctx.el, 'frase-costo')).toBeNull();
    expect(q(ctx.el, 'explicame-ver-costos')).toBeNull();
    q(ctx.el, 'explicame-tab-como')!.click();
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'como-costo')).toBeNull();
    expect(ctx.el.textContent).not.toContain('4.860.000');
  });

  it('«Ver detalle por máquina» cierra el panel y pide abrir el desglose que ya existe', async () => {
    const ctx = montar();
    await abrir(ctx);
    q(ctx.el, 'explicame-ver-costos')!.click();
    ctx.fixture.detectChanges();
    expect(ctx.verCostos).toHaveBeenCalledTimes(1);
    expect(q(ctx.el, 'explicame-panel')).toBeNull();
  });

  it('Esc lo cierra y el foco vuelve al botón «Explícame»', async () => {
    const ctx = montar();
    document.body.appendChild(ctx.el);
    const boton = q(ctx.el, 'btn-explicame') as HTMLButtonElement;
    boton.focus();
    await abrir(ctx);
    expect(document.activeElement).toBe(q(ctx.el, 'explicame-panel'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'explicame-panel')).toBeNull();
    expect(document.activeElement).toBe(boton);
    ctx.el.remove();
  });

  it('la X también lo cierra', async () => {
    const ctx = montar();
    await abrir(ctx);
    q(ctx.el, 'explicame-cerrar')!.click();
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'explicame-panel')).toBeNull();
  });

  it('enlaza con «Aprende BARB»', async () => {
    const ctx = montar();
    await abrir(ctx);
    expect(q(ctx.el, 'explicame-abrir-ayuda')!.getAttribute('href')).toBe('/ayuda');
  });

  it('al cambiar ES ↔ EN el texto cambia sin recrear el panel y vuelve al regresar a ES', async () => {
    const ctx = montar();
    await abrir(ctx);
    const panel = q(ctx.el, 'explicame-panel')!;
    const titulo = panel.querySelector('h2')!;
    expect(titulo.textContent).toContain('Explícame este dashboard');

    ctx.i18n.setLang('en');
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'explicame-panel')).toBe(panel);
    expect(panel.querySelector('h2')).toBe(titulo);
    expect(titulo.textContent).toContain('Explain this dashboard');
    expect(q(ctx.el, 'btn-explicame')!.textContent).toContain('Explain');
    expect(q(ctx.el, 'explicame-tab-como')!.textContent).toContain('How to read it');
    expect(q(ctx.el, 'frase-salud')!.textContent).toContain('The plant is in Warning. Reason: 2 work order(s) delayed in progress.');
    expect(q(ctx.el, 'frase-sla')!.textContent).toContain('SLA compliance · 87.5 %');
    expect(q(ctx.el, 'frase-disponibilidad')!.textContent).toContain('about 18.7 h out of 720 h');
    expect(q(ctx.el, 'explicame-nota')!.textContent).toContain('does not use AI');
    expect(panel.textContent).not.toContain('Motivo');

    ctx.i18n.setLang('es');
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'explicame-panel')).toBe(panel);
    expect(titulo.textContent).toContain('Explícame este dashboard');
    expect(q(ctx.el, 'frase-salud')!.textContent).toContain('La planta está en Atención. Motivo: 2 OT(s) demorada(s) en curso.');
  });

  it('el cambio de idioma también alcanza a «Cómo leerlo» y a los aria-label', async () => {
    const ctx = montar();
    await abrir(ctx);
    q(ctx.el, 'explicame-tab-como')!.click();
    ctx.fixture.detectChanges();
    ctx.i18n.setLang('en');
    ctx.fixture.detectChanges();
    expect(q(ctx.el, 'como-sla')!.textContent).toContain('Percentage of work orders closed within their deadline');
    expect(q(ctx.el, 'explicame-cerrar')!.getAttribute('aria-label')).toBe('Close the summary');
    expect(ctx.el.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Summary sections');
  });

  it('no llama al backend ni a la IA: sin HttpClient el componente funciona igual', async () => {
    const ctx = montar(); // este módulo de pruebas no tiene provideHttpClient
    await expect(abrir(ctx)).resolves.not.toThrow();
  });
});
