import { describe, expect, it } from 'vitest';

import { control, controlesFallidos, exportacionPermitida, igual, igualDecimal, igualMonto, suma } from './cuadratura';

describe('cuadratura', () => {
  it('con todos los controles en ✓ se puede exportar', () => {
    expect(exportacionPermitida([control('a', true, 'ok'), control('b', true, 'ok')])).toBe(true);
    expect(exportacionPermitida([])).toBe(true);
  });
  it('si un control falla, la exportación queda deshabilitada y se sabe cuál', () => {
    const cs = [control('a', true, 'ok'), control('b', false, 'no cuadra')];
    expect(exportacionPermitida(cs)).toBe(false);
    expect(controlesFallidos(cs).map((c) => c.id)).toEqual(['b']);
  });
  it('compara enteros exacto, montos al centavo y promedios al decimal', () => {
    expect(igual(3, 3)).toBe(true);
    expect(igual(3, 4)).toBe(false);
    expect(igualMonto(10.004, 10.0)).toBe(true);
    expect(igualMonto(10.01, 10.0)).toBe(false);
    expect(igualDecimal(80.04, 80.0)).toBe(true);
    expect(igualDecimal(80.06, 80.0)).toBe(false);
  });
  it('la suma no arrastra ruido de coma flotante', () => {
    expect(suma([0.1, 0.2])).toBe(0.3);
    expect(suma([])).toBe(0);
  });
});
