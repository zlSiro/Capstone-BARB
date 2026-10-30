import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { Icon } from './icon';

function render(name: string, inputs: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ imports: [Icon] });
  const fixture = TestBed.createComponent(Icon);
  fixture.componentRef.setInput('name', name);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Icon', () => {
  it('dibuja los trazos del ícono con currentColor', () => {
    const svg = render('camara').querySelector('svg')!;
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(1);
  });

  it('es decorativo por defecto: no se anuncia a los lectores de pantalla', () => {
    const svg = render('alerta').querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
  });

  it('con `label` se anuncia como imagen con ese nombre', () => {
    const svg = render('alerta', { label: 'Atención' }).querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Atención');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });

  it('el tamaño sale del input', () => {
    const el = render('x', { size: 32 });
    expect(el.style.width).toBe('32px');
    expect(el.style.height).toBe('32px');
  });
});
