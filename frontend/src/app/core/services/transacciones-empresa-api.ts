import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TransaccionesEmpresaOpciones, TransaccionesFiltros, TransaccionesPage } from '../models';
import { environment } from '../../../environments/environment';
import { transaccionesParams } from './transacciones.service';

/** Transacciones de los usuarios de la propia empresa (gerente). El backend toma la empresa de la sesión. */
@Service()
export class TransaccionesEmpresaApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/empresa/transacciones`;

  getAll(f: TransaccionesFiltros) {
    return this.http.get<TransaccionesPage>(this.url, { params: transaccionesParams({ ...f, empresa_id: null }) });
  }

  getFiltros() {
    return this.http.get<TransaccionesEmpresaOpciones>(`${this.url}/filtros`);
  }
}
