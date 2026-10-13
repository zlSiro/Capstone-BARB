import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Topology, TopologyNodoDetalle } from '../models';
import { environment } from '../../../environments/environment';

/** Topología de planta: plantas, disciplinas y máquinas de la empresa del usuario. */
@Service()
export class TopologyService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/topology`;

  /**
   * El interceptor acota a la empresa del usuario; el backend aísla por `empresa_id`
   * (CGBIDA-356). Un usuario normal nunca recibe equipos de otra empresa.
   */
  get() {
    return this.http.get<Topology>(this.url);
  }

  /**
   * Un nodo del mapa con sus órdenes de trabajo y sus hijos (CGBIDA-379).
   *
   * Un nodo de otra empresa devuelve 404, no 403: el backend no revela si existe
   * (`docs/contrato_api_topologia.md`, sección "Aislamiento multi-empresa").
   */
  getNodo(nodoId: string) {
    return this.http.get<TopologyNodoDetalle>(`${this.url}/${encodeURIComponent(nodoId)}`);
  }
}
