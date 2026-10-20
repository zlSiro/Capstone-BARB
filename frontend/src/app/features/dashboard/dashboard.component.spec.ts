import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { FinancialStats } from '../../core/models';
import { StatsService } from '../../core/services/stats.service';
import { DashboardComponent } from './dashboard.component';

/**
 * Tests del dashboard de KPIs (HU-16 / CGBIDA-392).
 *
 * Se verifica lo que la subtarea cierra:
 *  - Las 6 tarjetas de indicador, cada una con su valor y QUE mide.
 *  - El cambio de idioma afecta a las 6, no solo a una.
 *  - Las tarjetas tienen variante de modo oscuro.
 *  - Los estados de carga y de error, y que el error NO muestre ceros.
 *  - El estado del MTBF y del impacto cuando el rango no alcanza.
 */

/** Respuesta de ejemplo con los 6 KPIs visibles. */
function stats(overrides: Partial<FinancialStats> = {}): FinancialStats {
  return {
    financials: {
      ahorro_generado: 10_042_000,
      mttr: 88.1,
      efficiency: 97.7,
      costo_total_acumulado: 47_192_065.25,
      mtbfHours: 223.6,
      mtbf_visible: true,
    },
    impacto_anual: {
      escenario_sin_barb: 11_160_000,
      escenario_con_barb: 7_412_000,
      ahorro_proyectado: 3_748_000,
      incidentes_anuales: 31,
      impacto_visible: true,
      supuestos: { minutos_sin_barb: 180, costo_por_minuto: 2000, dias_periodo: 365 },
      supuestos_incompletos: false,
    },
    trend14Days: [],
    machines: [],
    ...overrides,
  } as FinancialStats;
}

/**
 * Monta el dashboard.
 *
 * El I18nService lee `localStorage['barb.lang']` en su constructor, asi que hay que
 * fijar el idioma ANTES de que TestBed cree el componente.
 */
function setup(
  respuesta: FinancialStats | Error = stats(),
  lang: 'es' | 'en' = 'es',
  pendiente = false
) {
  window.localStorage.setItem('barb.lang', lang);
  const fuente = new Subject<FinancialStats>();
  const getFinancialImpact = pendiente
    ? vi.fn(() => fuente.asObservable())
    : vi.fn(() => (respuesta instanceof Error ? throwError(() => respuesta) : of(respuesta)));

  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [{ provide: StatsService, useValue: { getFinancialImpact } }],
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, getFinancialImpact, fuente };
}

/** Devuelve el texto de una tarjeta concreta por su data-testid. */
function tarjeta(el: HTMLElement, clave: string): HTMLElement {
  const t = el.querySelector(`[data-testid="kpi-${clave}"]`);
  if (!t) throw new Error(`no existe la tarjeta ${clave}`);
  return t as HTMLElement;
}

// El KPI de Impacto se elimino en CGBIDA-435: su cifra vive en el grafico de abajo.
const CLAVES = ['mttr', 'sla', 'costo', 'mtbf', 'ahorro'];

describe('DashboardComponent', () => {
  describe('los 5 indicadores', () => {
    it('pide las metricas al servicio al construirse', () => {
      const { getFinancialImpact } = setup();
      expect(getFinancialImpact).toHaveBeenCalledWith('all');
    });

    it('renderiza exactamente las 5 tarjetas esperadas', () => {
      const { el } = setup();
      const claves = [...el.querySelectorAll('[data-testid^="kpi-"]')].map((n) =>
        (n as HTMLElement).dataset['testid']?.replace('kpi-', '')
      );
      expect(claves.sort()).toEqual([...CLAVES].sort());
    });

    it('cada tarjeta muestra su valor calculado', () => {
      const { el } = setup();
      expect(tarjeta(el, 'mttr').textContent).toContain('88.1m');
      expect(tarjeta(el, 'sla').textContent).toContain('97.7%');
      expect(tarjeta(el, 'mtbf').textContent).toContain('9.3 d');
      // El costo y el ahorro van formateados en CLP.
      expect(tarjeta(el, 'costo').textContent).toMatch(/47\.192\.065/);
      expect(tarjeta(el, 'ahorro').textContent).toMatch(/10\.042\.000/);
      // El impacto ya no es tarjeta: se comprueba en el grafico de escenarios.
      expect(el.textContent).toMatch(/3\.748\.000/);
    });

    it('cada tarjeta dice QUE mide, no solo el numero', () => {
      const { el } = setup();
      for (const clave of CLAVES) {
        const textos = [...tarjeta(el, clave).querySelectorAll('p')].map((p) => p.textContent ?? '');
        // Etiqueta + valor + descripcion = 3 parrafos, y la descripcion no puede ir vacia.
        expect(textos.length).toBe(3);
        expect(textos[2].trim().length).toBeGreaterThan(0);
      }
    });

    it('cada tarjeta lleva al menos una clase dark:', () => {
      const { el } = setup();
      for (const clave of CLAVES) {
        const t = tarjeta(el, clave);
        expect(t.className).toContain('dark:');
        const internos = [...t.querySelectorAll('*')].some((n) => n.className.includes('dark:'));
        expect(internos).toBe(true);
      }
    });
  });

  describe('estado del MTBF y del impacto', () => {
    it('con mtbf_visible=false muestra el aviso en vez de un numero', () => {
      const sinMtbf = stats();
      sinMtbf.financials.mtbfHours = null;
      sinMtbf.financials.mtbf_visible = false;
      const { el } = setup(sinMtbf);
      const texto = tarjeta(el, 'mtbf').textContent ?? '';
      expect(texto).toContain('Requiere historial');
      expect(texto).not.toContain('null');
    });

    it('con impacto_visible=false muestra el aviso en vez de un numero', () => {
      const sinImpacto = stats();
      sinImpacto.impacto_anual.impacto_visible = false;
      sinImpacto.impacto_anual.ahorro_proyectado = null;
      const { el } = setup(sinImpacto);
      // CGBIDA-435: el aviso vive en el grafico de escenarios, no en una tarjeta de KPI.
      const texto = el.querySelector('[data-testid="impacto-vacio"]')?.textContent ?? '';
      expect(texto).toContain('90 días');
      expect(texto).not.toContain('null');
    });

    it('con supuestos_incompletos lo refleja en el subtitulo del grafico', () => {
      const incompleto = stats();
      incompleto.impacto_anual.supuestos_incompletos = true;
      const { el } = setup(incompleto);
      // El aviso de "estimado" se mudo con el KPI al grafico.
      expect(el.querySelector('[data-testid="impacto-escenarios"]')!.textContent).toContain(
        'Estimado'
      );
    });

    it('no muestra ceros cuando el backend no puede calcular', () => {
      // Este es el criterio de la HU: avisar en vez de mostrar ceros.
      const vacio = stats();
      vacio.financials.mtbfHours = null;
      vacio.financials.mtbf_visible = false;
      vacio.impacto_anual.ahorro_proyectado = null;
      vacio.impacto_anual.impacto_visible = false;
      const { el } = setup(vacio);
      expect(tarjeta(el, 'mtbf').textContent).not.toMatch(/\b0 d\b/);
      expect(el.querySelector('[data-testid="impacto-vacio"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="valor-ahorro"]')).toBeNull();
    });
  });

  describe('i18n', () => {
    /**
     * Monta el componente en un idioma y devuelve su texto.
     *
     * `TestBed.resetTestingModule()` es imprescindible: el I18nService es
     * `providedIn: 'root'` y se cachea entre montajes, asi que sin el reset el segundo
     * `setup()` reutiliza la instancia anterior y el idioma no cambia.
     */
    function textoEn(lang: 'es' | 'en'): string {
      TestBed.resetTestingModule();
      return setup(stats(), lang).el.textContent ?? '';
    }

    it('en espanol muestra las etiquetas en espanol', () => {
      const texto = textoEn('es');
      expect(texto).toContain('MTTR Global');
      expect(texto).toContain('Cumplimiento de SLA');
      expect(texto).toContain('Costo Directo');
      expect(texto).toContain('Ahorro Generado a la fecha');
    });

    it('en ingles muestra las MISMAS 5 etiquetas traducidas', () => {
      const texto = textoEn('en');
      expect(texto).toContain('Global MTTR');
      expect(texto).toContain('SLA Compliance');
      expect(texto).toContain('Direct Cost');
      expect(texto).toContain('Savings Generated to Date');
      // El KPI de impacto se elimino: su cifra vive en el grafico de escenarios.
    });

    it('traduce las descripciones, no solo las etiquetas', () => {
      const es = textoEn('es');
      const en = textoEn('en');
      expect(es).toContain('Tiempo medio de reparacion');
      expect(en).toContain('Average repair time');
      expect(es).not.toEqual(en);
    });

    it('el titulo de la pagina cambia de idioma', () => {
      expect(textoEn('es')).toContain('Dashboard KPI');
      expect(textoEn('en')).toContain('KPI Dashboard');
    });

    it('las 5 tarjetas siguen presentes al cambiar de idioma', () => {
      TestBed.resetTestingModule();
      const { el } = setup(stats(), 'en');
      for (const clave of CLAVES) {
        expect(tarjeta(el, clave)).toBeTruthy();
      }
    });
  });

  describe('estados de carga y error', () => {
    it('mientras carga muestra el aviso y ninguna tarjeta', () => {
      const { el } = setup(stats(), 'es', true);
      expect(el.textContent).toContain('Cargando KPIs');
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(0);
    });

    it('si falla la llamada muestra el error y NO muestra tarjetas', () => {
      const { el } = setup(new Error('503'), 'es');
      expect(el.textContent).toContain('No se pudieron cargar los KPIs');
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(0);
    });

    it('el error no muestra ceros', () => {
      const { el } = setup(new Error('503'), 'es');
      const texto = el.textContent ?? '';
      expect(texto).not.toMatch(/\$\s?0\b/);
      expect(texto).not.toContain('0%');
    });

    it('el aviso de error es una alerta accesible', () => {
      const { el } = setup(new Error('503'), 'es');
      expect(el.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('el aviso de carga es un estado accesible', () => {
      const { el } = setup(stats(), 'es', true);
      expect(el.querySelector('[role="status"]')).not.toBeNull();
    });
  });

  describe('formato de moneda', () => {
    it('usa separador de miles y no muestra decimales', () => {
      const { el } = setup();
      const texto = tarjeta(el, 'costo').textContent ?? '';
      expect(texto).toMatch(/47\.192\.065/);
      expect(texto).not.toMatch(/47\.192\.065[.,]\d/);
    });
  });

  // ===========================================================================
  // Selector de rango temporal (CGBIDA-397)
  // ===========================================================================
  describe('selector de rango temporal', () => {
    /** Cambia el select y devuelve el control para inspeccionarlo. */
    function cambiar(el: HTMLElement, valor: string): HTMLSelectElement {
      const select = el.querySelector('[data-testid="selector-rango"]') as HTMLSelectElement;
      if (!select) throw new Error('no existe el selector de rango');
      select.value = valor;
      select.dispatchEvent(new Event('change'));
      return select;
    }

    it('ofrece los cuatro rangos del legacy: 7, 30, 90 y todo', () => {
      const { el } = setup();
      const valores = [...el.querySelectorAll('[data-testid^="rango-"]')].map((n) =>
        (n as HTMLOptionElement).value
      );
      expect(valores).toEqual(['7', '30', '90', 'all']);
    });

    it('arranca en historico completo, como el legacy', () => {
      const { el, getFinancialImpact } = setup();
      const select = el.querySelector('[data-testid="selector-rango"]') as HTMLSelectElement;
      expect(select.value).toBe('all');
      expect(getFinancialImpact).toHaveBeenCalledWith('all');
    });

    it('elegir 30 dias pide las metricas de ese rango', () => {
      const { el, getFinancialImpact } = setup();
      cambiar(el, '30');
      expect(getFinancialImpact).toHaveBeenCalledTimes(2);
      expect(getFinancialImpact).toHaveBeenLastCalledWith(30);
    });

    it('el numero se manda como numero, no como texto', () => {
      // El select entrega strings; el componente debe convertir a numero antes de pedir.
      const { el, getFinancialImpact } = setup();
      cambiar(el, '7');
      const llamadas = getFinancialImpact.mock.calls as unknown as unknown[][];
      const argumento = llamadas[llamadas.length - 1][0];
      expect(argumento).toBe(7);
      expect(typeof argumento).toBe('number');
    });

    it('volver a historico completo quita el parametro', () => {
      const { el, getFinancialImpact } = setup();
      cambiar(el, '90');
      expect(getFinancialImpact).toHaveBeenLastCalledWith(90);
      cambiar(el, 'all');
      expect(getFinancialImpact).toHaveBeenLastCalledWith('all');
    });

    it('el rango elegido queda reflejado en el control', () => {
      const { el, fixture } = setup();
      const select = cambiar(el, '90');
      fixture.detectChanges();
      expect(select.value).toBe('90');
      const elegida = el.querySelector('[data-testid="rango-90"]') as HTMLOptionElement;
      expect(elegida).not.toBeNull();
      expect(elegida.textContent).toContain('90');
    });

    it('elegir el mismo rango dos veces no vuelve a pedir las metricas', () => {
      // Evita un refetch inutil al re-seleccionar la opcion ya activa.
      const { el, getFinancialImpact } = setup();
      cambiar(el, '30');
      const llamadas = getFinancialImpact.mock.calls.length;
      cambiar(el, '30');
      expect(getFinancialImpact.mock.calls.length).toBe(llamadas);
    });

    it('cada opcion se traduce', () => {
      // El reset es imprescindible: I18nService es `providedIn: 'root'` y se cachea
      // entre montajes, asi que sin el el segundo setup reutiliza el idioma anterior.
      TestBed.resetTestingModule();
      const es = setup(stats(), 'es').el.textContent ?? '';
      expect(es).toContain('Últimos 7 días');
      expect(es).toContain('Últimos 30 días');
      expect(es).toContain('Últimos 90 días');
      expect(es).toContain('Histórico');

      TestBed.resetTestingModule();
      const en = setup(stats(), 'en').el.textContent ?? '';
      expect(en).toContain('Last 7 days');
      expect(en).toContain('Last 90 days');
      expect(en).toContain('All Time');
    });

    it('el selector tiene etiqueta accesible', () => {
      const { el } = setup();
      const label = el.querySelector('label[for="rango-temporal"]');
      expect(label).not.toBeNull();
      expect(label!.textContent).toContain('Período');
    });

    it('el error del rango pedido muestra el aviso, no ceros', () => {
      const { el, fixture } = setup(new Error('503'));
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(0);

      // Volver a intentar con otro rango debe seguir mostrando el aviso.
      const select = el.querySelector('[data-testid="selector-rango"]') as HTMLSelectElement;
      select.value = '30';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(el.querySelector('[role="alert"]')).not.toBeNull();
      expect(el.textContent).not.toMatch(/\$\s?0\b/);
    });

    // -----------------------------------------------------------------------
    // El banner de estancadas NO depende del selector (lo pidio el ticket).
    // -----------------------------------------------------------------------
    it('REQUISITO: el banner de estancadas no cambia al cambiar el rango', () => {
      // El servicio devuelve la misma estancada en los dos rangos, pero un KPI distinto:
      // el banner debe quedar igual y la tarjeta si debe cambiar.
      const conRango = (mttr: number): FinancialStats =>
        stats({
          financials: {
            ahorro_generado: 10_042_000,
            mttr,
            efficiency: 97.7,
            costo_total_acumulado: 47_192_065.25,
            mtbfHours: null,
            mtbf_visible: false,
          },
          estancadas: { total: 38, vencidas: 37, demoradas: 17, umbral_dias: 7 },
        });

      window.localStorage.setItem('barb.lang', 'es');
      const respuestas = [conRango(88.1), conRango(120.5)];
      let i = 0;
      const getFinancialImpact = vi.fn(() => of(respuestas[i++]));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [DashboardComponent],
        providers: [{ provide: StatsService, useValue: { getFinancialImpact } }],
      });
      const fixture = TestBed.createComponent(DashboardComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      const bannerAntes = el.querySelector('[data-testid="banner-titulo"]')!.textContent!.trim();
      expect(bannerAntes).toContain('38');

      const select = el.querySelector('[data-testid="selector-rango"]') as HTMLSelectElement;
      select.value = '7';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      // El KPI si cambio...
      expect(tarjeta(el, 'mttr').textContent).toContain('120');
      // ...y el banner no.
      const bannerDespues = el.querySelector('[data-testid="banner-titulo"]')!.textContent!.trim();
      expect(bannerDespues).toBe(bannerAntes);
    });
  });

  // ===========================================================================
  // Tercer estado del MTBF y del impacto (CGBIDA-399)
  // ===========================================================================
  describe('el tercer estado de los indicadores condicionales', () => {
    /**
     * El MTBF tiene TRES estados, no dos, y solo dos estaban probados:
     *   1. visible y con valor   -> se muestra la cifra
     *   2. NO visible (rango)    -> aviso de "requiere historial"  [probado]
     *   3. visible pero en null  -> aviso de "requiere 2 fallas"   [sin probar]
     *
     * El comentario del componente lo dice: "el flag es lo que permite distinguir 'el
     * rango no alcanza' de 'hay pocas fallas': ambos casos dan mtbfHours null". El codigo
     * combina `mtbf_visible && mtbfHours !== null`, asi que el caso 3 existe y hay que
     * fijarlo.
     */
    it('con mtbf_visible=true pero sin valor muestra el aviso de fallas insuficientes', () => {
      const { el } = setup(
        stats({
          financials: {
            ahorro_generado: 10_042_000,
            mttr: 88.1,
            efficiency: 97.7,
            costo_total_acumulado: 47_192_065.25,
            mtbfHours: null,
            mtbf_visible: true,
          },
        })
      );
      const texto = tarjeta(el, 'mtbf').textContent ?? '';
      expect(texto).toContain('Requiere historial min. 2 fallas');
      // No debe aparecer como si fuera un valor.
      expect(texto).not.toMatch(/\d+\s*h\b/);
    });

    it('el aviso de MTBF por fallas insuficientes usa el color de advertencia', () => {
      const { el } = setup(
        stats({
          financials: {
            ahorro_generado: 10_042_000,
            mttr: 88.1,
            efficiency: 97.7,
            costo_total_acumulado: 47_192_065.25,
            mtbfHours: null,
            mtbf_visible: true,
          },
        })
      );
      const valor = tarjeta(el, 'mtbf').querySelectorAll('p')[1];
      expect(valor.className).toContain('amber');
    });

    it('con impacto_visible=true pero sin valor muestra el aviso de rango', () => {
      // Mismo tercer estado, del lado del impacto: el flag dice que el rango alcanza,
      // pero el backend no pudo calcular la cifra.
      const { el } = setup(
        stats({
          impacto_anual: {
            escenario_sin_barb: null,
            escenario_con_barb: null,
            ahorro_proyectado: null,
            incidentes_anuales: 0,
            impacto_visible: true,
            supuestos: { minutos_sin_barb: 180, costo_por_minuto: 2000, dias_periodo: 365 },
            supuestos_incompletos: true,
          } as never,
        })
      );
      // CGBIDA-435: el aviso se muestra en el grafico de escenarios.
      const texto = el.querySelector('[data-testid="impacto-vacio"]')?.textContent ?? '';
      expect(texto).toContain('Requiere al menos 90 días de historial para proyectar.');
    });
  });

  // ===========================================================================
  // Tolerancia a campos ausentes (CGBIDA-399)
  // ===========================================================================
  describe('tolerancia a respuestas incompletas', () => {
    /** Respuesta sin uno de los campos que agregaron 395, 396 y 393. */
    function sinCampo(campo: 'por_tipo' | 'estancadas' | 'trend14Days' | 'machines'): FinancialStats {
      const s = stats();
      delete (s as unknown as Record<string, unknown>)[campo];
      return s;
    }

    it('sin por_tipo no rompe: la dona simplemente no se dibuja', () => {
      // Caso real durante un despliegue: frontend nuevo contra backend viejo.
      const { el, fixture } = setup(sinCampo('por_tipo'));
      expect(fixture.componentInstance).toBeTruthy();
      expect(el.querySelector('[data-testid="tipo-donut"]')).toBeNull();
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(5);
    });

    it('sin estancadas no rompe: el banner no aparece', () => {
      const { el, fixture } = setup(sinCampo('estancadas'));
      expect(fixture.componentInstance).toBeTruthy();
      expect(el.querySelector('[data-testid="banner-estancadas"]')).toBeNull();
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(5);
    });

    it('sin trend14Days no rompe: el backlog no se dibuja', () => {
      const { el, fixture } = setup(sinCampo('trend14Days'));
      expect(fixture.componentInstance).toBeTruthy();
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(5);
    });

    it('sin machines no rompe: el ranking muestra su estado vacio', () => {
      const { el, fixture } = setup(sinCampo('machines'));
      expect(fixture.componentInstance).toBeTruthy();
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(5);
    });

    it('sin ningun campo nuevo la pagina sigue mostrando las 5 tarjetas', () => {
      const s = stats();
      delete (s as unknown as Record<string, unknown>)['por_tipo'];
      delete (s as unknown as Record<string, unknown>)['estancadas'];
      const { el } = setup(s);
      expect(el.querySelectorAll('[data-testid^="kpi-"]').length).toBe(5);
      expect(el.textContent).not.toContain('NaN');
      expect(el.textContent).not.toContain('undefined');
    });
  });

  // ===========================================================================
  // Conexion del dashboard con los graficos (CGBIDA-399)
  // ===========================================================================
  describe('conexion con los componentes hijos', () => {
    it('la dona recibe el por_tipo de la respuesta', () => {
      // La dona tiene sus propios tests, pero aqui se fija que el dashboard la alimente:
      // un `por_tipo` que no llegue al input dejaria el grafico vacio sin fallar.
      const { el } = setup(
        stats({
          por_tipo: [
            { tipo: 'corrective', total: 70 },
            { tipo: 'preventive', total: 30 },
          ],
        })
      );
      expect(el.querySelector('[data-testid="tipo-donut"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="dona-total"]')!.textContent!.trim()).toBe('100');
      expect(el.querySelectorAll('[data-testid^="segmento-"]').length).toBe(2);
    });

    it('el banner recibe las estancadas de la respuesta', () => {
      const { el } = setup(
        stats({ estancadas: { total: 7, vencidas: 4, demoradas: 3, umbral_dias: 7 } })
      );
      expect(el.querySelector('[data-testid="banner-estancadas"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="banner-titulo"]')!.textContent).toContain('7');
      expect(el.querySelector('[data-testid="banner-vencidas"]')!.textContent).toContain('4');
      expect(el.querySelector('[data-testid="banner-demoradas"]')!.textContent).toContain('3');
    });

    it('el ranking recibe los equipos de la respuesta', () => {
      const { el } = setup(
        stats({
          machines: [
            { id: '1', name: 'Bomba 1', total: 9, ahorroGenerado: 100_000, mttr: 40, slaCompliance: 95, costo_total: 250_000 },
          ] as never,
        })
      );
      expect(el.textContent).toContain('Bomba 1');
    });

    it('el backlog recibe la tendencia de la respuesta', () => {
      const { el } = setup(
        stats({
          trend14Days: Array.from({ length: 14 }, (_, i) => ({
            date: `2026-10-${String(i + 1).padStart(2, '0')}`,
            abiertas: i,
            cerradas: 14 - i,
          })),
        })
      );
      // Una serie de 14 puntos hace que el grafico se dibuje.
      expect(el.querySelector('svg')).not.toBeNull();
    });
  });

  // ===========================================================================
  // Moneda con valores negativos (CGBIDA-399)
  // ===========================================================================
  describe('formato de moneda con valores negativos', () => {
    it('el ahorro negativo se muestra con signo, no se recorta a cero', () => {
      // El backend puede devolver un ahorro negativo cuando el tiempo real supera el
      // supuesto del modelo (CGBIDA-406: "el ahorro negativo no se recorta"). La tarjeta
      // debe reflejarlo tal cual, no ocultarlo.
      const { el } = setup(
        stats({
          financials: {
            ahorro_generado: -3_748_000,
            mttr: 88.1,
            efficiency: 97.7,
            costo_total_acumulado: 47_192_065.25,
            mtbfHours: 223.6,
            mtbf_visible: true,
          },
        })
      );
      const texto = tarjeta(el, 'ahorro').textContent ?? '';
      expect(texto).toContain('3.748.000');
      expect(texto).toMatch(/-/);
      // No debe haberse convertido en cero.
      expect(texto).not.toMatch(/\$\s?0\b/);
    });
  });
});



/**
 * CGBIDA-432 a 434 y 437: moneda, MTBF en días y textos del feedback de Samuel.
 *
 * El fetch se stubea para que el servicio de moneda no salga a la red desde los tests.
 */
describe('DashboardComponent — feedback de Samuel', () => {
  const TASA = 984.09;

  beforeEach(() => {
    window.localStorage.clear();
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ serie: [{ valor: TASA, fecha: '2026-10-16T03:00:00.000Z' }] }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe('toggle de moneda (CGBIDA-432)', () => {
    it('ofrece CLP y USD, y arranca en CLP', () => {
      const { el } = setup();
      expect(el.querySelector('[data-testid="moneda-CLP"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="moneda-USD"]')).not.toBeNull();
      expect(
        el.querySelector('[data-testid="moneda-CLP"]')!.getAttribute('aria-pressed')
      ).toBe('true');
    });

    it('en CLP las cifras van en pesos', () => {
      const { el } = setup();
      expect(tarjeta(el, 'costo').textContent).toContain('47.192.065');
      expect(tarjeta(el, 'costo').textContent).not.toContain('US$');
    });

    it('al elegir USD convierte las tres tarjetas monetarias', async () => {
      const { fixture, el } = setup();
      (el.querySelector('[data-testid="moneda-USD"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      for (const clave of ['costo', 'ahorro']) {
        expect(tarjeta(el, clave).textContent).toContain('US$');
      }
      // El impacto ya no es tarjeta: se convierte dentro del grafico.
      expect(el.querySelector('[data-testid="valor-ahorro"]')!.textContent).toContain('US$');
      // 47.192.065 / 984,09 = 47.955
      expect(tarjeta(el, 'costo').textContent).toContain('47.955');
    });

    it('no toca las tarjetas que no son dinero', async () => {
      const { fixture, el } = setup();
      (el.querySelector('[data-testid="moneda-USD"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(tarjeta(el, 'mttr').textContent).toContain('88.1m');
      expect(tarjeta(el, 'sla').textContent).toContain('97.7%');
    });

    it('en USD muestra la tasa aplicada, para que la conversión sea auditable', async () => {
      const { fixture, el } = setup();
      (el.querySelector('[data-testid="moneda-USD"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      const nota = el.querySelector('[data-testid="moneda-tasa"]');
      expect(nota).not.toBeNull();
      expect(nota!.textContent).toContain('984,09');
    });

    it('persiste la moneda elegida', async () => {
      const { fixture, el } = setup();
      (el.querySelector('[data-testid="moneda-USD"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(window.localStorage.getItem('barb.currency')).toBe('USD');
    });

    it('el tipo de cambio se lee ANTES del toggle: [texto] [CLP|USD]', async () => {
      // Pedido de René: primero el dato, después el control que lo usa.
      const { fixture, el } = setup();
      (el.querySelector('[data-testid="moneda-USD"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      const nota = el.querySelector('[data-testid="moneda-tasa"]')!;
      const toggle = el.querySelector('[data-testid="selector-moneda"]')!;
      expect(nota).not.toBeNull();
      // `nota` precede a `toggle` en el documento.
      expect(
        nota.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
  });

  describe('MTBF y su unidad (CGBIDA-434 y 435)', () => {
    it('convierte las horas del backend a días por defecto', () => {
      const { el } = setup();
      // El fixture trae 223,6 h -> 9,3 d
      expect(tarjeta(el, 'mtbf').textContent).toContain('9.3 d');
      expect(tarjeta(el, 'mtbf').textContent).not.toContain('223.6 h');
    });

    it('el subtítulo ya NO fija la unidad: la elige el usuario', () => {
      const { el } = setup();
      const texto = tarjeta(el, 'mtbf').textContent ?? '';
      expect(texto).not.toContain('(Días)');
      expect(texto).not.toContain('(Horas)');
      expect(texto).toContain('Tiempo medio entre fallas');
    });

    it('ofrece Horas, Días y Meses en el selector', () => {
      const { el } = setup();
      const sel = el.querySelector('[data-testid="selector-unidad-mtbf"]') as HTMLSelectElement;
      expect(sel).not.toBeNull();
      const opciones = [...sel.options].map((o) => o.value);
      expect(opciones).toEqual(['horas', 'dias', 'meses']);
      expect(sel.value).toBe('dias');
    });

    it('al elegir horas muestra el valor del backend sin convertir', async () => {
      const { fixture, el } = setup();
      const sel = el.querySelector('[data-testid="selector-unidad-mtbf"]') as HTMLSelectElement;
      sel.value = 'horas';
      sel.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(tarjeta(el, 'mtbf').textContent).toContain('223.6 h');
    });

    it('al elegir meses divide por 730 h', async () => {
      const { fixture, el } = setup();
      const sel = el.querySelector('[data-testid="selector-unidad-mtbf"]') as HTMLSelectElement;
      sel.value = 'meses';
      sel.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();
      // 223,6 / 730 = 0,3
      expect(tarjeta(el, 'mtbf').textContent).toContain('0.3 mes');
    });

    it('el semáforo refleja la misma unidad que la tarjeta', async () => {
      const { fixture, el } = setup({
        ...stats(),
        salud_operacional: {
          indice: 42.8,
          estado: 'rojo',
          componentes: {
            sla: { valor: 97.7, estado: 'verde', score: 97.7 },
            mtbf: { valor: 223.6, estado: 'rojo', score: 30.6 },
            backlog: { valor: 31.8, estado: 'rojo', score: 0 },
          },
        },
      });
      // Por defecto los dos muestran días.
      expect(el.querySelector('[data-testid="componente-mtbf"]')!.textContent).toContain('9.3 d');

      const sel = el.querySelector('[data-testid="selector-unidad-mtbf"]') as HTMLSelectElement;
      sel.value = 'horas';
      sel.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el.querySelector('[data-testid="componente-mtbf"]')!.textContent).toContain('223.6 h');
    });
  });

  describe('tooltips de fórmula (CGBIDA-433)', () => {
    // El tooltip del impacto se mudo al grafico de escenarios (CGBIDA-435).
    const CON_FORMULA = ['costo', 'ahorro'];
    const SIN_FORMULA = ['mttr', 'sla', 'mtbf'];

    it('las tres tarjetas que Samuel pidió tienen tooltip', () => {
      const { el } = setup();
      for (const clave of CON_FORMULA) {
        expect(el.querySelector(`[data-testid="tooltip-kpi-${clave}"]`)).not.toBeNull();
      }
    });

    it('las que no necesitan explicación no lo tienen', () => {
      const { el } = setup();
      for (const clave of SIN_FORMULA) {
        expect(el.querySelector(`[data-testid="tooltip-kpi-${clave}"]`)).toBeNull();
      }
    });

    it('el tooltip es accesible: role tooltip y descrito por el botón', () => {
      const { el } = setup();
      const tip = el.querySelector('[data-testid="tooltip-kpi-ahorro"]')!;
      expect(tip.getAttribute('role')).toBe('tooltip');

      const boton = el.querySelector('[data-testid="info-kpi-ahorro"]')!;
      expect(boton.getAttribute('aria-describedby')).toBe(tip.getAttribute('id'));
    });

    it('el tooltip del ahorro cita el supuesto en la moneda activa', () => {
      // En CLP: el supuesto son 2.000 pesos por minuto.
      const { el } = setup();
      const texto = el.querySelector('[data-testid="tooltip-kpi-ahorro"]')!.textContent ?? '';
      expect(texto).toContain('2.000');
      expect(texto).toContain('Supuesto');
      expect(texto).not.toContain('US$');
    });

    it('con USD activo el supuesto del tooltip se convierte, no queda en CLP', async () => {
      // CGBIDA-435: antes decía «CLP» fijo aunque el toggle estuviera en dólares.
      const { fixture, el } = setup();
      (el.querySelector('[data-testid="moneda-USD"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      const texto = el.querySelector('[data-testid="tooltip-kpi-ahorro"]')!.textContent ?? '';
      // 2.000 / 984,09 = 2,03
      expect(texto).toContain('US$2,03');
      expect(texto).not.toContain('CLP');
    });

    it('el tooltip del impacto cita los 180 minutos sin BARB del modelo', () => {
      const { el } = setup();
      const texto = el.querySelector('[data-testid="tooltip-impacto"]')!.textContent ?? '';
      expect(texto).toContain('180');
    });

    it('con USD activo el tooltip avisa de la conversión', async () => {
      const { fixture, el } = setup();
      (el.querySelector('[data-testid="moneda-USD"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      const texto = el.querySelector('[data-testid="tooltip-kpi-costo"]')!.textContent ?? '';
      expect(texto).toContain('USD');
      expect(texto).toContain('mindicador.cl');
    });

    it('en CLP el tooltip no menciona conversión', () => {
      const { el } = setup();
      const texto = el.querySelector('[data-testid="tooltip-kpi-costo"]')!.textContent ?? '';
      expect(texto).not.toContain('mindicador.cl');
    });
  });

  describe('textos i18n corregidos (CGBIDA-437)', () => {
    it('el ranking se anuncia como Top 5 y por KPI', () => {
      // Con machines vacio el ranking muestra su estado vacio, no el titulo.
      const { el } = setup({
        ...stats(),
        machines: [
          {
            id: '1',
            name: 'PLC Siemens S7 Principal',
            total: 16,
            ahorroGenerado: 638_000,
            mttr: 52.7,
            slaCompliance: 100,
            costo_total: 638_000,
          },
        ],
      });
      const texto = el.textContent ?? '';
      expect(texto).toContain('Top 5 Equipos');
      expect(texto).toContain('Rendimiento por KPI');
    });

    it('la dona se anuncia como distribución por tipo', () => {
      const { el } = setup({
        ...stats(),
        por_tipo: [{ tipo: 'corrective', total: 70 }],
      });
      expect(el.textContent).toContain('Distribución por Tipo de Mantenimiento');
    });
  });
});



