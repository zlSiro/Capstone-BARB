// frontend/src/app/core/interceptors/auth.interceptor.ts

import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { TenantContextService } from '../services/tenant-context.service';
import { ToastService } from '../services/toast.service';
import { I18nService } from '../i18n/i18n.service';

// Endpoints que no se filtran por empresa (el mantenedor de empresas lista todas).
const NO_TENANT_FILTER = ['/api/empresas', '/api/auth', '/auth/'];

/**
 * Llamadas de autenticación excluidas del manejo de sesión expirada:
 * - /auth/login: un 401 aquí significa credenciales incorrectas, no sesión expirada.
 * - /auth/logout: el logout no debe re-disparar el redirect (evita loops).
 */
const EXCLUDED_URLS = ['/auth/login', '/auth/logout'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const tenant = inject(TenantContextService);
  const toast = inject(ToastService);
  const i18n = inject(I18nService);
  const token = auth.getToken();

  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  // Multi-empresa: cuando el super_usuario eligió una empresa, todas las consultas GET
  // quedan acotadas a ella. Para usuarios de empresa no se agrega nada: el backend
  // siempre usa la empresa de la sesión.
  const empresaId = tenant.empresaId();
  if (
    tenant.isSuper() &&
    empresaId !== null &&
    req.method === 'GET' &&
    req.url.startsWith('/api') &&
    !NO_TENANT_FILTER.some((p) => req.url.startsWith(p)) &&
    !req.params.has('empresa_id')
  ) {
    req = req.clone({ setParams: { empresa_id: String(empresaId) } });
  }

  const isAuthUrl = EXCLUDED_URLS.some((url) => req.url.includes(url));

  return next(req).pipe(
    catchError((error) => {
      if (error?.status === 401 && !isAuthUrl) {
        toast.show(i18n.t('common').sessionExpired, 'error');
        auth.logout();
      }
      return throwError(() => error);
    }),
  );
};