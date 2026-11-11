import { describe, expect, it } from 'vitest';

import {
  ANCHO_HISTORIAL_DEFAULT,
  ANCHO_HISTORIAL_MAX,
  ANCHO_HISTORIAL_MIN,
  clampAnchoHistorial,
} from './doc-chat.component';

describe('clampAnchoHistorial', () => {
  it('respeta el rango permitido', () => {
    expect(clampAnchoHistorial(100)).toBe(ANCHO_HISTORIAL_MIN);
    expect(clampAnchoHistorial(9999)).toBe(ANCHO_HISTORIAL_MAX);
    expect(clampAnchoHistorial(500)).toBe(500);
  });

  it('redondea a píxeles enteros', () => {
    expect(clampAnchoHistorial(440.6)).toBe(441);
    expect(clampAnchoHistorial(439.4)).toBe(439);
  });

  it('vuelve al ancho por defecto si el valor no es numérico', () => {
    expect(clampAnchoHistorial(Number.NaN)).toBe(ANCHO_HISTORIAL_DEFAULT);
    expect(clampAnchoHistorial(Number.POSITIVE_INFINITY)).toBe(ANCHO_HISTORIAL_DEFAULT);
  });
});
