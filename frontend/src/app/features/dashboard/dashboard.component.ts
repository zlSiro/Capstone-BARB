import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsService } from '../../core/services/stats.service';
import { FinancialStats } from '../../core/models';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">Dashboard KPI</h1>
        <p class="text-sm text-gray-500">Impacto basado en US$2,000/min de inactividad</p>
      </div>

      <button
        (click)="testToast()"
        class="bg-blue-600 text-white px-4 py-2 rounded text-sm mb-4">
        Test Toast
      </button>


      <!-- @if (loading()) {
        <div class="text-center py-10 text-gray-500">Cargando KPIs...</div>
      } @else if (stats()) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
            <p class="text-xs text-gray-500 uppercase">MTTR Global</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats()!.financials.mttr }}m</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
            <p class="text-xs text-gray-500 uppercase">Eficiencia</p>
            <p class="text-2xl font-bold text-green-600">{{ stats()!.financials.efficiency }}%</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
            <p class="text-xs text-gray-500 uppercase">Costo Directo</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats()!.financials.costo_total_acumulado | currency:'CLP':'symbol-narrow':'1.0-0' }}</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
            <p class="text-xs text-gray-500 uppercase">MTBF Global</p>
            <p class="text-2xl font-bold text-gray-800">{{ stats()!.financials.mtbfHours ?? '—' }} h</p>
          </div>
        </div>

        <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <p class="text-xs text-gray-500 uppercase">Ahorro generado a la fecha</p>
          <p class="text-3xl font-bold text-orange-600">
            {{ stats()!.financials.ahorro_generado | currency:'CLP':'symbol-narrow':'1.0-0' }}
          </p>
        </div>
      } @else {
        <div class="text-center py-10 text-red-500">No se pudieron cargar los KPIs</div>
      } -->
    </div>
  `
})
export class DashboardComponent implements OnInit {
  private statsService = inject(StatsService);
  private toast = inject(ToastService);
  stats = signal<FinancialStats | null>(null);
  loading = signal(true);

  ngOnInit() {
    this.statsService.getFinancialImpact('all').subscribe({
      next: (data) => {
        this.stats.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

 
  testToast() {
    this.toast.success('¡Funciona! Mensaje de éxito');
    setTimeout(() => this.toast.error('Este es un error'), 500);
    setTimeout(() => this.toast.info('Info adicional'), 1000);
    setTimeout(() => this.toast.warning('Y una advertencia'), 1500);
  }
}
