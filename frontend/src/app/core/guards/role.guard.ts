import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RutaKey } from '../permissions/permissions';

/**
 * Factory de guard por rol. Se usa en las rutas así:
 *
 *   {
 *     path: 'dashboard',
 *     canActivate: [roleGuard('dashboard')],
 *     loadComponent: ...
 *   }
 *
 * Delega la validación en PermissionsService (espejo de permissions.py).
 * Si el usuario no está logueado, redirige a /login.
 * Si está logueado pero no tiene permiso, redirige a /403.
 */
export const roleGuard = (ruta: RutaKey, soloLectura = true): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const permissions = inject(PermissionsService);
    const router = inject(Router);

    if (!auth.isLoggedIn()) {
      router.navigate(['/login']);
      return false;
    }

    if (!permissions.canAccess(ruta, soloLectura)) {
      router.navigate(['/403']);
      return false;
    }

    return true;
  };
};
