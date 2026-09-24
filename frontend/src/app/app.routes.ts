import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { MainLayoutComponent } from './shared/components/layout/main-layout/main-layout.component';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'work-orders',
        loadComponent: () => import('./features/work-orders/pages/work-orders-list/work-orders-list.component').then(m => m.WorkOrdersListComponent)
      },
      {
        path: 'topology',
        loadComponent: () => import('./features/topology/topology.component').then(m => m.TopologyComponent)
      },
      {
        path: 'chat',
        loadComponent: () => import('./features/chat/doc-chat.component').then(m => m.DocChatComponent)
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },
  { path: '**', redirectTo: 'login' }
];
