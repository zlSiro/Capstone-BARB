import { Component } from '@angular/core';

@Component({
  selector: 'app-topology',
  standalone: true,
  template: `
    <div class="flex flex-col gap-4">
      <h1 class="text-2xl font-bold text-gray-800">Topología de Planta</h1>
      <div class="bg-white p-10 rounded-lg shadow-sm border border-gray-100 text-center text-gray-500">
        Mapa interactivo en desarrollo — Pendiente de integración con backend
      </div>
    </div>
  `
})
export class TopologyComponent {}
