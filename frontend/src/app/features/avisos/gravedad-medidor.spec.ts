import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { EstadoAvisoChip } from './estado-aviso';
import { GravedadMedidor } from './gravedad-medidor';

function gravedad(severidad: string | null) {
  TestBed.configureTestingModule({ imports: [GravedadMedidor] });
  const fixture = TestBed.createComponent(GravedadMedidor);
  fixture.componentRef.setInput('severidad', severidad);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('GravedadMedidor: no depende del color', () => {
  it.each([
    ['low', 1, 'Baja'],
    ['medium', 2, 'Media'],
    ['high', 3, 'Alta'],
    ['critical', 4, 'Crítica'],
  ])('%s llena %i barras y dice «%s»', (severidad, llenas, texto) => {
    const el = gravedad(severidad);
    const barras = Array.from(el.querySelectorAll('.items-end > span'));
    expect(barras).toHaveLength(4);
    expect(barras.filter((b) => b.className.includes('bg-current'))).toHaveLength(llenas);
    expect(el.textContent).toContain(texto);
    expect(el.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(`Gravedad ${texto}`);
  });

  it('sin gravedad se muestra como Media', () => {
    expect(gravedad(null).textContent).toContain('Media');
  });
});

describe('EstadoAvisoChip: ícono y texto', () => {
  it.each([
    ['pendiente', 'Pendiente'],
    ['con_ot', 'Con OT'],
    ['descartado', 'Descartado'],
  ])('%s', (estado, texto) => {
    TestBed.configureTestingModule({ imports: [EstadoAvisoChip] });
    const fixture = TestBed.createComponent(EstadoAvisoChip);
    fixture.componentRef.setInput('estado', estado);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(texto);
    expect(el.querySelector('svg')).not.toBeNull(); // cada estado tiene su ícono, no solo color
  });
});
