import { describe, expect, it } from 'vitest';

import { FinancialStats } from '../../../core/models';
import { translations } from '../../../core/i18n/translations';
import { ResumenEntrada, construirResumen, duracion, fraccionExacta, reconstruirSalud } from './explicame-resumen';

type Estado = 'verde' | 'amarillo' | 'rojo' | 'insuficiente';

/** Traductor real (mismos textos que la app) sin TestBed: la función es pura y se prueba sin Angular. */
function traductor(lang: 'es' | 'en') {
  const arbol = (translations[lang] as unknown as { ayuda: Record<string, string> }).ayuda;
  return (clave: string, params: Record<string, string | number> = {}): string => {
    const texto = arbol[clave.replace(/^ayuda\./, '')];
    if (texto === undefined) throw new Error(`falta la clave ${clave}`);
    return texto.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] === undefined ? m : String(params[k])));
  };
}

const numeroDe = (lang: 'es' | 'en') => (valor: number, decimales: number) =>
  new Intl.NumberFormat(lang === 'es' ? 'es-CL' : 'en-US', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(valor);

function stats(over: { salud?: Partial<FinancialStats['salud_operacional']>; financials?: Record<string, unknown>; visibles?: boolean } = {}): FinancialStats {
  return {
    financials: {
      ahorro_generado: 0,
      disponibilidad_planta: 97.4,
      mttr: 312,
      efficiency: 87.5,
      costo_total_acumulado: 4_860_000,
      mtbfHours: 223.6,
      mtbf_visible: true,
      ...over.financials,
    },
    trend14Days: [],
    machines: [],
    por_tipo: [],
    estancadas: { total: 2, vencidas: 0, demoradas: 2, umbral_dias: 7 },
    salud_operacional: { estado: 'amarillo', motivo: '2 OT(s) demorada(s) en curso.', sla: 87.5, estancadas: 2, vencidas: 0, ...over.salud },
    ...(over.visibles === undefined ? {} : { financieros_visibles: over.visibles }),
  } as unknown as FinancialStats;
}

function entrada(lang: 'es' | 'en', s: FinancialStats, rango: ResumenEntrada['rango'] = 30): ResumenEntrada {
  return {
    stats: s,
    rango,
    idioma: lang,
    t: traductor(lang),
    moneda: (v) => `$${new Intl.NumberFormat('es-CL').format(Math.round(v))}`,
    mtbf: (h) => `${numeroDe(lang)(h / 24, 1)} d`,
    numero: numeroDe(lang),
    mtbfSinDatos: 'Requiere historial mín. 2 fallas',
  };
}

const frase = (lang: 'es' | 'en', s: FinancialStats, id: string, rango: ResumenEntrada['rango'] = 30) =>
  construirResumen(entrada(lang, s, rango)).find((f) => f.id === id);

describe('construirResumen: orden y contenido', () => {
  it('devuelve las frases en el orden pedido: Salud, SLA, Disponibilidad, MTTR, MTBF, Costo', () => {
    expect(construirResumen(entrada('es', stats())).map((f) => f.id)).toEqual(['salud', 'sla', 'disponibilidad', 'mttr', 'mtbf', 'costo']);
  });

  it('es pura: no modifica la respuesta que recibe y da lo mismo cada vez', () => {
    const s = stats();
    const copia = JSON.stringify(s);
    const a = construirResumen(entrada('es', s));
    const b = construirResumen(entrada('es', s));
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(copia);
  });

  it('no inventa datos: una cifra que no llegó omite su frase', () => {
    const s = stats({ financials: { disponibilidad_planta: undefined, mttr: undefined, efficiency: undefined, costo_total_acumulado: undefined } });
    (s as unknown as { salud_operacional?: unknown }).salud_operacional = undefined;
    expect(construirResumen(entrada('es', s)).map((f) => f.id)).toEqual(['mtbf']);
  });
});

describe('Salud Operacional', () => {
  it('ES: copia el motivo del backend tal cual', () => {
    expect(frase('es', stats(), 'salud')!.texto).toBe('La planta está en Atención. Motivo: 2 OT(s) demorada(s) en curso.');
  });

  it('ES: el motivo se copia aunque no coincida con las reglas (no se reescribe ni se corrige)', () => {
    const f = frase('es', stats({ salud: { estado: 'rojo', motivo: 'Texto raro del backend.' } }), 'salud')!;
    expect(f.texto).toBe('La planta está en Crítico. Motivo: Texto raro del backend.');
  });

  it('ES: traduce el estado (Saludable, Atención, Crítico, Sin datos)', () => {
    const texto = (estado: Estado) => frase('es', stats({ salud: { estado, motivo: 'x' } }), 'salud')!.texto;
    expect(texto('verde')).toContain('Saludable');
    expect(texto('amarillo')).toContain('Atención');
    expect(texto('rojo')).toContain('Crítico');
    expect(texto('insuficiente')).toContain('Sin datos');
  });

  it('ES: sin motivo muestra el estado con las cifras de SLA y OT vencidas', () => {
    const f = frase('es', stats({ salud: { estado: 'amarillo', motivo: '' } }), 'salud')!;
    expect(f.texto).toBe('La planta está en Atención. SLA 87,5 % y 0 OT vencida(s).');
  });

  describe('EN: se reconstruye con los campos estructurados (nunca se traduce a mano el texto del backend)', () => {
    it.each([
      ['crítico por OT vencidas', { estado: 'rojo', vencidas: 3, estancadas: 3, sla: 99 }, 'The plant is in Critical. Reason: 3 overdue work order(s) not closed.'],
      ['crítico por SLA bajo el piso', { estado: 'rojo', vencidas: 0, estancadas: 0, sla: 80 }, 'The plant is in Critical. Reason: SLA 80.0 % is below the 85 % floor.'],
      ['atención por OT demoradas', { estado: 'amarillo', vencidas: 0, estancadas: 2, sla: 99 }, 'The plant is in Warning. Reason: 2 work order(s) delayed in progress.'],
      ['atención por SLA bajo el objetivo', { estado: 'amarillo', vencidas: 0, estancadas: 0, sla: 90.5 }, 'The plant is in Warning. Reason: SLA 90.5 % is below the 95 % target.'],
      ['saludable', { estado: 'verde', vencidas: 0, estancadas: 0, sla: 97 }, 'The plant is in Healthy. Reason: No overdue or delayed work orders and SLA above the target.'],
    ] as const)('%s', (_nombre, salud, esperado) => {
      // El `motivo` en español viene del backend y NO debe aparecer en inglés.
      const f = frase('en', stats({ salud: { ...salud, motivo: 'TEXTO EN ESPAÑOL DEL BACKEND' } }), 'salud')!;
      expect(f.texto).toBe(esperado);
      expect(f.texto).not.toContain('ESPAÑOL');
    });

    it('si las reglas no reproducen el estado del backend, muestra el estado con cifras y sin motivo', () => {
      // El backend dice «verde» pero hay 3 OT vencidas: no se puede reconstruir con exactitud.
      const f = frase('en', stats({ salud: { estado: 'verde', vencidas: 3, estancadas: 3, sla: 90, motivo: 'algo' } }), 'salud')!;
      expect(f.texto).toBe('The plant is in Healthy. SLA 90.0 % and 3 overdue work order(s).');
      expect(f.texto).not.toContain('Reason');
    });

    it('«Sin datos» (insuficiente) va sin motivo', () => {
      const f = frase('en', stats({ salud: { estado: 'insuficiente', vencidas: 0, estancadas: 0, sla: 0, motivo: 'Sin datos' } }), 'salud')!;
      expect(f.texto).toBe('The plant is in No data. SLA 0.0 % and 0 overdue work order(s).');
    });

    it('usa las mismas reglas del backend (95 % objetivo, 85 % piso)', () => {
      const base = { motivo: '', estancadas: 0, vencidas: 0 };
      expect(reconstruirSalud({ ...base, estado: 'verde', sla: 95 }).estado).toBe('verde');
      expect(reconstruirSalud({ ...base, estado: 'verde', sla: 94.9 }).estado).toBe('amarillo');
      expect(reconstruirSalud({ ...base, estado: 'verde', sla: 85 }).estado).toBe('amarillo');
      expect(reconstruirSalud({ ...base, estado: 'verde', sla: 84.9 }).estado).toBe('rojo');
      expect(reconstruirSalud({ ...base, estado: 'verde', sla: 99, vencidas: 1 }).estado).toBe('rojo');
      expect(reconstruirSalud({ ...base, estado: 'verde', sla: 99, estancadas: 1 }).estado).toBe('amarillo');
    });
  });
});

describe('Cumplimiento de SLA', () => {
  it('con fracción exacta: «de cada 8 OT cerradas, 7…», y compara con el objetivo y el piso', () => {
    const f = frase('es', stats({ financials: { efficiency: 87.5 } }), 'sla')!;
    expect(f.titulo).toBe('Cumplimiento de SLA · 87,5 %');
    expect(f.texto).toBe('De cada 8 OT cerradas, 7 se cerraron dentro de 24 h. Está bajo el objetivo de 95 % y sobre el piso de 85 %.');
  });

  it('sin fracción exacta deja solo el porcentaje y la comparación', () => {
    const f = frase('es', stats({ financials: { efficiency: 97.7 } }), 'sla')!;
    expect(f.titulo).toBe('Cumplimiento de SLA · 97,7 %');
    expect(f.texto).toBe('Cumple el objetivo de 95 %.');
    expect(f.texto).not.toContain('De cada');
  });

  it('con una sola OT cerrada a tiempo usa el singular', () => {
    expect(frase('es', stats({ financials: { efficiency: 50 } }), 'sla')!.texto).toContain('De cada 2 OT cerradas, 1 se cerró dentro de 24 h.');
  });

  it('bajo el piso de 85 %', () => {
    expect(frase('es', stats({ financials: { efficiency: 70 } }), 'sla')!.texto).toBe('De cada 10 OT cerradas, 7 se cerraron dentro de 24 h. Está bajo el piso de 85 %.');
  });

  it.each([0, 100])('%s %% no usa fracción', (pct) => {
    expect(frase('es', stats({ financials: { efficiency: pct } }), 'sla')!.texto).not.toContain('De cada');
  });

  it('en inglés usa punto decimal y su plantilla', () => {
    const f = frase('en', stats({ financials: { efficiency: 87.5 } }), 'sla')!;
    expect(f.titulo).toBe('SLA compliance · 87.5 %');
    expect(f.texto).toBe('Out of every 8 closed work orders, 7 were closed within 24 h. It is below the 95 % target and above the 85 % floor.');
  });

  describe('fraccionExacta', () => {
    it.each([
      [87.5, { n: 8, k: 7 }],
      [50, { n: 2, k: 1 }],
      [66.7, { n: 3, k: 2 }],
      [33.3, { n: 3, k: 1 }],
      [90, { n: 10, k: 9 }],
    ])('%s %% = %o', (pct, esperado) => expect(fraccionExacta(pct)).toEqual(esperado));

    it.each([97.7, 87.4, 0, 100, 91.3, NaN])('%s no es una fracción exacta con denominador ≤ 10', (pct) => expect(fraccionExacta(pct)).toBeNull());
  });
});

describe('Disponibilidad', () => {
  it('con un rango numérico agrega las horas aproximadas sobre días × 24', () => {
    const f = frase('es', stats({ financials: { disponibilidad_planta: 97.4 } }), 'disponibilidad', 30)!;
    expect(f.titulo).toBe('Disponibilidad · 97,4 %');
    expect(f.texto).toBe('Los equipos estuvieron detenidos el 2,6 % del período: unas 18,7 h de 720 h.');
  });

  it.each([
    [7, '168'],
    [30, '720'],
    [90, '2.160'],
  ] as const)('%s días → %s h del período', (dias, total) => {
    expect(frase('es', stats(), 'disponibilidad', dias)!.texto).toContain(`de ${total} h`);
  });

  it('en «Histórico» no muestra horas', () => {
    const f = frase('es', stats({ financials: { disponibilidad_planta: 97.4 } }), 'disponibilidad', 'all')!;
    expect(f.texto).toBe('Los equipos estuvieron detenidos el 2,6 % del período.');
    expect(f.texto).not.toMatch(/\d h/);
  });

  it('en inglés usa punto decimal', () => {
    expect(frase('en', stats(), 'disponibilidad', 30)!.texto).toBe('The equipment was stopped 2.6 % of the period: about 18.7 h out of 720 h.');
  });
});

describe('MTTR', () => {
  it.each([
    [312, '5 h 12 min'],
    [45, '45 min'],
    [60, '1 h 0 min'],
    [59.6, '1 h 0 min'],
    [0, '0 min'],
    [1440, '24 h 0 min'],
  ])('%s min → %s', (min, esperado) => expect(duracion(min)).toBe(esperado));

  it('la frase muestra los minutos y la conversión a horas', () => {
    const f = frase('es', stats(), 'mttr')!;
    expect(f.titulo).toBe('MTTR · 312 min');
    expect(f.texto).toBe('Reparar una OT cerrada tomó en promedio 5 h 12 min.');
  });
});

describe('MTBF', () => {
  it('muestra el valor con la unidad elegida por el usuario', () => {
    const f = frase('es', stats(), 'mtbf')!;
    expect(f.titulo).toBe('MTBF · 9,3 d');
    expect(f.texto).toBe('Tiempo promedio entre fallas correctivas en el último año.');
  });

  it('con MTBF nulo usa el texto que el dashboard ya tiene', () => {
    const f = frase('es', stats({ financials: { mtbfHours: null } }), 'mtbf')!;
    expect(f.titulo).toBe('MTBF');
    expect(f.texto).toBe('Requiere historial mín. 2 fallas');
  });

  it('con mtbf_visible falso (rango corto) tampoco muestra un número', () => {
    const f = frase('es', stats({ financials: { mtbf_visible: false } }), 'mtbf')!;
    expect(f.texto).toBe('Requiere historial mín. 2 fallas');
    expect(f.titulo).not.toMatch(/\d/);
  });
});

describe('Costo directo', () => {
  it('aparece con la moneda activa y un enlace al desglose por máquina', () => {
    const f = frase('es', stats(), 'costo')!;
    expect(f.titulo).toBe('Costo directo · $4.860.000');
    expect(f.texto).toBe('Repuestos y servicios de las OT no canceladas.');
    expect(f.enlace).toBe('costos');
  });

  it('con financieros_visibles === false no se arma, ni aunque el monto estuviera', () => {
    expect(frase('es', stats({ visibles: false }), 'costo')).toBeUndefined();
    expect(JSON.stringify(construirResumen(entrada('es', stats({ visibles: false }))))).not.toContain('4.860.000');
  });

  it('si el backend omitió el costo (otro perfil), la frase no se arma', () => {
    expect(frase('es', stats({ financials: { costo_total_acumulado: undefined } }), 'costo')).toBeUndefined();
  });

  it('con financieros_visibles true o ausente sí aparece', () => {
    expect(frase('es', stats({ visibles: true }), 'costo')).toBeDefined();
    expect(frase('es', stats(), 'costo')).toBeDefined();
  });
});

describe('Idioma', () => {
  it('en inglés ninguna frase conserva texto de las plantillas en español', () => {
    const textos = construirResumen(entrada('en', stats())).map((f) => `${f.titulo} ${f.texto}`).join(' ');
    expect(textos).not.toMatch(/Cumplimiento|Disponibilidad|Reparar|Tiempo promedio|Repuestos|La planta está|demorada|vencida/);
  });

  it('los números siguen el idioma: coma decimal en español, punto en inglés', () => {
    const es = construirResumen(entrada('es', stats())).map((f) => f.titulo).join(' ');
    const en = construirResumen(entrada('en', stats())).map((f) => f.titulo).join(' ');
    expect(es).toContain('87,5 %');
    expect(en).toContain('87.5 %');
  });
});
