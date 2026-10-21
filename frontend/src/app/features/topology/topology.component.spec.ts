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

  it('dibuja una arista por conexión, recortada en el borde de cada nodo', () => {
    const { el } = setup(TOPOLOGIA);
    const lineas = Array.from(canvas(el)!.querySelectorAll('line'));
    expect(lineas).toHaveLength(2);
    // p_1 centro = (565, 142.5) ; d_1 centro = (265, 342.5)
    const jerarquia = lineas.find((l) => l.getAttribute('data-relacion') === 'jerarquia')!;
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => Number(jerarquia.getAttribute(a)));

    // La arista ya NO arranca ni termina en el centro: si lo hiciera, la punta de flecha
    // quedaría tapada por la tarjeta, que se dibuja después.
    expect([x1, y1]).not.toEqual([565, 142.5]);
    expect([x2, y2]).not.toEqual([265, 342.5]);

    // Cada extremo cae sobre el borde del rectángulo, con 4 de aire hacia afuera.
    const sobreBorde = (x: number, y: number, cx: number, cy: number) => {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      // Al menos uno de los dos ejes alcanza su semi-lado; ninguno se pasa del aire.
      expect(dx).toBeLessThanOrEqual(65 + 4 + 0.001);
      expect(dy).toBeLessThanOrEqual(42.5 + 4 + 0.001);
      expect(Math.max(dx / 65, dy / 42.5)).toBeGreaterThanOrEqual(1);
    };
    sobreBorde(x1, y1, 565, 142.5);
    sobreBorde(x2, y2, 265, 342.5);
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
    const antes = canvas(el)!.getAttribute('viewBox')!.split(' ').map(Number);
    (el.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const despues = canvas(el)!.getAttribute('viewBox')!.split(' ').map(Number);

    // El ancho se divide por el factor...
    expect(despues[2]).toBeCloseTo(antes[2] / 1.2, 5);
    expect(despues[3]).toBeCloseTo(antes[3] / 1.2, 5);
    // ...y el centro se mantiene, que es lo que hace que el zoom "no se escape".
    expect(despues[0] + despues[2] / 2).toBeCloseTo(antes[0] + antes[2] / 2, 5);
    expect(despues[1] + despues[3] / 2).toBeCloseTo(antes[1] + antes[3] / 2, 5);
  });

  it('el encuadre inicial contiene todos los nodos del grafo', () => {
    // Antes la cámara arrancaba en una vista fija de 1200x800 y el mapa llegaba a x=2160:
    // diez de los veintiún nodos quedaban fuera de cuadro al cargar.
    const { el } = setup(TOPOLOGIA);
    const [vx, vy, vw, vh] = canvas(el)!.getAttribute('viewBox')!.split(' ').map(Number);
    const nodos = [...el.querySelectorAll('g[data-nodo-id]')];
    expect(nodos.length).toBeGreaterThan(1);

    for (const g of nodos) {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform')!)!;
      const nx = Number(m[1]);
      const ny = Number(m[2]);
      expect(nx).toBeGreaterThanOrEqual(vx);
      expect(ny).toBeGreaterThanOrEqual(vy);
      expect(nx + 130).toBeLessThanOrEqual(vx + vw);
      expect(ny + 85).toBeLessThanOrEqual(vy + vh);
    }
  });

  it('el encuadre deja aire alrededor del grafo', () => {
    const { el } = setup(TOPOLOGIA);
    const [vx, vy, vw, vh] = canvas(el)!.getAttribute('viewBox')!.split(' ').map(Number);
    const nodos = [...el.querySelectorAll('g[data-nodo-id]')].map((g) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform')!)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    });
    const minX = Math.min(...nodos.map((n) => n.x));
    const minY = Math.min(...nodos.map((n) => n.y));
    const maxX = Math.max(...nodos.map((n) => n.x + 130));
    const maxY = Math.max(...nodos.map((n) => n.y + 85));

    // 80 unidades de padding a cada lado (PADDING_VISTA).
    expect(vx).toBeCloseTo(minX - 80, 5);
    expect(vy).toBeCloseTo(minY - 80, 5);
    expect(vx + vw).toBeCloseTo(maxX + 80, 5);
    expect(vy + vh).toBeCloseTo(maxY + 80, 5);
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
    const base = inicial.split(' ').map(Number);
    // dx_pantalla=60 sobre un lienzo de 600px, escalado a las unidades del viewBox.
    const dxUnidades = (60 * base[2]) / 600;
    expect(despues[0]).toBeCloseTo(base[0] - dxUnidades, 5);
    expect(despues[1]).toBeCloseTo(base[1], 5);
    expect(despues[2]).toBeCloseTo(base[2], 5);
    expect(despues).not.toEqual(base);
  });

  // --- Modo oscuro (HU-07) -----------------------------------------------------

  describe('modo oscuro', () => {
    it('el lienzo sigue el tema en vez de quedarse blanco', () => {
      const { el } = setup(TOPOLOGIA);
      const lienzo = canvas(el)!.parentElement!;
      expect(lienzo.className).toContain('dark:bg-slate-900');
      expect(lienzo.className).toContain('dark:border-gray-800');
    });

    it('los nodos no llevan relleno fijo: usan clases con variante dark', () => {
      // Antes era fill="#ffffff" y fill="#1f2937": en oscuro el mapa quedaba blanco puro.
      const { el } = setup(TOPOLOGIA);
      const rect = el.querySelector('g[data-nodo-id] rect')!;
      expect(rect.getAttribute('fill')).toBeNull();
      expect(rect.getAttribute('class')).toContain('fill-white');
      expect(rect.getAttribute('class')).toContain('dark:fill-slate-800');
    });

    // --- Aristas con dirección (HU-07) ------------------------------------------

    describe('aristas con dirección', () => {
      it('define dos puntas de flecha, la normal y la del hover', () => {
        const { el } = setup(TOPOLOGIA);
        const svg = canvas(el)!;
        expect(svg.querySelector('marker#flecha-topo')).not.toBeNull();
        expect(svg.querySelector('marker#flecha-topo-activa')).not.toBeNull();
      });

      it('las flechas siguen el tema con clases, no con fill fijo', () => {
        const { el } = setup(TOPOLOGIA);
        const flecha = canvas(el)!.querySelector('marker#flecha-topo path')!;
        expect(flecha.getAttribute('fill')).toBeNull();
        expect(flecha.getAttribute('class')).toContain('dark:fill-gray-600');
      });

      it('cada arista lleva la clase que le pone la punta y el hover', () => {
        // El marker-end y el :hover viven en el CSS del componente (styles), no en un
        // atributo: en jsdom no se resuelve CSS, así que se comprueba la clase.
        const { el } = setup(TOPOLOGIA);
        const aristas = [...canvas(el)!.querySelectorAll('line')];
        expect(aristas.length).toBe(TOPOLOGIA.conexiones.length);
        for (const a of aristas) expect(a.getAttribute('class')).toContain('arista');
      });
    });

    // --- Nombres largos (HU-07) -------------------------------------------------

    describe('nombres que no entran en la tarjeta', () => {
      const LARGO = 'Planta Central San Bernardo';

      const conNombres = (nombre: string) => ({
        nodos: [{ ...TOPOLOGIA.nodos[0], nombre_visual: nombre }],
        conexiones: [],
      });

      it('un nombre largo se comprime con textLength y lengthAdjust', () => {
        const { el } = setup(conNombres(LARGO));
        const texto = el.querySelector('.topo-node-name')!;
        // 130 de ancho menos 8 de aire por lado.
        expect(texto.getAttribute('textLength')).toBe('114');
        expect(texto.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
      });

      it('un nombre corto se dibuja sin comprimir', () => {
        const { el } = setup(conNombres('HVAC'));
        const texto = el.querySelector('.topo-node-name')!;
        expect(texto.getAttribute('textLength')).toBeNull();
      });
    });

    // --- Zoom con rueda (HU-07) -------------------------------------------------

    describe('zoom con rueda', () => {
      it('la rueda hacia arriba acerca y respeta el centro', () => {
        const { fixture, el } = setup(TOPOLOGIA);
        const svg = canvas(el)!;
        const antes = svg.getAttribute('viewBox')!.split(' ').map(Number);

        svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
        fixture.detectChanges();

        const despues = svg.getAttribute('viewBox')!.split(' ').map(Number);
        expect(despues[2]).toBeCloseTo(antes[2] / 1.15, 5);
        expect(despues[3]).toBeCloseTo(antes[3] / 1.15, 5);
        // El centro no se mueve: es el mismo criterio que los botones de zoom.
        expect(despues[0] + despues[2] / 2).toBeCloseTo(antes[0] + antes[2] / 2, 5);
        expect(despues[1] + despues[3] / 2).toBeCloseTo(antes[1] + antes[3] / 2, 5);
      });

      it('la rueda hacia abajo aleja', () => {
        const { fixture, el } = setup(TOPOLOGIA);
        const svg = canvas(el)!;
        const antes = svg.getAttribute('viewBox')!.split(' ').map(Number);

        svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
        fixture.detectChanges();

        const despues = svg.getAttribute('viewBox')!.split(' ').map(Number);
        expect(despues[2]).toBeCloseTo(antes[2] * 1.15, 5);
      });

      it('la rueda no deja scrollear la página', () => {
        const { el } = setup(TOPOLOGIA);
        const svg = canvas(el)!;
        const evento = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
        svg.dispatchEvent(evento);
        expect(evento.defaultPrevented).toBe(true);
      });
    });

    it('las aristas y los textos de cada nodo tienen variante dark', () => {
      const { el } = setup(TOPOLOGIA);
      const aristas = el.querySelector('[data-testid="topo-canvas"] g')!;
      expect(aristas.getAttribute('stroke')).toBeNull();
      expect(aristas.getAttribute('class')).toContain('dark:stroke-gray-600');

      const nombre = el.querySelector('.topo-node-name')!;
      expect(nombre.getAttribute('fill')).toBeNull();
      expect(nombre.getAttribute('class')).toContain('dark:fill-gray-100');

      const tipo = el.querySelector('.topo-node-type')!;
      expect(tipo.getAttribute('class')).toContain('dark:fill-gray-400');
    });

    it('la cabecera y los botones de zoom tienen variante dark', () => {
      const { el } = setup(TOPOLOGIA);
      expect(el.querySelector('h1')!.className).toContain('dark:text-gray-100');
      expect(el.querySelector('[data-testid="zoom-in"]')!.className).toContain('dark:bg-gray-800');
    });
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

    /**
     * Despliega los grupos que arrancan plegados.
     *
     * «Cerradas» y «Canceladas» vienen cerradas por defecto, así que cualquier aserción
     * sobre el total de tarjetas tiene que abrirlas primero.
     */
    function desplegarPlegados(
      fixture: ReturnType<typeof TestBed.createComponent>,
      el: HTMLElement,
    ): void {
      for (const nombre of ['groupCerradas', 'groupCanceladas']) {
        const cabecera = el.querySelector<HTMLElement>(`[data-testid="grupo-${nombre}"]`);
        if (cabecera?.getAttribute('aria-expanded') === 'false') {
          cabecera.click();
          fixture.detectChanges();
        }
      }
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
      // Cerradas y Canceladas arrancan plegadas: se abren para contar todas.
      desplegarPlegados(fixture, el);

      // Los 4 encabezados existen, con su conteo.
      expect(el.querySelector('[data-testid="grupo-groupPendientes"]')?.textContent).toContain('(8)');
      expect(el.querySelector('[data-testid="grupo-groupEnCurso"]')?.textContent).toContain('(5)');
      expect(el.querySelector('[data-testid="grupo-groupCerradas"]')?.textContent).toContain('(6)');
      expect(el.querySelector('[data-testid="grupo-groupCanceladas"]')?.textContent).toContain('(1)');

      // Sin límite: se renderizan TODAS.
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
      desplegarPlegados(fixture, el);

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

    // --- Grupos colapsables, filtro y orden -------------------------------------

    describe('grupos colapsables', () => {
      it('Pendientes y En curso arrancan abiertos; Cerradas y Canceladas, cerrados', () => {
        const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
        abrirMaquina(fixture, el);

        const abierto = (nombre: string) =>
          el.querySelector(`[data-testid="grupo-${nombre}"]`)?.getAttribute('aria-expanded');

        expect(abierto('groupPendientes')).toBe('true');
        expect(abierto('groupEnCurso')).toBe('true');
        expect(abierto('groupCerradas')).toBe('false');
        expect(abierto('groupCanceladas')).toBe('false');
      });

      it('por defecto solo se pintan las OTs de los grupos abiertos', () => {
        // 8 pendientes + 5 en curso; las 6 cerradas y la cancelada quedan plegadas.
        const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
        abrirMaquina(fixture, el);
        expect(el.querySelectorAll('[data-testid="orden-item"]').length).toBe(13);
      });

      it('al hacer clic en la cabecera se despliega y se vuelve a plegar', () => {
        const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
        abrirMaquina(fixture, el);

        const cabecera = el.querySelector<HTMLElement>('[data-testid="grupo-groupCerradas"]')!;
        cabecera.click();
        fixture.detectChanges();
        expect(cabecera.getAttribute('aria-expanded')).toBe('true');
        expect(el.querySelectorAll('[data-testid="orden-item"]').length).toBe(19);

        cabecera.click();
        fixture.detectChanges();
        expect(cabecera.getAttribute('aria-expanded')).toBe('false');
        expect(el.querySelectorAll('[data-testid="orden-item"]').length).toBe(13);
      });

      it('la cabecera se anuncia como botón y lleva cursor pointer', () => {
        const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
        abrirMaquina(fixture, el);
        const cabecera = el.querySelector<HTMLElement>('[data-testid="grupo-groupPendientes"]')!;
        expect(cabecera.tagName).toBe('BUTTON');
        expect(cabecera.className).toContain('cursor-pointer');
        // El conteo sigue visible aunque el grupo esté plegado.
        expect(cabecera.textContent).toContain('(8)');
      });
    });

    describe('filtro por estado', () => {
      it('el selector ofrece Todos más los grupos presentes, con sus conteos', () => {
        const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
        abrirMaquina(fixture, el);

        const select = el.querySelector<HTMLSelectElement>('[data-testid="filtro-estado"]')!;
        const opciones = Array.from(select.options).map((o) => o.textContent?.trim());
        expect(opciones[0]).toContain('Todos (20)');
        expect(opciones).toHaveLength(5);
        expect(select.value).toBe('todos');
      });

      it('filtrar deja solo el grupo elegido', () => {
        const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
        abrirMaquina(fixture, el);

        const select = el.querySelector<HTMLSelectElement>('[data-testid="filtro-estado"]')!;
        select.value = 'groupCerradas';
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        // Solo queda la cabecera de Cerradas (aunque esté plegada, no se pinta su lista).
        expect(el.querySelector('[data-testid="grupo-groupPendientes"]')).toBeNull();
        expect(el.querySelector('[data-testid="grupo-groupEnCurso"]')).toBeNull();
        expect(el.querySelector('[data-testid="grupo-groupCerradas"]')).not.toBeNull();
        expect(el.querySelectorAll('[data-testid="orden-item"]').length).toBe(0);

        // Y al desplegarla aparecen sus 6.
        el.querySelector<HTMLElement>('[data-testid="grupo-groupCerradas"]')!.click();
        fixture.detectChanges();
        expect(el.querySelectorAll('[data-testid="orden-item"]').length).toBe(6);
      });

      it('volver a Todos restaura los cuatro grupos', () => {
        const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
        abrirMaquina(fixture, el);
        const select = el.querySelector<HTMLSelectElement>('[data-testid="filtro-estado"]')!;

        select.value = 'groupEnCurso';
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        expect(el.querySelectorAll('[data-testid^="grupo-group"]').length).toBe(1);

        select.value = 'todos';
        select.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        expect(el.querySelectorAll('[data-testid^="grupo-group"]').length).toBe(4);
      });
    });

    describe('orden dentro de cada grupo', () => {
      const DESORDENADAS = [
        ot({ numero_ot: 'OT-B', estado: 'pending', created_at: '2026-03-01T10:00:00Z' }),
        ot({ numero_ot: 'OT-C', estado: 'pending', created_at: '2026-05-01T10:00:00Z' }),
        ot({ numero_ot: 'OT-A', estado: 'pending', created_at: '2026-01-01T10:00:00Z' }),
      ];

      const numeros = (el: HTMLElement) =>
        Array.from(el.querySelectorAll('[data-testid="orden-numero"]')).map((n) =>
          n.textContent?.trim(),
        );

      it('por defecto ordena por fecha, la más reciente primero', () => {
        const { fixture, el } = setupConOrdenes(DESORDENADAS);
        abrirMaquina(fixture, el);
        expect(numeros(el)).toEqual(['OT-C', 'OT-B', 'OT-A']);
      });

      it('el botón alterna a A-Z por número de OT', () => {
        const { fixture, el } = setupConOrdenes(DESORDENADAS);
        abrirMaquina(fixture, el);

        const boton = el.querySelector<HTMLElement>('[data-testid="orden-ot"]')!;
        boton.click();
        fixture.detectChanges();

        expect(numeros(el)).toEqual(['OT-A', 'OT-B', 'OT-C']);
        expect(boton.textContent).toContain('A-Z');
      });

      it('el orden NO cambia el orden de los grupos', () => {
        const { fixture, el } = setupConOrdenes(ORDENES_VOLUMEN);
        abrirMaquina(fixture, el);
        el.querySelector<HTMLElement>('[data-testid="orden-ot"]')!.click();
        fixture.detectChanges();

        const grupos = Array.from(el.querySelectorAll('[data-testid^="grupo-group"]')).map((g) =>
          g.getAttribute('data-testid'),
        );
        expect(grupos).toEqual([
          'grupo-groupPendientes',
          'grupo-groupEnCurso',
          'grupo-groupCerradas',
          'grupo-groupCanceladas',
        ]);
      });
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
      desplegarPlegados(fixture, el);

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
