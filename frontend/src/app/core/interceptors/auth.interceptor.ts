import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { TenantContextService } from '../services/tenant-context.service';

// Endpoints que no se filtran por empresa (el mantenedor de empresas lista todas).
const NO_TENANT_FILTER = ['/api/empresas', '/api/auth', '/auth/'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const tenant = inject(TenantContextService);
  const token = auth.getToken();

  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
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
    !NO_TENANT_FILTER.some(p => req.url.startsWith(p)) &&
    !req.params.has('empresa_id')
  ) {
    req = req.clone({ setParams: { empresa_id: String(empresaId) } });
  }

  return next(req);
};
