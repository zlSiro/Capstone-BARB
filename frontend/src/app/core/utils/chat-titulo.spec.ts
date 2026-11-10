import { describe, expect, it } from 'vitest';

import { tituloCorto } from './chat-titulo';

describe('tituloCorto', () => {
  it('deja intacto un título que ya es corto', () => {
    expect(tituloCorto('PUMP-E4 — vibrando demasiado')).toBe('PUMP-E4 — vibrando demasiado');
  });

  it('corta en palabra completa y sin puntos suspensivos', () => {
    const titulo = 'Necesito saber por qué la bomba PUMP-E4 está vibrando demasiado';
    const corto = tituloCorto(titulo);

    expect(corto.length).toBeLessThanOrEqual(48);
    expect(corto.endsWith('…')).toBe(false);
    expect(titulo.startsWith(corto)).toBe(true);
    expect(titulo[corto.length]).toBe(' ');
  });

  it('toma solo la primera frase de los títulos antiguos', () => {
    expect(tituloCorto('Primera frase del chat. Segunda frase larga')).toBe(
      'Primera frase del chat',
    );
  });

  it('usa un guion cuando no hay título', () => {
    expect(tituloCorto(null)).toBe('—');
    expect(tituloCorto('   ')).toBe('—');
  });
});
