import { translations } from './translations';

/**
 * CGBIDA-405 (HU B / CGBIDA-51): la etiqueta visible del KPI pasó de
 * "Eficiencia Resolución" a "Cumplimiento de SLA", porque lo que mide es el
 * porcentaje de órdenes cerradas dentro del objetivo de SLA — no la productividad
 * del equipo, que es lo que sugiere el nombre anterior (y la descripción del vendor).
 *
 * La fórmula NO cambia: el campo del backend sigue llamándose `efficiency`.
 *
 * NOTA IMPORTANTE: estas claves todavía no las consume ningún componente. El dashboard
 * actual pinta un literal fijo y no usa i18n; conectarlo es CGBIDA-392. Por eso este
 * test comprueba las claves de traducción y no el render: no puede afirmar que el
 * usuario vea la etiqueta nueva hasta que 392 lo conecte.
 */
describe('etiqueta del KPI de cumplimiento (CGBIDA-405)', () => {
  const LABEL_ES = 'Cumplimiento de SLA';
  const LABEL_EN = 'SLA Compliance';
  const ANTERIOR_ES = 'Eficiencia Resolución';
  const ANTERIOR_EN = 'Resolution Efficiency';

  it('en español la etiqueta es la nueva', () => {
    expect(translations.es.financial.efficiency).toBe(LABEL_ES);
  });

  it('en inglés la etiqueta es la nueva', () => {
    expect(translations.en.financial.efficiency).toBe(LABEL_EN);
  });

  it('la etiqueta anterior ya no aparece en ningún idioma', () => {
    // Si alguien revierte el renombrado, este test falla.
    expect(translations.es.financial.efficiency).not.toBe(ANTERIOR_ES);
    expect(translations.en.financial.efficiency).not.toBe(ANTERIOR_EN);

    const serializado = JSON.stringify(translations);
    expect(serializado).not.toContain(ANTERIOR_ES);
    expect(serializado).not.toContain(ANTERIOR_EN);
  });

  it('el subtítulo se mantiene: describe correctamente lo que se mide', () => {
    expect(translations.es.financial.efficiencySub).toBe('OTs completadas dentro del SLA (24h)');
    expect(translations.en.financial.efficiencySub).toBe(
      'Work orders completed within SLA (24h)',
    );
  });

  it('la clave interna sigue llamándose `efficiency`', () => {
    // No se renombra el campo del backend: solo la etiqueta visible.
    expect(translations.es.financial).toHaveProperty('efficiency');
    expect(translations.en.financial).toHaveProperty('efficiency');
  });

  it('la nueva etiqueta no se confunde con la de MTTR ni con la de costo', () => {
    expect(translations.es.financial.efficiency).not.toBe(translations.es.financial.mttrGlobal);
    expect(translations.es.financial.efficiency).not.toBe(translations.es.financial.directCost);
    expect(translations.en.financial.efficiency).not.toBe(translations.en.financial.mttrGlobal);
  });
});
