import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';

import { TransaccionesComponent } from './transacciones.component';
import { TransaccionesOpciones, TransaccionesPage } from '../../core/models';

const OPCIONES: TransaccionesOpciones = {
  empresas: [
    { empresa_id: 1, nombre: 'Planta Demo' },
    { empresa_id: 2, nombre: 'Minera Norte' },
  ],
  roles: ['tecnico', 'gerente'],
  usuarios: [
    { usuario_id: 2, nombre: 'Gerente 1', rol: 'gerente', empresa_id: 1 },
    { usuario_id: 4, nombre: 'Carlos', rol: 'tecnico', empresa_id: 1 },
    { usuario_id: 17, nombre: 'Gerente Norte', rol: 'gerente', empresa_id: 2 },
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
      usuario_id: 2,
      usuario_nombre: 'Gerente 1',
      usuario_email: 'gerente1@planta.com',
      empresa_id: 1,
      empresa_nombre: 'Planta Demo',
      perfil: 'gerente',
      accion: 'UPDATE empresa',
      operacion: 'UPDATE',
      tabla: 'empresa',
      registro_id: '1',
      detalle: { cambios: { notas: { antes: null, despues: 'hola' } } },
    },
  ],
};

describe('TransaccionesComponent', () => {
  let http: HttpTestingController;

  const listados = () => http.match((r) => r.url.endsWith('/transacciones'));
  const ultimo = (reqs: TestRequest[]) => reqs[reqs.length - 1];

  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TransaccionesComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/transacciones/filtros')).flush(OPCIONES);
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
    expect(fixture.nativeElement.textContent).toContain('Gerente 1');
    expect(fixture.nativeElement.textContent).toContain('Modificó');
  });

  it('cada filtro vuelve a consultar con sus parámetros', () => {
    const fixture = setup();

    elegir(fixture, 'trx-empresa', '2');
    let req = ultimo(listados());
    expect(req.request.params.get('empresa_id')).toBe('2');
    req.flush(PAGINA);

    elegir(fixture, 'trx-rol', 'gerente');
    req = ultimo(listados());
    expect(req.request.params.get('rol')).toBe('gerente');
    req.flush(PAGINA);

    elegir(fixture, 'trx-usuario', '17');
    req = ultimo(listados());
    expect(req.request.params.get('usuario_id')).toBe('17');
    req.flush(PAGINA);

    elegir(fixture, 'trx-rango', '24h');
    req = ultimo(listados());
    expect(req.request.params.get('rango')).toBe('24h');
    req.flush(PAGINA);
  });

  it('al cambiar de empresa se descarta el usuario que ya no corresponde', () => {
    const fixture = setup();
    elegir(fixture, 'trx-usuario', '4');
    ultimo(listados()).flush(PAGINA);

    elegir(fixture, 'trx-empresa', '2');
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
