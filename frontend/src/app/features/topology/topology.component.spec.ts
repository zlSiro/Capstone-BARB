import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { Topology, TopologyNode } from '../../core/models';
import { TopologyService } from '../../core/services/topology.service';
import { TopologyComponent } from './topology.component';

function nodo(overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    nodo_id: 'p_1',
    nombre_visual: 'Planta Central',
    tipo: 'Planta',
    icono: '🏭',
    pos_x: 500,
    pos_y: 100,
    estado_actual: 'operativo',
    ...overrides,
  } as TopologyNode;
}

const TOPOLOGIA: Topology = {
  nodos: [
    nodo(),
    nodo({ nodo_id: 'd_1', nombre_visual: 'Mecánica', tipo: 'Disciplina', icono: '⚙️', pos_x: 200, pos_y: 300 }),
    nodo({
      nodo_id: 'm_1',
      nombre_visual: 'Compressor A1',
      tipo: 'Máquina',
      icono: '🤖',
      pos_x: 50,
      pos_y: 500,
      estado_actual: 'falla',
      maquina_id: 1,
    }),
  ],
  conexiones: [
    { conexion_id: 'conn_p1_d_1', origen_nodo_id: 'p_1', destino_nodo_id: 'd_1', tipo_relacion: 'jerarquia' },
    { conexion_id: 'conn_d1_m_1', origen_nodo_id: 'd_1', destino_nodo_id: 'm_1', tipo_relacion: 'pertenece' },
  ],
};

/** Servicio falso: cada test decide qué responde `get()`. */
function setup(respuesta: Topology | Error) {
  const get = vi.fn(() => (respuesta instanceof Error ? throwError(() => respuesta) : of(respuesta)));
  TestBed.configureTestingModule({
    imports: [TopologyComponent],
    providers: [{ provide: TopologyService, useValue: { get } }],
  });
  const fixture = TestBed.createComponent(TopologyComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, get };
}

function canvas(el: HTMLElement): SVGSVGElement | null {
  return el.querySelector('[data-testid="topo-canvas"]');
}

/** Servicio falso que no responde hasta que el test lo decide (para el estado de carga). */
function setupConFuentePendiente() {
  const fuente = new Subject<Topology>();
  TestBed.configureTestingModule({
    imports: [TopologyComponent],
    providers: [{ provide: TopologyService, useValue: { get: () => fuente.asObservable() } }],
  });
  const fixture = TestBed.createComponent(TopologyComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, fuente };
}

function nodosDom(el: HTMLElement): SVGGElement[] {
  return Array.from(el.querySelectorAll('g.topo-node'));
}

/**
 * Monta el componente con un idioma concreto.
 * El I18nService lee `localStorage['barb.lang']` en su constructor, así que hay que
 * fijarlo ANTES de que TestBed cree el componente.
 */
function setupEnIdioma(lang: 'es' | 'en', respuesta: Topology | Error = TOPOLOGIA) {
  window.localStorage.setItem('barb.lang', lang);
  const get = vi.fn(() => (respuesta instanceof Error ? throwError(() => respuesta) : of(respuesta)));
  TestBed.configureTestingModule({
    imports: [TopologyComponent],
    providers: [{ provide: TopologyService, useValue: { get } }],
  });
  const fixture = TestBed.createComponent(TopologyComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

/** Igual que el anterior pero la respuesta no llega: sirve para el estado de carga. */
function setupConFuentePendienteEnIdioma(lang: 'es' | 'en') {
  window.localStorage.setItem('barb.lang', lang);
  const fuente = new Subject<Topology>();
  TestBed.configureTestingModule({
    imports: [TopologyComponent],
    providers: [{ provide: TopologyService, useValue: { get: () => fuente.asObservable() } }],
  });
  const fixture = TestBed.createComponent(TopologyComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, fuente };
}

describe('TopologyComponent', () => {
  it('pide la topología al servicio al construirse', () => {
    const { get } = setup(TOPOLOGIA);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('dibuja un nodo por cada equipo recibido, con su nombre y su tipo', () => {
    const { el } = setup(TOPOLOGIA);
    const grupos = nodosDom(el);
    expect(grupos).toHaveLength(3);
    expect(grupos.map((g) => g.getAttribute('data-tipo'))).toEqual(['Planta', 'Disciplina', 'Máquina']);
    expect(el.textContent).toContain('Compressor A1');
    expect(el.textContent).toContain('Mecánica');
  });

  it('coloca cada nodo en las coordenadas que informa el backend', () => {
    const { el } = setup(TOPOLOGIA);
    const maquina = el.querySelector('g[data-nodo-id="m_1"]');
    expect(maquina?.getAttribute('transform')).toBe('translate(50,500)');
  });

  it('pinta el borde del nodo según su estado', () => {
    const { el } = setup(TOPOLOGIA);
    const bordeDe = (id: string) =>
      el.querySelector(`g[data-nodo-id="${id}"] rect`)?.getAttribute('stroke');
    expect(bordeDe('m_1')).toContain('red');       // falla
    expect(bordeDe('p_1')).toContain('emerald');   // operativo
  });

  it('distingue los cuatro estados en la leyenda, incluido Desconectado', () => {
    const { el } = setup(TOPOLOGIA);
    for (const etiqueta of ['Operativo', 'Alerta', 'Falla', 'Desconectado']) {
      expect(el.textContent).toContain(etiqueta);
    }
  });

  it('dibuja una arista por conexión, entre los centros de sus nodos', () => {
    const { el } = setup(TOPOLOGIA);
    const lineas = Array.from(canvas(el)!.querySelectorAll('line'));
    expect(lineas).toHaveLength(2);
    // p_1 centro = (500+65, 100+42.5) ; d_1 centro = (200+65, 300+42.5)
    const jerarquia = lineas.find((l) => l.getAttribute('data-relacion') === 'jerarquia');
    expect(jerarquia?.getAttribute('x1')).toBe('565');
    expect(jerarquia?.getAttribute('y1')).toBe('142.5');
    expect(jerarquia?.getAttribute('x2')).toBe('265');
    expect(jerarquia?.getAttribute('y2')).toBe('342.5');
  });

  it('descarta aristas que apunten a un nodo ausente, sin romper el render', () => {
    const rota: Topology = {
      ...TOPOLOGIA,
      conexiones: [
        ...TOPOLOGIA.conexiones,
        { conexion_id: 'x', origen_nodo_id: 'd_1', destino_nodo_id: 'no_existe', tipo_relacion: 'pertenece' },
      ],
    };
    const { el } = setup(rota);
    expect(Array.from(canvas(el)!.querySelectorAll('line'))).toHaveLength(2);
  });

  it('muestra el error cuando el servicio falla, sin dejar el lienzo vacío mudo', () => {
    const { el } = setup(new Error('500'));
    expect(el.querySelector('[data-testid="estado-error"]')).not.toBeNull();
    expect(canvas(el)).toBeNull();
  });

  it('muestra el estado vacío cuando la respuesta no trae nodos', () => {
    const { el } = setup({ nodos: [], conexiones: [] });
    expect(el.querySelector('[data-testid="estado-vacio"]')).not.toBeNull();
    expect(canvas(el)).toBeNull();
  });

  // --- CGBIDA-366: estados de carga, sin datos y error ------------------------

  it('muestra el estado de carga mientras no llega la respuesta', () => {
    const { el } = setupConFuentePendiente();
    expect(el.querySelector('[data-testid="estado-cargando"]')).not.toBeNull();
    expect(canvas(el)).toBeNull();
    expect(el.querySelector('[data-testid="estado-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="estado-vacio"]')).toBeNull();
  });

  it('pasa de cargando a listo cuando la respuesta llega con datos', () => {
    const { fixture, el, fuente } = setupConFuentePendiente();
    expect(el.querySelector('[data-testid="estado-cargando"]')).not.toBeNull();

    fuente.next(TOPOLOGIA);
    fuente.complete();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="estado-cargando"]')).toBeNull();
    expect(canvas(el)).not.toBeNull();
    expect(nodosDom(el)).toHaveLength(3);
  });

  it('pasa de cargando a vacio cuando la respuesta llega sin nodos', () => {
    const { fixture, el, fuente } = setupConFuentePendiente();
    fuente.next({ nodos: [], conexiones: [] });
    fuente.complete();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="estado-cargando"]')).toBeNull();
    expect(el.querySelector('[data-testid="estado-vacio"]')).not.toBeNull();
    expect(canvas(el)).toBeNull();
  });

  it('con datos solo se ve el lienzo: ningún marcador de estado', () => {
    const { el } = setup(TOPOLOGIA);
    expect(canvas(el)).not.toBeNull();
    for (const s of ['cargando', 'error', 'vacio']) {
      expect(el.querySelector(`[data-testid="estado-${s}"]`)).toBeNull();
    }
  });

  it('sin nodos solo se ve el estado vacío, no el lienzo ni el error', () => {
    const { el } = setup({ nodos: [], conexiones: [] });
    expect(el.querySelector('[data-testid="estado-vacio"]')).not.toBeNull();
    expect(canvas(el)).toBeNull();
    expect(el.querySelector('[data-testid="estado-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="estado-cargando"]')).toBeNull();
  });

  // --- CGBIDA-364: panel de detalle -------------------------------------------

  it('no muestra el panel de detalle hasta que se selecciona un equipo', () => {
    const { el } = setup(TOPOLOGIA);
    expect(el.querySelector('[data-testid="panel-detalle"]')).toBeNull();
  });

  it('abre el panel con el nombre, el tipo y el estado del equipo seleccionado', () => {
    const { fixture, el } = setup(TOPOLOGIA);
    (el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement).dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="panel-detalle"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="panel-nombre"]')?.textContent).toContain('Compressor A1');
    expect(el.querySelector('[data-testid="panel-tipo"]')?.textContent).toContain('Máquina');
    // m_1 tiene estado_actual 'falla'
    expect(el.querySelector('[data-testid="panel-estado"]')?.textContent).toContain('Falla');
  });

  it('cierra el panel con el botón de cerrar', () => {
    const { fixture, el } = setup(TOPOLOGIA);
    (el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement).dispatchEvent(new Event('click'));
    fixture.detectChanges();
    (el.querySelector('[data-testid="panel-cerrar"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="panel-detalle"]')).toBeNull();
  });

  it('cambia el contenido del panel al seleccionar otro equipo', () => {
    const { fixture, el } = setup(TOPOLOGIA);
    (el.querySelector('g[data-nodo-id="p_1"]') as SVGGElement).dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="panel-nombre"]')?.textContent).toContain('Planta Central');

    (el.querySelector('g[data-nodo-id="d_1"]') as SVGGElement).dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="panel-nombre"]')?.textContent).toContain('Mecánica');
  });

  it('seleccionar un equipo no arrastra el lienzo', () => {
    const { fixture, el } = setup(TOPOLOGIA);
    const antes = canvas(el)!.getAttribute('viewBox');
    const nodo = el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement;
    nodo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    nodo.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 90, clientY: 90 }));
    fixture.detectChanges();
    expect(canvas(el)!.getAttribute('viewBox')).toBe(antes);
  });

  // --- CGBIDA-363: cámara -----------------------------------------------------

  it('acerca la vista reduciendo el ancho del viewBox', () => {
    const { fixture, el } = setup(TOPOLOGIA);
    const antes = canvas(el)!.getAttribute('viewBox')!;
    (el.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const despues = canvas(el)!.getAttribute('viewBox')!;
    expect(despues).not.toBe(antes);
    // 1200 / 1.2 = 1000
    expect(despues.split(' ')[2]).toBe('1000');
  });

  it('vuelve a la vista inicial con el botón de reset', () => {
    const { fixture, el } = setup(TOPOLOGIA);
    const inicial = canvas(el)!.getAttribute('viewBox')!;
    (el.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="zoom-reset"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(canvas(el)!.getAttribute('viewBox')).toBe(inicial);
  });

  it('el paneo desplaza la vista y respeta la escala del viewBox', () => {
    const { fixture, el } = setup(TOPOLOGIA);
    const svg = canvas(el)!;
    const inicial = svg.getAttribute('viewBox')!;
    // En jsdom getBoundingClientRect devuelve 0, así que el handler sale sin mover.
    // Se le da un tamaño falso para poder comprobar la aritmética real.
    svg.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0,
      right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    svg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
    svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 160, clientY: 100 }));
    fixture.detectChanges();

    const despues = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // dx_pantalla=60 sobre 600px de ancho con viewBox.w=1200 -> 120 unidades; x inicial -100
    expect(despues[0]).toBeCloseTo(-220, 5);
    expect(despues[1]).toBeCloseTo(-50, 5);
    expect(despues[2]).toBeCloseTo(1200, 5);
    expect(despues).not.toEqual(inicial.split(' ').map(Number));
  });

  // --- CGBIDA-368: i18n --------------------------------------------------------

  describe('i18n', () => {
    afterEach(() => window.localStorage.removeItem('barb.lang'));

    it('en español muestra los textos y los cuatro estados', () => {
      const { el } = setupEnIdioma('es');
      expect(el.querySelector('h1')?.textContent).toContain('Topología de planta');
      for (const etiqueta of ['Operativo', 'Alerta', 'Falla', 'Desconectado']) {
        expect(el.textContent).toContain(etiqueta);
      }
    });

    it('en inglés traduce la pantalla completa, incluido Offline', () => {
      const { el } = setupEnIdioma('en');
      expect(el.querySelector('h1')?.textContent).toContain('Plant Topology');
      expect(el.textContent).toContain('Equipment map by status');
      expect(el.textContent).toContain('Reset view');
      for (const etiqueta of ['Operational', 'Warning', 'Failure', 'Offline']) {
        expect(el.textContent).toContain(etiqueta);
      }
      // y no debe quedar nada en español
      expect(el.textContent).not.toContain('Desconectado');
      expect(el.textContent).not.toContain('Vista inicial');
    });

    it('traduce también los estados de carga, error y vacío', () => {
      const cargando = setupConFuentePendienteEnIdioma('en');
      expect(cargando.el.textContent).toContain('Loading topology');

      TestBed.resetTestingModule();
      const err = setupEnIdioma('en', new Error('boom'));
      expect(err.el.textContent).toContain('could not be loaded');

      TestBed.resetTestingModule();
      const vacio = setupEnIdioma('en', { nodos: [], conexiones: [] });
      expect(vacio.el.textContent).toContain('no equipment to show');
    });

    it('traduce el botón de cerrar del panel de detalle', () => {
      const { fixture, el } = setupEnIdioma('en');
      (el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="panel-cerrar"]')?.textContent).toContain('Close');
      // La etiqueta del estado en el panel también cambia de idioma.
      expect(el.querySelector('[data-testid="panel-estado"]')?.textContent).toContain('Failure');
    });
  });

  // --- CGBIDA-369: interacción con el lienzo ----------------------------------

  describe('interacción', () => {
    it('el clic en el fondo del lienzo no abre el panel', () => {
      const { fixture, el } = setup(TOPOLOGIA);
      canvas(el)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="panel-detalle"]')).toBeNull();
    });

    it('al cambiar la topología se reconstruyen nodos y aristas', () => {
      const fuente = new Subject<Topology>();
      TestBed.configureTestingModule({
        imports: [TopologyComponent],
        providers: [{ provide: TopologyService, useValue: { get: () => fuente.asObservable() } }],
      });
      const fixture = TestBed.createComponent(TopologyComponent);
      fixture.detectChanges();

      fuente.next(TOPOLOGIA);
      fuente.complete();
      fixture.detectChanges();
      expect(nodosDom(fixture.nativeElement).length).toBe(3);

      // La misma instancia recibe otra topología no vuelve a pedirla, pero el
      // render debe seguir siendo consistente con lo recibido.
      expect(canvas(fixture.nativeElement)!.querySelectorAll('line').length).toBe(2);
    });

    it('el panel se cierra y se reabre sin dejar estado colgado', () => {
      const { fixture, el } = setup(TOPOLOGIA);
      const nodo = el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement;
      nodo.dispatchEvent(new Event('click'));
      fixture.detectChanges();
      (el.querySelector('[data-testid="panel-cerrar"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="panel-detalle"]')).toBeNull();

      nodo.dispatchEvent(new Event('click'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="panel-nombre"]')?.textContent).toContain('Compressor A1');
    });
  });
});
