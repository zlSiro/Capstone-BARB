import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { homeRedirectGuard, roleGuard } from './core/guards/role.guard';
import { MainLayoutComponent } from './shared/components/layout/main-layout/main-layout.component';
import { ForbiddenComponent } from './features/forbidden/forbidden.component';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: '403',
    component: ForbiddenComponent
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        canActivate: [roleGuard('dashboard')],
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'work-orders',
        canActivate: [roleGuard('menu')],
        loadComponent: () => import('./features/work-orders/pages/work-orders-list/work-orders-list.component').then(m => m.WorkOrdersListComponent)
      },
      {
        path: 'topology',
        canActivate: [roleGuard('topology')],
        loadComponent: () => import('./features/topology/topology.component').then(m => m.TopologyComponent)
      },
      {
        path: 'chat',
        canActivate: [roleGuard('docchat')],
        loadComponent: () =>
          import('./features/chat/doc-chat.component').then(m => m.DocChatComponent)
      },
      {
        path: 'chat/history',
        canActivate: [roleGuard('docchat')],
        loadComponent: () =>
          import('./features/chat/chat-history/chat-history.component').then(m => m.ChatHistoryComponent)
      },
      // --- Multi-empresa ---
      {
        path: 'empresas',
        canActivate: [roleGuard('empresas', false)],
        loadComponent: () => import('./features/empresas/empresas.component').then(m => m.EmpresasComponent)
      },
      {
        path: 'usuarios',
        canActivate: [roleGuard('usuarios', false)],
        loadComponent: () => import('./features/usuarios/usuarios.component').then(m => m.UsuariosComponent)
      },
      {
        path: 'documentos',
        canActivate: [roleGuard('documentos')],
        loadComponent: () => import('./features/documentos/documentos.component').then(m => m.DocumentosComponent)
      },
      // Redirección según el rol (super_usuario -> /empresas; el resto -> /dashboard o /work-orders)
      { path: '', canActivate: [homeRedirectGuard], children: [] }
    ]
  },
  { path: '**', redirectTo: 'login' }
];
