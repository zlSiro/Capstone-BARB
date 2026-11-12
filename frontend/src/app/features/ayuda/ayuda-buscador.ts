/**
 * Búsqueda local de «Pregúntale a la ayuda»: sin servidor y sin IA. Compara la pregunta con los títulos, las palabras clave y los
 * sinónimos de las guías (definidos por idioma en `textos/ayuda.ts`) y devuelve la mejor guía, o `null` si ninguna coincide.
 * Responde solo con guías existentes: nunca genera texto nuevo.
 */
export interface GuiaBusqueda {
  id: string;
  titulo: string;
  /** Palabras clave y sinónimos separados por coma («cerrar, validar, ticket»). Pueden ser varias palabras. */
  claves: string;
}

export interface ResultadoBusqueda {
  guia: GuiaBusqueda;
  puntaje: number;
}

/** Puntaje mínimo para considerar que una guía responde (un acierto en el título o dos en las palabras clave). */
export const PUNTAJE_MINIMO = 3;

const PUNTOS_TITULO = 3;
const PUNTOS_CLAVE = 2;
const PUNTOS_FRASE = 4;
const PUNTOS_GENERICA = 1;

const VACIAS: Record<'es' | 'en', ReadonlySet<string>> = {
  es: new Set('de del la el los las un una unos unas y o u a al en por para con sin que como cual cuando donde mi mis tu tus se lo le es son me puedo puede quiero quiero hago hace debo si no mas muy esto eso'.split(' ')),
  en: new Set('the a an of to in on for with without and or how do does did i my me your can could is are it its what where when which should would want to be this that'.split(' ')),
};

/** Palabras tan comunes en BARB (casi todo es una «OT») que por sí solas valen poco. */
const GENERICAS = new Set(['ot', 'ots', 'orden', 'ordenes', 'trabajo', 'wo', 'order', 'orders', 'work', 'job']);

/** Minúsculas, sin tildes ni signos, con espacios simples. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function palabras(texto: string, idioma: 'es' | 'en'): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p.length > 0 && !VACIAS[idioma].has(p));
}

/** Plural simple: «ordenes» ≈ «orden», «avisos» ≈ «aviso». */
const raiz = (p: string): string => (p.length > 3 ? p.replace(/(es|s)$/, '') : p);

function coincide(a: string, b: string): boolean {
  return a === b || raiz(a) === raiz(b);
}

/** Puntaje de una guía para una pregunta. */
export function puntuar(pregunta: string, guia: GuiaBusqueda, idioma: 'es' | 'en'): number {
  const tokens = palabras(pregunta, idioma);
  if (tokens.length === 0) return 0;
  const normalizada = ` ${normalizar(pregunta)} `;
  const titulo = palabras(guia.titulo, idioma);
  const claves = guia.claves.split(',').map((c) => normalizar(c)).filter(Boolean);
  const clavesSueltas = claves.flatMap((c) => c.split(' ')).filter((c) => !VACIAS[idioma].has(c));

  let total = 0;
  // Frases de varias palabras («por validar», «en curso»): valen más porque son más específicas.
  for (const clave of claves.filter((c) => c.includes(' '))) {
    if (normalizada.includes(` ${clave} `)) total += PUNTOS_FRASE;
  }
  for (const t of new Set(tokens)) {
    const generica = GENERICAS.has(t);
    if (titulo.some((x) => coincide(t, x))) total += generica ? PUNTOS_GENERICA : PUNTOS_TITULO;
    else if (clavesSueltas.some((c) => coincide(t, c))) total += generica ? PUNTOS_GENERICA : PUNTOS_CLAVE;
  }
  return total;
}

/** La mejor guía para la pregunta, o `null` si ninguna alcanza el puntaje mínimo. En empate gana la primera de la lista. */
export function buscarGuia(pregunta: string, guias: readonly GuiaBusqueda[], idioma: 'es' | 'en'): ResultadoBusqueda | null {
  let mejor: ResultadoBusqueda | null = null;
  for (const guia of guias) {
    const puntaje = puntuar(pregunta, guia, idioma);
    if (puntaje >= PUNTAJE_MINIMO && (!mejor || puntaje > mejor.puntaje)) mejor = { guia, puntaje };
  }
  return mejor;
}
