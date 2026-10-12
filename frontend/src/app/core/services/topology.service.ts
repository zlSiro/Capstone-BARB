import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Topology } from '../models';
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
}
