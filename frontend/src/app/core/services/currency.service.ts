import { Injectable, computed, signal } from '@angular/core';

/**
 * Moneda de presentación del dashboard (CGBIDA-432).
 *
 * LOS DATOS BASE ESTÁN EN CLP. El backend sigue calculando en pesos; este servicio solo
 * convierte para mostrar. Es una decisión de producto tomada al resolver el bloqueante de
 * la deuda A.1: el rótulo «US$2.000/min» del modelo era el error, no las cifras.
 *
 * La tasa viene de mindicador.cl, que no pide API key y devuelve CORS `*`, así que el
 * navegador puede llamarla directo sin proxy de backend.
 */
export type Moneda = 'CLP' | 'USD';

const CLAVE_MONEDA = 'barb.currency';
const CLAVE_TASA = 'barb.usdRate';

/** La tasa se refresca una vez al día: es un valor observado diario, no intradía. */
export const TTL_MS = 24 * 60 * 60 * 1000;

export const URL_DOLAR = 'https://mindicador.cl/api/dolar';

interface TasaCache {
  /** Pesos por dólar. */
  valor: number;
  /** Fecha que informa la propia API para esa observación. */
  fecha: string;
  /** Momento local en que se guardó, para aplicar el TTL. */
  obtenidaEn: number;
}

/**
 * Servicio de moneda del dashboard.
 *
 * Persiste la preferencia en `localStorage` para que sobreviva a la navegación, y cachea la
 * tasa 24 h para no golpear la API en cada carga. Si la API falla y hay caché vencida, usa
 * la vencida antes que quedarse sin número: es una demo, no un sistema de pagos.
 */
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly _moneda = signal<Moneda>(leerMonedaGuardada());
  private readonly _tasa = signal<TasaCache | null>(leerTasaGuardada());
  private readonly _error = signal(false);

  /** Moneda activa. */
  readonly moneda = this._moneda.asReadonly();

  /** Pesos por dólar, o `null` si nunca se pudo obtener. */
  readonly tasa = computed(() => this._tasa()?.valor ?? null);

  /** Fecha de la observación de la tasa, tal como la informa mindicador.cl. */
  readonly fechaTasa = computed(() => this._tasa()?.fecha ?? null);

  /**
   * `true` si se pidió USD pero no hay tasa utilizable.
   *
   * En ese caso se siguen mostrando pesos: es preferible a rotular cifras en CLP como
   * dólares. La interfaz avisa con `monedaNota`.
   */
  readonly sinTasa = computed(() => this._moneda() === 'USD' && this.tasa() === null);

  /** La última consulta a la API falló. */
  readonly error = this._error.asReadonly();

  /**
   * Se llama desde el componente en `ngOnInit`, no desde el constructor.
   *
   * Así los tests controlan cuándo se dispara la petición y qué responde, en vez de
   * depender de un efecto que ocurre al inyectar el servicio.
   */
  async asegurarTasa(ahora: number = Date.now()): Promise<void> {
    const guardada = this._tasa();
    if (guardada && ahora - guardada.obtenidaEn < TTL_MS) {
      this._error.set(false);
      return;
    }
    try {
      const respuesta = await fetch(URL_DOLAR);
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const datos = (await respuesta.json()) as { serie?: { valor: number; fecha: string }[] };
      const punto = datos.serie?.[0];
      if (!punto || typeof punto.valor !== 'number' || punto.valor <= 0) {
        throw new Error('respuesta sin serie utilizable');
      }
      const nueva: TasaCache = {
        valor: punto.valor,
        fecha: punto.fecha,
        obtenidaEn: ahora,
      };
      this._tasa.set(nueva);
      this._error.set(false);
      guardarTasa(nueva);
    } catch {
      // Se conserva la caché vencida si existe: mejor una tasa de ayer que ninguna.
      this._error.set(true);
    }
  }

  setMoneda(moneda: Moneda): void {
    if (moneda === this._moneda()) return;
    this._moneda.set(moneda);
    window.localStorage.setItem(CLAVE_MONEDA, moneda);
    if (moneda === 'USD') void this.asegurarTasa();
  }

  /** Alterna CLP <-> USD. */
  toggle(): Moneda {
    const siguiente: Moneda = this._moneda() === 'CLP' ? 'USD' : 'CLP';
    this.setMoneda(siguiente);
    return siguiente;
  }

  /** Convierte un monto en pesos a la moneda activa. Sin tasa, devuelve el mismo monto. */
  convertir(valorClp: number): number {
    const t = this.tasa();
    return this._moneda() === 'USD' && t ? valorClp / t : valorClp;
  }

  /** Formatea un monto en pesos usando la moneda activa. */
  formatear(valorClp: number): string {
    const monedaEfectiva: Moneda = this.sinTasa() ? 'CLP' : this._moneda();
    return this.formatearEn(valorClp, monedaEfectiva);
  }

  /**
   * Formatea un monto CON decimales, para cifras chicas.
   *
   * Los KPI son millones y no necesitan centavos, pero los supuestos del modelo no:
   * 2.000 CLP por minuto en dólares son US$2,03, y con cero decimales se leería «US$2»,
   * que es un 1,5 % de error sobre una cifra que el usuario está comparando.
   */
  formatearDetalle(valorClp: number): string {
    const monedaEfectiva: Moneda = this.sinTasa() ? 'CLP' : this._moneda();
    const monto = monedaEfectiva === 'USD' ? this.convertir(valorClp) : valorClp;
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: monedaEfectiva,
      // En pesos los centavos no existen; en dólares sí, y a esta escala importan.
      maximumFractionDigits: monedaEfectiva === 'USD' ? 2 : 0,
      minimumFractionDigits: monedaEfectiva === 'USD' ? 2 : 0,
    }).format(monto);
  }

  /**
   * Formatea siempre en CLP, sin importar la moneda activa.
   *
   * Se usa para los montos del modelo que NO cambian con el toggle. Para los supuestos de
   * los tooltips ya no se usa: ahí se muestra la cifra en la moneda activa (CGBIDA-435).
   */
  formatearClp(valorClp: number): string {
    return this.formatearEn(valorClp, 'CLP');
  }

  /** Etiqueta corta de la moneda que se está mostrando de verdad. */
  readonly monedaEfectiva = computed<Moneda>(() => (this.sinTasa() ? 'CLP' : this._moneda()));

  private formatearEn(valor: number, moneda: Moneda): string {
    const monto = moneda === 'USD' ? this.convertir(valor) : valor;
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: moneda,
      maximumFractionDigits: 0,
    }).format(monto);
  }
}

function leerMonedaGuardada(): Moneda {
  const guardada = window.localStorage.getItem(CLAVE_MONEDA);
  return guardada === 'USD' ? 'USD' : 'CLP';
}

function leerTasaGuardada(): TasaCache | null {
  const crudo = window.localStorage.getItem(CLAVE_TASA);
  if (!crudo) return null;
  try {
    const parseada = JSON.parse(crudo) as TasaCache;
    if (typeof parseada.valor !== 'number' || parseada.valor <= 0) return null;
    return parseada;
  } catch {
    return null;
  }
}

function guardarTasa(tasa: TasaCache): void {
  window.localStorage.setItem(CLAVE_TASA, JSON.stringify(tasa));
}
