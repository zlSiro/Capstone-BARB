import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';

import { TransaccionesEmpresa } from './transacciones-empresa';
import { TransaccionesEmpresaOpciones, TransaccionesPage } from '../../core/models';

const OPCIONES: TransaccionesEmpresaOpciones = {
  roles: ['gerente', 'tecnico'],
  usuarios: [
    { usuario_id: 2, nombre: 'Gerente 1', rol: 'gerente', empresa_id: 1 },
    { usuario_id: 4, nombre: 'Carlos', rol: 'tecnico', empresa_id: 1 },
    { usuario_id: 5, nombre: 'Ana', rol: 'tecnico', empresa_id: 1 },
  ],
};

const PAGINA: TransaccionesPage = {
  total: 1,
  limit: 50,
  offset: 0,
  items: [
    {
      transaccion_id: 1,
      fecha: '2026-10-19T12:00:00Z',
      usuario_id: 4,
      usuario_nombre: 'Carlos',
      usuario_email: 'carlos@planta.com',
      empresa_id: 1,
      empresa_nombre: 'Planta Demo',
      perfil: 'tecnico',
      accion: 'INSERT ot_foto',
      operacion: 'INSERT',
      tabla: 'ot_foto',
      registro_id: '8',
      detalle: { datos: { file_name: 'a.jpg' } },
    },
  ],
};

describe('TransaccionesEmpresa', () => {
  let http: HttpTestingController;

  const listados = () => http.match((r) => r.url.endsWith('/empresa/transacciones'));
  const ultimo = (reqs: TestRequest[]) => reqs[reqs.length - 1];

  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TransaccionesEmpresa);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/empresa/transacciones/filtros')).flush(OPCIONES);
    ultimo(listados()).flush(PAGINA);
    fixture.detectChanges();
    return fixture;
  }

  function elegir(fixture: ReturnType<typeof setup>, id: string, value: string) {
    const el = fixture.nativeElement.querySelector(`#${id}`) as HTMLSelectElement | HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('carga por defecto la última semana y muestra la transacción', () => {
    const fixture = setup();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Carlos');
    expect(text).toContain('Creó');
  });

  it('no ofrece filtro de empresa y nunca envía empresa_id', () => {
    const fixture = setup();
    expect(fixture.nativeElement.querySelector('#trx-empresa')).toBeNull();

    elegir(fixture, 'trx-rol', 'tecnico');
    const req = ultimo(listados());
    expect(req.request.params.has('empresa_id')).toBe(false);
    req.flush(PAGINA);
  });

  it('cada filtro vuelve a consultar con sus parámetros', () => {
    const fixture = setup();

    elegir(fixture, 'trx-rol', 'tecnico');
    let req = ultimo(listados());
    expect(req.request.params.get('rol')).toBe('tecnico');
    req.flush(PAGINA);

    elegir(fixture, 'trx-usuario', '5');
    req = ultimo(listados());
    expect(req.request.params.get('usuario_id')).toBe('5');
    req.flush(PAGINA);

    elegir(fixture, 'trx-rango', '30d');
    req = ultimo(listados());
    expect(req.request.params.get('rango')).toBe('30d');
    req.flush(PAGINA);
  });

  it('al cambiar de rol se descarta el usuario que ya no corresponde', () => {
    const fixture = setup();
    elegir(fixture, 'trx-usuario', '4');
    ultimo(listados()).flush(PAGINA);

    elegir(fixture, 'trx-rol', 'gerente');
    const req = ultimo(listados());
    expect(req.request.params.has('usuario_id')).toBe(false);
    req.flush(PAGINA);
  });

  it('"Personalizar" no consulta hasta tener las dos fechas y las envía como desde/hasta', () => {
    const fixture = setup();

    elegir(fixture, 'trx-rango', 'custom');
    expect(listados()).toHaveLength(0);

    elegir(fixture, 'trx-desde', '2026-10-01');
    expect(listados()).toHaveLength(0);

    elegir(fixture, 'trx-hasta', '2026-10-15');
    const req = ultimo(listados());
    expect(req.request.params.get('rango')).toBe('custom');
    expect(req.request.params.get('desde')).toBe('2026-10-01');
    expect(req.request.params.get('hasta')).toBe('2026-10-15');
    req.flush(PAGINA);
  });
});
