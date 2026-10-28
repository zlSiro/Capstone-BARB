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

/**
 * Subtítulo de Topología según la vista (HU-25, CGBIDA-466).
 *
 * Topología dejó de ser solo el mapa: también aloja el mantenedor de activos. "Mapa de
 * equipos por estado" no describe la pantalla cuando se ve la tabla, así que el
 * componente alterna entre dos claves.
 */
describe('subtítulo de Topología según la vista (CGBIDA-466)', () => {
  it('el subtítulo del mapa se mantiene igual', () => {
    expect(translations.es.topology.subtitle).toBe('Mapa de equipos por estado');
    expect(translations.en.topology.subtitle).toBe('Equipment map by status');
  });

  it('existe un subtítulo propio para el mantenedor, en los dos idiomas', () => {
    expect(translations.es.topology.subtitleAssets).toBe('Gestión de plantas y máquinas');
    expect(translations.en.topology.subtitleAssets).toBe('Plants and machines management');
  });

  it('los dos subtítulos son distintos: si se igualan, la vista no se distingue', () => {
    expect(translations.es.topology.subtitleAssets).not.toBe(translations.es.topology.subtitle);
    expect(translations.en.topology.subtitleAssets).not.toBe(translations.en.topology.subtitle);
  });

  it('la sección topology tiene exactamente las mismas claves en es y en', () => {
    // Una clave agregada solo en un idioma se renderizaría vacía en el otro.
    const clavesEs = Object.keys(translations.es.topology).sort();
    const clavesEn = Object.keys(translations.en.topology).sort();
    expect(clavesEn).toEqual(clavesEs);
  });
});
