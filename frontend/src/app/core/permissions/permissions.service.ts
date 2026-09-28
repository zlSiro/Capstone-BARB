import { Injectable, inject, computed } from '@angular/core';
import { AuthService } from '../services/auth.service';
import {
  puedeAccederRuta,
  puedeEjecutarAccion,
  canAccessPage,
  canPerformAction,
  getDefaultRouteForRole,
  RutaKey,
  AccionKey,
  AppPage,
} from './permissions';

@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private auth = inject(AuthService);

  // Signals reactivos al rol actual
  readonly role = computed(() => this.auth.user()?.role ?? null);

  // ---------------------------------------------------------------------------
  // Verificaciones de rutas
  // ---------------------------------------------------------------------------

  canAccess(ruta: RutaKey, soloLectura = true): boolean {
    return puedeAccederRuta(this.role(), ruta, soloLectura);
  }

  canAccessPage(page: AppPage, soloLectura = true): boolean {
    return canAccessPage(this.role(), page, soloLectura);
  }

  // ---------------------------------------------------------------------------
  // Verificaciones de acciones
  // ---------------------------------------------------------------------------

  canPerform(accion: AccionKey): boolean {
    return puedeEjecutarAccion(this.role(), accion);
  }

  canPerformAction(action: AccionKey): boolean {
    return canPerformAction(this.role(), action);
  }

  // ---------------------------------------------------------------------------
  // Ruta por defecto del rol
  // ---------------------------------------------------------------------------

  getDefaultRoute(): string {
    return getDefaultRouteForRole(this.role());
  }
}
