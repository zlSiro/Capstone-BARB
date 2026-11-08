import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FinancialStats, HistoricoRespuesta } from '../models';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class StatsService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  getFinancialImpact(days?: number | 'all') {
    const query = days && days !== 'all' ? `?days=${days}` : '';
    return this.http.get<FinancialStats>(`${this.apiUrl}/stats/financial-impact${query}`);
  }

  /**
   * Serie histórica por período (CGBIDA-515).
   *
   * `granularity` decide el tamaño del balde (`month`, `semester` o `year`) y `days`
   * acota la ventana. Sin `days` el backend devuelve todo el histórico disponible.
   */
  getHistorical(granularity: 'month' | 'semester' | 'year', days?: number) {
    const params = [`granularity=${granularity}`];
    if (days) params.push(`days=${days}`);
    return this.http.get<HistoricoRespuesta>(
      `${this.apiUrl}/stats/historical?${params.join('&')}`
    );
  }
}
