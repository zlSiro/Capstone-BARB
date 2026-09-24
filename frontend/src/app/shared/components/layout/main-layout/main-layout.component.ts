import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ToastComponent } from '../../ui/toast/toast.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, ToastComponent],
  template: `
    <div class="min-h-screen flex flex-col bg-gray-50">
      <app-header />
      <div class="flex flex-1">
        <app-sidebar />
        <main class="flex-1 p-6 overflow-auto">
          <router-outlet />
        </main>
      </div>
      <app-toast />
    </div>
  `
})
export class MainLayoutComponent {}
