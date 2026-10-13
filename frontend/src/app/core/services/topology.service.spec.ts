import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { TopologyService } from './topology.service';
import { TopologyNodoDetalle } from '../models';

/**
 * CGBIDA-382: el servicio debe llamar al endpoint de detalle de nodo con el
 * `nodo_id` en la ruta. El contrato está en `docs/contrato_api_topologia.md`,
 * sección "detalle de un nodo" (CGBIDA-381).
 */
describe('TopologyService', () => {
  let service: TopologyService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TopologyService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('get() pide el mapa completo', () => {
    service.get().subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/topology'));
    expect(req.request.method).toBe('GET');
    req.flush({ nodos: [], conexiones: [] });
  });

  it('getNodo() pide el detalle del nodo con su id en la ruta', () => {
    let recibido: TopologyNodoDetalle | undefined;
    service.getNodo('m_13').subscribe((d) => (recibido = d));

    const req = http.expectOne((r) => r.url.endsWith('/topology/m_13'));
    expect(req.request.method).toBe('GET');

    const cuerpo: TopologyNodoDetalle = {
      nodo: {
        nodo_id: 'm_13',
        nombre_visual: 'Sistema Lubricación Molino',
        tipo: 'Máquina',
        icono: '🤖',
        pos_x: 50,
        pos_y: 500,
        estado_actual: 'alerta',
        maquina_id: 13,
      },
      ordenes: [],
      hijos: [],
    };
    req.flush(cuerpo);
    expect(recibido).toEqual(cuerpo);
  });

  it('getNodo() escapa el id para no romper la ruta', () => {
    service.getNodo('a b').subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/topology/a%20b'));
    expect(req.request.method).toBe('GET');
    req.flush({ nodo: {}, ordenes: [], hijos: [] });
  });
});
