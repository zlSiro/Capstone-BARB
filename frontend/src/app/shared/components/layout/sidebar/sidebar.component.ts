import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside class="w-56 bg-gray-900 text-gray-100 min-h-screen py-4">
      <nav class="flex flex-col gap-1 px-2">
        <a routerLink="/dashboard" routerLinkActive="bg-gray-700" class="px-3 py-2 rounded hover:bg-gray-800 flex items-center gap-2">
          <span>ğŸ“Š</span> Dashboard
        </a>
        <a routerLink="/work-orders" routerLinkActive="bg-gray-700" class="px-3 py-2 rounded hover:bg-gray-800 flex items-center gap-2">
          <span>ğŸ”§</span> Ã“rdenes de Trabajo
        </a>
        <a routerLink="/topology" routerLinkActive="bg-gray-700" class="px-3 py-2 rounded hover:bg-gray-800 flex items-center gap-2">
          <span>ğŸŒ</span> TopologÃ­a
        </a>
        <a routerLink="/chat" routerLinkActive="bg-gray-700" class="px-3 py-2 rounded hover:bg-gray-800 flex items-center gap-2">
          <span>í´–</span> DocChat
        </a>
      </nav>
    </aside>
  `
})
export class SidebarComponent {}
