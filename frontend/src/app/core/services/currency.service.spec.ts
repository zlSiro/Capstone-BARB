import { TestBed } from '@angular/core/testing';

import { CurrencyService, TTL_MS, URL_DOLAR } from './currency.service';

/**
 * CGBIDA-432: moneda de presentación del dashboard.
 *
 * Los datos base están en CLP y el backend sigue calculando en pesos. Este servicio solo
 * convierte para mostrar, con la tasa de mindicador.cl cacheada 24 h.
 *
 * Lo que estos tests blindan:
 *  - Que sin tasa NUNCA se etiquete un monto en CLP como si fuera USD.
 *  - Que la caché respete el TTL y no golpee la API en cada carga.
 *  - Que un fallo de red degrade a la última tasa conocida, no a un número inventado.
 */

const RESPUESTA_OK = {
  codigo: 'dolar',
  nombre: 'Dólar observado',
  serie: [{ fecha: '2026-10-16T03:00:00.000Z', valor: 984.09 }],
};

interface FetchFalso {
  llamadas: number;
  ultimaUrl?: string;
}

/** Instala un fetch falso y devuelve un contador de llamadas. */
function stubFetch(
  responder: () => Promise<Partial<Response>> | Partial<Response>
): FetchFalso {
  const estado: FetchFalso = { llamadas: 0 };
  globalThis.fetch = (async (url: string | URL | RequestInfo) => {
    estado.llamadas += 1;
    estado.ultimaUrl = String(url);
    const r = await responder();
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: r.json ?? (async () => RESPUESTA_OK),
    } as Response;
  }) as typeof fetch;
  return estado;
}

function crear(): CurrencyService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(CurrencyService);
}

describe('CurrencyService', () => {
  let fetchOriginal: typeof fetch;

  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    window.localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    window.localStorage.clear();
  });

  describe('moneda activa', () => {
    it('arranca en CLP: los datos base están en pesos', () => {
      stubFetch(() => ({}));
      expect(crear().moneda()).toBe('CLP');
    });

    it('lee la preferencia guardada', () => {
      window.localStorage.setItem('barb.currency', 'USD');
      stubFetch(() => ({}));
      expect(crear().moneda()).toBe('USD');
    });

    it('cambiar de moneda persiste la elección', () => {
      stubFetch(() => ({}));
      const s = crear();
      s.setMoneda('USD');
      expect(s.moneda()).toBe('USD');
      expect(window.localStorage.getItem('barb.currency')).toBe('USD');
    });

    it('toggle alterna entre CLP y USD', () => {
      stubFetch(() => ({}));
      const s = crear();
      expect(s.toggle()).toBe('USD');
      expect(s.toggle()).toBe('CLP');
    });
  });

  describe('obtención de la tasa', () => {
    it('pide la tasa a mindicador.cl y la expone', async () => {
      const f = stubFetch(() => ({}));
      const s = crear();
      await s.asegurarTasa();

      expect(f.llamadas).toBe(1);
      expect(f.ultimaUrl).toBe(URL_DOLAR);
      expect(s.tasa()).toBe(984.09);
      expect(s.fechaTasa()).toBe('2026-10-16T03:00:00.000Z');
      expect(s.error()).toBe(false);
    });

    it('usa la caché vigente sin volver a llamar a la API', async () => {
      window.localStorage.setItem(
        'barb.usdRate',
        JSON.stringify({ valor: 950, fecha: '2026-10-15', obtenidaEn: Date.now() })
      );
      const f = stubFetch(() => ({}));
      const s = crear();
      await s.asegurarTasa();

      expect(f.llamadas).toBe(0);
      expect(s.tasa()).toBe(950);
    });

    it('refresca cuando la caché venció el TTL de 24 h', async () => {
      window.localStorage.setItem(
        'barb.usdRate',
        JSON.stringify({ valor: 950, fecha: '2026-10-14', obtenidaEn: Date.now() - TTL_MS - 1000 })
      );
      const f = stubFetch(() => ({}));
      const s = crear();
      await s.asegurarTasa();

      expect(f.llamadas).toBe(1);
      expect(s.tasa()).toBe(984.09);
    });

    it('guarda la tasa nueva para la próxima carga', async () => {
      stubFetch(() => ({}));
      const s = crear();
      await s.asegurarTasa();

      const guardada = JSON.parse(window.localStorage.getItem('barb.usdRate')!);
      expect(guardada.valor).toBe(984.09);
    });

    it('si la API falla, conserva la última tasa conocida y avisa del error', async () => {
      window.localStorage.setItem(
        'barb.usdRate',
        JSON.stringify({ valor: 950, fecha: '2026-10-01', obtenidaEn: Date.now() - TTL_MS - 1000 })
      );
      stubFetch(() => {
        throw new Error('sin red');
      });
      const s = crear();
      await s.asegurarTasa();

      expect(s.tasa()).toBe(950);
      expect(s.error()).toBe(true);
    });

    it('una respuesta sin serie no rompe: deja la tasa en null', async () => {
      stubFetch(() => ({ json: async () => ({ codigo: 'dolar' }) }));
      const s = crear();
      await s.asegurarTasa();

      expect(s.tasa()).toBeNull();
      expect(s.error()).toBe(true);
    });

    it('una tasa de cero o negativa se rechaza', async () => {
      stubFetch(() => ({ json: async () => ({ serie: [{ valor: 0, fecha: 'x' }] }) }));
      const s = crear();
      await s.asegurarTasa();

      expect(s.tasa()).toBeNull();
      expect(s.error()).toBe(true);
    });

    it('con HTTP de error no acepta la respuesta', async () => {
      stubFetch(() => ({ ok: false, status: 500 }));
      const s = crear();
      await s.asegurarTasa();

      expect(s.tasa()).toBeNull();
      expect(s.error()).toBe(true);
    });
  });

  describe('formato y conversión', () => {
    async function conTasa(): Promise<CurrencyService> {
      stubFetch(() => ({}));
      const s = crear();
      await s.asegurarTasa();
      return s;
    }

    it('en CLP formatea pesos sin conversión', async () => {
      const s = await conTasa();
      expect(s.formatear(47_192_065)).toContain('47.192.065');
      expect(s.formatear(47_192_065)).not.toContain('US$');
    });

    it('en USD divide por la tasa y rotula dólares', async () => {
      const s = await conTasa();
      s.setMoneda('USD');
      // 47.192.065 / 984,09 = 47.955
      expect(s.formatear(47_192_065)).toContain('US$');
      expect(s.formatear(47_192_065)).toContain('47.955');
    });

    it('convierte sin redondear (el formato se encarga después)', async () => {
      const s = await conTasa();
      s.setMoneda('USD');
      expect(s.convertir(984.09)).toBeCloseTo(1, 5);
    });

    it('sin tasa, elegir USD sigue mostrando pesos y no miente con el rótulo', async () => {
      stubFetch(() => {
        throw new Error('sin red');
      });
      const s = crear();
      await s.asegurarTasa();
      s.setMoneda('USD');

      expect(s.sinTasa()).toBe(true);
      expect(s.moneda()).toBe('USD');
      // Clave: NO se rotula en dólares lo que está en pesos.
      expect(s.formatear(1_000_000)).not.toContain('US$');
      expect(s.formatear(1_000_000)).toContain('1.000.000');
      expect(s.monedaEfectiva()).toBe('CLP');
    });

    it('formatearClp ignora la moneda activa: sirve para explicar supuestos', async () => {
      const s = await conTasa();
      s.setMoneda('USD');
      expect(s.formatearClp(2000)).toContain('2.000');
      expect(s.formatearClp(2000)).not.toContain('US$');
    });

    describe('formatearDetalle (CGBIDA-435)', () => {
      it('en CLP no agrega centavos: en pesos no existen', async () => {
        const s = await conTasa();
        expect(s.formatearDetalle(2000)).toBe('$2.000');
      });

      it('en USD conserva dos decimales, porque a esa escala importan', async () => {
        const s = await conTasa();
        s.setMoneda('USD');
        // 2.000 / 984,09 = 2,0323 → US$2,03
        expect(s.formatearDetalle(2000)).toBe('US$2,03');
      });

      it('sin tasa cae a CLP en vez de mentir con dólares', async () => {
        stubFetch(() => {
          throw new Error('sin red');
        });
        const s = crear();
        await s.asegurarTasa();
        s.setMoneda('USD');
        expect(s.formatearDetalle(2000)).toBe('$2.000');
      });
    });
  });
});
