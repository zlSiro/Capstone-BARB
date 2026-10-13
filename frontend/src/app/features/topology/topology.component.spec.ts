import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';

import { Topology, TopologyNode, TopologyNodoDetalle, WorkOrder } from '../../core/models';
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

/** OT mínima válida para el panel; el sheet de detalle la recibe entera. */
function ot(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'OT-1',
    numero_ot: 'OT-1',
    ot_id: 1,
    title: 'Cambio de aceite',
    machine: 'Compressor A1',
    machine_name: 'Compressor A1',
    machine_id: 1,
    plant: 'Planta Central',
    plant_name: 'Planta Central',
    plant_id: 1,
    discipline: 'Mecánica',
    discipline_name: 'Mecánica',
    priority: 'high',
    status: 'Pendiente',
    estado: 'pending',
    age_minutes: 10,
    created_at: '2026-10-12T10:00:00Z',
    photo_count: 0,
    photos: [],
    tecnico_nombre: 'Técnico',
    tipo: 'corrective',
    costo_estimado: 0,
    costo_real: 0,
    ...overrides,
  } as WorkOrder;
}

/**
 * `getNodo` falso coherente con la topología: devuelve el nodo pedido tal como lo
 * emite el mapa, sus órdenes y sus hijos derivados de las aristas.
 *
 * `ordenesPorNodo` permite inyectar órdenes distintas por nodo; por defecto, ninguna.
 */
function getNodoDe(topo: Topology, ordenesPorNodo: Record<string, WorkOrder[]> = {}) {
  return vi.fn((nodoId: string): Observable<TopologyNodoDetalle> => {
    const nodo = topo.nodos.find((n) => n.nodo_id === nodoId)!;
    // Los hijos se derivan de las aristas, igual que hace el backend (`_hijos_de`).
    const hijos = nodoId.startsWith('m_')
      ? []
      : topo.conexiones
          .filter((c) => c.origen_nodo_id === nodoId)
          .map((c) => topo.nodos.find((n) => n.nodo_id === c.destino_nodo_id))
          .filter((n): n is TopologyNode => Boolean(n));
    return of<TopologyNodoDetalle>({
      nodo,
      ordenes: ordenesPorNodo[nodoId] ?? [],
      hijos,
    });
  });
}

/** Servicio falso: cada test decide qué responde `get()`. */
function setup(respuesta: Topology | Error) {
  const get = vi.fn(() => (respuesta instanceof Error ? throwError(() => respuesta) : of(respuesta)));
  TestBed.configureTestingModule({
    imports: [TopologyComponent],
    providers: [{ provide: TopologyService, useValue: { get, getNodo: getNodoDe(TOPOLOGIA) } }],
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
    providers: [{ provide: TopologyService, useValue: { get: () => fuente.asObservable(), getNodo: getNodoDe(TOPOLOGIA) } }],
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
    providers: [{ provide: TopologyService, useValue: { get, getNodo: getNodoDe(TOPOLOGIA) } }],
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
    providers: [{ provide: TopologyService, useValue: { get: () => fuente.asObservable(), getNodo: getNodoDe(TOPOLOGIA) } }],
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
        providers: [{ provide: TopologyService, useValue: { get: () => fuente.asObservable(), getNodo: getNodoDe(TOPOLOGIA) } }],
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

  // --- CGBIDA-383: órdenes de trabajo en el panel ------------------------------

  describe('órdenes de trabajo (CGBIDA-383)', () => {
    /** Monta el componente con órdenes concretas para la máquina `m_1`. */
    function setupConOrdenes(ordenes: WorkOrder[]) {
      const get = vi.fn(() => of(TOPOLOGIA));
      TestBed.configureTestingModule({
        imports: [TopologyComponent],
        providers: [
          {
            provide: TopologyService,
            useValue: { get, getNodo: getNodoDe(TOPOLOGIA, { m_1: ordenes }) },
          },
        ],
      });
      const fixture = TestBed.createComponent(TopologyComponent);
      fixture.detectChanges();
      return { fixture, el: fixture.nativeElement as HTMLElement };
    }

    function abrirMaquina(fixture: ReturnType<typeof TestBed.createComponent>, el: HTMLElement) {
      (el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();
    }

    it('agrupa los 6 estados en Pendientes, En curso, Cerradas y Canceladas', () => {
      const { fixture, el } = setupConOrdenes([
        ot({ numero_ot: 'OT-P', estado: 'pending' }),
        ot({ numero_ot: 'OT-A', estado: 'assigned' }),
        ot({ numero_ot: 'OT-V', estado: 'overdue' }),
        ot({ numero_ot: 'OT-C', estado: 'in_progress' }),
        ot({ numero_ot: 'OT-F', estado: 'completed' }),
        ot({ numero_ot: 'OT-X', estado: 'cancelled' }),
      ]);
      abrirMaquina(fixture, el);

      // `assigned` y `overdue` caen en Pendientes: lo decide filterGroup(), no el componente.
      expect(el.querySelector('[data-testid="grupo-groupPendientes"]')?.textContent).toContain('(3)');
      expect(el.querySelector('[data-testid="grupo-groupEnCurso"]')?.textContent).toContain('(1)');
      expect(el.querySelector('[data-testid="grupo-groupCerradas"]')?.textContent).toContain('(1)');
      expect(el.querySelector('[data-testid="grupo-groupCanceladas"]')?.textContent).toContain('(1)');
    });

    it('cancelled va en su propio grupo y no se mezcla con completed', () => {
      const { fixture, el } = setupConOrdenes([
        ot({ numero_ot: 'OT-F', estado: 'completed' }),
        ot({ numero_ot: 'OT-X', estado: 'cancelled' }),
      ]);
      abrirMaquina(fixture, el);
      expect(el.querySelector('[data-testid="grupo-groupCerradas"]')?.textContent).toContain('(1)');
      expect(el.querySelector('[data-testid="grupo-groupCanceladas"]')?.textContent).toContain('(1)');
      // El grupo de cerradas no debe contener la cancelada.
      expect(el.querySelector('[data-testid="grupo-groupCerradas"]')?.textContent).not.toContain('Cancelada');
    });

    it('overdue lleva badge rojo dentro del grupo Pendientes (CGBIDA-378)', () => {
      const { fixture, el } = setupConOrdenes([
        ot({ numero_ot: 'OT-V', estado: 'overdue' }),
        ot({ numero_ot: 'OT-P', estado: 'pending' }),
      ]);
      abrirMaquina(fixture, el);

      // Sigue en Pendientes...
      expect(el.querySelector('[data-testid="grupo-groupPendientes"]')?.textContent).toContain('(2)');
      // ...y además se marca en rojo.
      const badge = el.querySelector('[data-testid="orden-vencida"]');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain('Vencida');
      expect(badge?.className).toContain('bg-red-600');
      // Solo la vencida lo lleva.
      expect(el.querySelectorAll('[data-testid="orden-vencida"]').length).toBe(1);
    });

    it('una máquina sin órdenes muestra un mensaje explícito, no un panel vacío', () => {
      const { fixture, el } = setupConOrdenes([]);
      abrirMaquina(fixture, el);

      const vacio = el.querySelector('[data-testid="ordenes-vacio"]');
      expect(vacio).not.toBeNull();
      expect(vacio?.textContent).toContain('no tiene órdenes');
      expect(el.querySelector('[data-testid="orden-item"]')).toBeNull();
    });

    it('no muestra la sección de órdenes en una planta', () => {
      const { fixture, el } = setupConOrdenes([]);
      (el.querySelector('g[data-nodo-id="p_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();
      // La planta no tiene órdenes propias: esa sección no debe existir.
      expect(el.querySelector('[data-testid="ordenes-vacio"]')).toBeNull();
      expect(el.querySelector('[data-testid="ordenes-cargando"]')).toBeNull();
      // Y sí muestra su contenido (en TOPOLOGIA, la planta 1 tiene la disciplina d_1).
      expect(el.querySelectorAll('[data-testid="hijo-item"]').length).toBe(1);
    });

    // --- Volumen: una máquina con muchas OTs -----------------------------------
    //
    // El seed solo tiene 1-2 OTs por máquina, así que este caso no se ejerce con
    // datos reales. Se sintetizan 20 para comprobar que el panel no se rompe.

    /** 20 OTs repartidas en los 4 grupos: 8 pendientes, 5 en curso, 6 cerradas, 1 cancelada. */
    const ORDENES_VOLUMEN: WorkOrder[] = [
      ...Array.from({ length: 4 }, (_, i) => ot({ numero_ot: `OT-PEND-${i}`, estado: 'pending' })),
      ...Array.from({ length: 3 }, (_, i) => ot({ numero_ot: `OT-ASIG-${i}`, estado: 'assigned' })),
      ot({ numero_ot: 'OT-VENC-0', estado: 'overdue' }),
      ...Array.from({ length: 5 }, (_, i) => ot({ numero_ot: `OT-CURS-${i}`, estado: 'in_progress' })),
      ...Array.from({ length: 6 }, (_, i) => ot({ numero_ot: `OT-CERR-${i}`, estado: 'completed' })),
      ot({ numero_ot: 'OT-CANC-0', estado: 'cancelled' }),
    ];

    it('renderiza 20 OTs repartidas en los 4 grupos sin perder ninguna', () => {
      const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
      abrirMaquina(fixture, el);

      // Los 4 encabezados existen, con su conteo.
      expect(el.querySelector('[data-testid="grupo-groupPendientes"]')?.textContent).toContain('(8)');
      expect(el.querySelector('[data-testid="grupo-groupEnCurso"]')?.textContent).toContain('(5)');
      expect(el.querySelector('[data-testid="grupo-groupCerradas"]')?.textContent).toContain('(6)');
      expect(el.querySelector('[data-testid="grupo-groupCanceladas"]')?.textContent).toContain('(1)');

      // Hoy no hay límite: se renderizan TODAS.
      expect(el.querySelectorAll('[data-testid="orden-item"]').length).toBe(20);

      // Cada grupo tiene exactamente sus tarjetas, sin mezclarse.
      const grupo = (nombre: string) => {
        const cabecera = el.querySelector(`[data-testid="grupo-${nombre}"]`)!;
        return cabecera.nextElementSibling?.querySelectorAll('[data-testid="orden-item"]').length ?? 0;
      };
      expect(grupo('groupPendientes')).toBe(8);
      expect(grupo('groupEnCurso')).toBe(5);
      expect(grupo('groupCerradas')).toBe(6);
      expect(grupo('groupCanceladas')).toBe(1);
    });

    it('con volumen, el badge de vencida aparece solo en la OT vencida', () => {
      const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
      abrirMaquina(fixture, el);

      expect(el.querySelectorAll('[data-testid="orden-vencida"]').length).toBe(1);
      // Y esa vencida está dentro del grupo de pendientes, no en otro.
      const pendientes = el.querySelector('[data-testid="grupo-groupPendientes"]')!.nextElementSibling!;
      expect(pendientes.querySelectorAll('[data-testid="orden-vencida"]').length).toBe(1);
    });

    it('con volumen, todas las OTs tienen su enlace de detalle', () => {
      const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
      abrirMaquina(fixture, el);

      // Un enlace por tarjeta: si alguno faltara, habría OTs inaccesibles.
      expect(el.querySelectorAll('[data-testid="orden-ver-detalle"]').length).toBe(20);
    });

    it('el panel tiene scroll propio y altura acotada, para no desbordar el lienzo', () => {
      const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
      abrirMaquina(fixture, el);

      const panel = el.querySelector('[data-testid="panel-detalle"]') as HTMLElement;
      expect(panel.className).toContain('overflow-y-auto');
      expect(panel.className).toContain('max-h-');
    });

    // --- Encabezados de grupo fijos (CGBIDA-386) --------------------------------
    //
    // jsdom no tiene layout, así que no puede comprobar que `sticky` funcione de
    // verdad. Lo que sí detecta este test es que alguien quite las clases por
    // accidente: `bg-white` es imprescindible, porque sin fondo el contenido que
    // pasa por debajo se transparenta a través del encabezado.

    it('los encabezados de grupo son sticky y llevan fondo opaco', () => {
      const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
      abrirMaquina(fixture, el);

      const cabeceras = Array.from(
        el.querySelectorAll<HTMLElement>('[data-testid^="grupo-group"]'),
      );
      expect(cabeceras.length).toBe(4);

      for (const cabecera of cabeceras) {
        expect(cabecera.className).toContain('sticky');
        expect(cabecera.className).toContain('top-0');
        // Sin `bg-white` el encabezado sería transparente al fijarse.
        expect(cabecera.className).toContain('bg-white');
        // Sin `z-10` el contenido posterior podría pintarse encima.
        expect(cabecera.className).toContain('z-10');
        // Modo oscuro: `bg-white` solo no basta. El fondo debe seguir al del panel,
        // que en oscuro es `dark:bg-gray-900` (CGBIDA-386).
        expect(cabecera.className).toContain('dark:bg-gray-900');
      }
    });

    it('el encabezado y el panel comparten fondo en modo oscuro', () => {
      const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
      abrirMaquina(fixture, el);

      const panel = el.querySelector('[data-testid="panel-detalle"]') as HTMLElement;
      const cabecera = el.querySelector<HTMLElement>('[data-testid^="grupo-group"]')!;
      // Si los fondos oscuros no coinciden, el encabezado se ve como una banda
      // de otro color al desplazarse.
      expect(panel.className).toContain('dark:bg-gray-900');
      expect(cabecera.className).toContain('dark:bg-gray-900');
    });

    // --- Texto del panel en modo oscuro -----------------------------------------
    //
    // El fondo oscuro se arregló en CGBIDA-386, pero el texto interior se quedó con
    // colores claros sobre un fondo oscuro. Estos tests detectan si se vuelve a
    // introducir un texto sin variante `dark:`.

    it('cada tarjeta de OT lleva al menos una clase dark:text-*', () => {
      const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
      abrirMaquina(fixture, el);

      const tarjetas = Array.from(el.querySelectorAll<HTMLElement>('[data-testid="orden-item"]'));
      expect(tarjetas.length).toBe(20);

      for (const tarjeta of tarjetas) {
        // El número de la OT es el texto identificativo de la tarjeta.
        const numero = tarjeta.querySelector<HTMLElement>('[data-testid="orden-numero"]')!;
        expect(numero).not.toBeNull();
        expect(numero.className).toContain('dark:text-');
        // Y el enlace al detalle también debe leerse en oscuro.
        const enlace = tarjeta.querySelector<HTMLElement>('[data-testid="orden-ver-detalle"]')!;
        expect(enlace.className).toContain('dark:text-');
      }
    });

    it('la cabecera del panel y sus etiquetas se leen en modo oscuro', () => {
      const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
      abrirMaquina(fixture, el);

      for (const sel of ['panel-nombre', 'panel-tipo', 'panel-estado', 'ordenes-cargando']) {
        const nodo = el.querySelector<HTMLElement>(`[data-testid="${sel}"]`);
        if (!nodo) continue;
        const tieneDark = nodo.className.includes('dark:text-')
          || Boolean(nodo.querySelector('[class*="dark:text-"]'));
        expect(tieneDark).toBe(true);
      }
    });

    it('los mensajes de vacío y error del panel tienen variante oscura', () => {
      const get = vi.fn(() => of(TOPOLOGIA));
      const getNodo = vi.fn(() => throwError(() => new Error('500')));
      TestBed.configureTestingModule({
        imports: [TopologyComponent],
        providers: [{ provide: TopologyService, useValue: { get, getNodo } }],
      });
      const fixture = TestBed.createComponent(TopologyComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      (el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();

      const err = el.querySelector<HTMLElement>('[data-testid="ordenes-error"]')!;
      expect(err.className).toContain('dark:text-red-300');
    });

    it('el mensaje de equipo sin órdenes tiene variante oscura', () => {
      const { fixture, el } = setupConOrdenes([]);
      abrirMaquina(fixture, el);

      const vacio = el.querySelector<HTMLElement>('[data-testid="ordenes-vacio"]')!;
      expect(vacio.className).toContain('dark:text-gray-400');
    });

    it('un nodo sin hijos muestra un mensaje explícito', () => {
      const get = vi.fn(() => of(TOPOLOGIA));
      // Planta sin aristas salientes: no contiene nada.
      const getNodo = vi.fn(
        (nodoId: string): Observable<TopologyNodoDetalle> =>
          of<TopologyNodoDetalle>({
            nodo: TOPOLOGIA.nodos.find((n) => n.nodo_id === nodoId)!,
            ordenes: [],
            hijos: [],
          }),
      );
      TestBed.configureTestingModule({
        imports: [TopologyComponent],
        providers: [{ provide: TopologyService, useValue: { get, getNodo } }],
      });
      const fixture = TestBed.createComponent(TopologyComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      (el.querySelector('g[data-nodo-id="p_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();

      const vacio = el.querySelector('[data-testid="hijos-vacio"]');
      expect(vacio).not.toBeNull();
      expect(vacio?.textContent).toContain('no contiene equipos');
      expect(el.querySelector('[data-testid="hijo-item"]')).toBeNull();
    });
  });

  // --- CGBIDA-384: hijos por nivel del nodo ------------------------------------

  describe('jerarquía por nodo (CGBIDA-384)', () => {
    it('una planta lista sus disciplinas', () => {
      const { fixture, el } = setup(TOPOLOGIA);
      (el.querySelector('g[data-nodo-id="p_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();

      const hijos = Array.from(el.querySelectorAll('[data-testid="hijo-item"]'));
      expect(hijos.length).toBe(1);
      expect(hijos[0].textContent).toContain('Mecánica');
      expect(hijos[0].getAttribute('data-nodo-id')).toBe('d_1');
    });

    it('una disciplina lista sus máquinas', () => {
      const { fixture, el } = setup(TOPOLOGIA);
      (el.querySelector('g[data-nodo-id="d_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();

      const hijos = Array.from(el.querySelectorAll('[data-testid="hijo-item"]'));
      expect(hijos.length).toBe(1);
      expect(hijos[0].textContent).toContain('Compressor A1');
    });

    it('un hijo es clickeable y cambia el nodo del panel', () => {
      const { fixture, el } = setup(TOPOLOGIA);
      (el.querySelector('g[data-nodo-id="p_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="panel-nombre"]')?.textContent).toContain('Planta Central');

      (el.querySelector('[data-testid="hijo-item"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      // El panel ahora muestra la disciplina hija.
      expect(el.querySelector('[data-testid="panel-nombre"]')?.textContent).toContain('Mecánica');
      expect(el.querySelector('[data-testid="panel-tipo"]')?.textContent).toContain('Disciplina');
    });

    it('al bajar a un hijo aparece el botón para volver al padre', () => {
      const { fixture, el } = setup(TOPOLOGIA);
      (el.querySelector('g[data-nodo-id="p_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="panel-volver"]')).toBeNull();

      (el.querySelector('[data-testid="hijo-item"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="panel-volver"]')).not.toBeNull();

      (el.querySelector('[data-testid="panel-volver"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="panel-nombre"]')?.textContent).toContain('Planta Central');
    });

    it('una máquina no muestra sección de hijos', () => {
      const { fixture, el } = setup(TOPOLOGIA);
      (el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="hijo-item"]')).toBeNull();
      expect(el.querySelector('[data-testid="hijos-vacio"]')).toBeNull();
    });

    it('si el detalle falla, lo informa en vez de quedarse cargando', () => {
      const get = vi.fn(() => of(TOPOLOGIA));
      const getNodo = vi.fn(() => throwError(() => new Error('500')));
      TestBed.configureTestingModule({
        imports: [TopologyComponent],
        providers: [{ provide: TopologyService, useValue: { get, getNodo } }],
      });
      const fixture = TestBed.createComponent(TopologyComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      (el.querySelector('g[data-nodo-id="p_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();

      expect(el.querySelector('[data-testid="hijos-error"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="hijos-cargando"]')).toBeNull();
    });
  });

  // --- CGBIDA-385: enlace al detalle de la OT ----------------------------------

  describe('detalle de una OT (CGBIDA-385)', () => {
    it('abre el sheet de detalle al pulsar "Ver detalle"', () => {
      const orden = ot({ numero_ot: 'OT-2026-999', estado: 'in_progress' });
      const get = vi.fn(() => of(TOPOLOGIA));
      TestBed.configureTestingModule({
        imports: [TopologyComponent],
        providers: [
          {
            provide: TopologyService,
            useValue: { get, getNodo: getNodoDe(TOPOLOGIA, { m_1: [orden] }) },
          },
        ],
      });
      const fixture = TestBed.createComponent(TopologyComponent);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      (el.querySelector('g[data-nodo-id="m_1"]') as SVGGElement).dispatchEvent(new Event('click'));
      fixture.detectChanges();

      expect(el.querySelector('[data-testid="sheet-detalle-ot"]')).toBeNull();
      (el.querySelector('[data-testid="orden-ver-detalle"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      // El sheet reutilizado del listado de OTs recibe la OT seleccionada: el
      // `numero_ot` viaja como título del modal que el sheet envuelve.
      expect(el.querySelector('[data-testid="sheet-detalle-ot"]')).not.toBeNull();
      const dialogo = el.querySelector('[role="dialog"]');
      expect(dialogo).not.toBeNull();
      expect(dialogo?.textContent).toContain('OT-2026-999');
    });
  });
});
