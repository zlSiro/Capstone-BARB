import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WorkOrder } from '../models';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WorkOrdersService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  getAll() {
    return this.http.get<WorkOrder[]>(`${this.apiUrl}/work-orders`);
  }

  getByNumber(numeroOt: string) {
    return this.http.get<WorkOrder>(`${this.apiUrl}/work-orders/${numeroOt}`);
  }

  create(payload: Partial<WorkOrder>) {
    return this.http.post<WorkOrder>(`${this.apiUrl}/work-orders`, payload);
  }

  updateStatus(numeroOt: string, status: string) {
    return this.http.put(`${this.apiUrl}/work-orders/${numeroOt}/status`, { status });
  }

  delete(numeroOt: string) {
    return this.http.delete(`${this.apiUrl}/work-orders/${numeroOt}`);
  }
}
