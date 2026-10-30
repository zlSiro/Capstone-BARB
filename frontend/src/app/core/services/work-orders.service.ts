import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WorkOrder, WorkOrderStatus } from '../models';
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

  create(payload: FormData) {
    return this.http.post<WorkOrder>(`${this.apiUrl}/work-orders`, payload);
  }

  /** PATCH /work-orders/{n}/status — devuelve la OT actualizada con su historial de estados. */
  updateStatus(numeroOt: string, status: WorkOrderStatus, comment?: string) {
    return this.http.patch<WorkOrder>(`${this.apiUrl}/work-orders/${numeroOt}/status`, {
      status,
      ...(comment ? { comment } : {}),
    });
  }

  /** PATCH /work-orders/{n}/assignment — prioriza y asigna o reasigna una OT abierta (supervisor y gerente). */
  assign(numeroOt: string, changes: { tecnico_id?: number; priority?: string; fecha_vencimiento?: string }) {
    return this.http.patch<WorkOrder>(`${this.apiUrl}/work-orders/${numeroOt}/assignment`, changes);
  }

  delete(numeroOt: string) {
    return this.http.delete(`${this.apiUrl}/work-orders/${numeroOt}`);
  }
}
