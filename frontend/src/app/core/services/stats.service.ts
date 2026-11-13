import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  FinancialStats,
  FiltrosDashboard,
  GRANULARIDAD_POR_RANGO,
  HistoricoRespuesta,
} from '../models';
import { environment } from '../../../environments/environment';

/**
 * Suma los filtros de topología a los params (CGBIDA-550).
 *
 * Solo viaja el que tiene valor: mandar `planta_id=null` haría que FastAPI intentara
 * convertirlo a entero. Ausente = sin restricción, que es lo que significa `null` en
 * `FiltrosDashboard`.
 */
function conFiltrosTopologia(base: HttpParams, filtros: FiltrosDashboard): HttpParams {
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
   * `filtros.rango` acota la ventana temporal (`'all'` = histórico completo) y los tres
   * IDs acotan la topología. Todo sale del mismo objeto del panel de control, así que es
   * imposible pedir los KPIs de una planta con el rango de otra selección.
   */
  getFinancialImpact(filtros: FiltrosDashboard) {
    let params = new HttpParams();
    if (filtros.rango !== 'all') params = params.set('days', filtros.rango);
    params = conFiltrosTopologia(params, filtros);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<FinancialStats>(`${this.apiUrl}/stats/financial-impact${query}`);
  }

  /**
   * Serie histórica por período.
   *
   * La granularidad no se elige acá: la decide el rango global (`GRANULARIDAD_POR_RANGO`),
   * para que el gráfico muestre el mismo período que los KPIs de arriba.
   */
  getHistorical(filtros: FiltrosDashboard) {
    const { granularity, days } = GRANULARIDAD_POR_RANGO[filtros.rango];
    let params = new HttpParams().set('granularity', granularity);
    if (days) params = params.set('days', days);
    params = conFiltrosTopologia(params, filtros);
    return this.http.get<HistoricoRespuesta>(
      `${this.apiUrl}/stats/historical?${params.toString()}`
    );
  }
}
