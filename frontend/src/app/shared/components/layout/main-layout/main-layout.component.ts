import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ToastComponent } from '../../ui/toast/toast.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, ToastComponent],
  template: `
    <div class="h-screen flex flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden">
      <app-header />
      <div class="flex flex-1 min-h-0">
        <app-sidebar />
        <main [class]="mainClass()">
          <router-outlet />
        </main>
      </div>
      <app-toast />
    </div>
  `
})
export class MainLayoutComponent {
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly mainClass = computed(() => {
    const url = this.currentUrl();
 
    if (url.startsWith('/chat')) {
      return 'flex-1 min-w-0 overflow-hidden';
    }

    return 'flex-1 min-w-0 p-6 overflow-auto';
  });
}
