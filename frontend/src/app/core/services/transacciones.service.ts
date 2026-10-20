import { Service, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { TransaccionesFiltros, TransaccionesOpciones, TransaccionesPage } from '../models';
import { environment } from '../../../environments/environment';

/** Bitácora de transacciones de los usuarios de las empresas (solo super_usuario). */
@Service()
export class TransaccionesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/transacciones`;

  getAll(f: TransaccionesFiltros) {
    let params = new HttpParams().set('rango', f.rango).set('limit', f.limit).set('offset', f.offset);
    if (f.empresa_id != null) params = params.set('empresa_id', f.empresa_id);
    if (f.rol) params = params.set('rol', f.rol);
    if (f.usuario_id != null) params = params.set('usuario_id', f.usuario_id);
    if (f.rango === 'custom') {
      if (f.desde) params = params.set('desde', f.desde);
      if (f.hasta) params = params.set('hasta', f.hasta);
    }
    return this.http.get<TransaccionesPage>(this.url, { params });
  }

  getFiltros() {
    return this.http.get<TransaccionesOpciones>(`${this.url}/filtros`);
  }
}
