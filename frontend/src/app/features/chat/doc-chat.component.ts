import { Component } from '@angular/core';

@Component({
  selector: 'app-doc-chat',
  standalone: true,
  template: `
    <div class="flex flex-col gap-4">
      <h1 class="text-2xl font-bold text-gray-800">DocChat</h1>
      <div class="bg-white p-10 rounded-lg shadow-sm border border-gray-100 text-center text-gray-500">
        Chat con IA en desarrollo — Pendiente de fase 2 del backend
      </div>
    </div>
  `
})
export class DocChatComponent {}
