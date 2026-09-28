import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FinancialStats } from '../models';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class StatsService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  getFinancialImpact(days?: number | 'all') {
    const query = days && days !== 'all' ? `?days=${days}` : '';
    return this.http.get<FinancialStats>(`${this.apiUrl}/stats/financial-impact${query}`);
  }
}
