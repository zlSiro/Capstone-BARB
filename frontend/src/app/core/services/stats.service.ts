import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FinancialStats, FiltrosDashboard, HistoricoRespuesta } from '../models';
import { environment } from '../../../environments/environment';

/**
 * Suma los filtros de topología a los params (CGBIDA-550).
 *
 * Solo viaja el que tiene valor: mandar `planta_id=null` haría que FastAPI intentara
 * convertirlo a entero. Ausente = sin restricción, que es lo que significa `null` en el
 * modelo `FiltrosDashboard`.
 */
function conFiltros(base: HttpParams, filtros?: FiltrosDashboard): HttpParams {
  if (!filtros) return base;
  let params = base;
  if (filtros.planta_id !== null) params = params.set('planta_id', filtros.planta_id);
  if (filtros.disciplina_id !== null) params = params.set('disciplina_id', filtros.disciplina_id);
  if (filtros.maquina_id !== null) params = params.set('maquina_id', filtros.maquina_id);
  return params;
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  /**
   * KPIs del Dashboard.
   *
   * `days` acota la ventana temporal (`'all'` = histórico completo) y `filtros` acota la
   * topología: planta, disciplina o máquina. Sin filtros, toda la empresa.
   */
  getFinancialImpact(days?: number | 'all', filtros?: FiltrosDashboard) {
    let params = new HttpParams();
    if (days && days !== 'all') params = params.set('days', days);
    params = conFiltros(params, filtros);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<FinancialStats>(`${this.apiUrl}/stats/financial-impact${query}`);
  }

  /**
   * Serie histórica por período (CGBIDA-515).
   *
   * `granularity` decide el tamaño del balde (`month`, `semester` o `year`) y `days`
   * acota la ventana; sin `days` el backend devuelve todo el histórico disponible.
   * `filtros` acota la topología igual que `getFinancialImpact`, para que el gráfico
   * muestre el mismo universo que los KPIs de arriba (CGBIDA-550).
   */
  getHistorical(
    granularity: 'month' | 'semester' | 'year',
    days?: number,
    filtros?: FiltrosDashboard
  ) {
    let params = new HttpParams().set('granularity', granularity);
    if (days) params = params.set('days', days);
    params = conFiltros(params, filtros);
    return this.http.get<HistoricoRespuesta>(
      `${this.apiUrl}/stats/historical?${params.toString()}`
    );
  }
}
