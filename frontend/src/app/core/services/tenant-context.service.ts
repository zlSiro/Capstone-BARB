import { Service, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

const STORAGE_KEY = 'barb_tenant_empresa_id';

/**
 * Contexto de empresa ("tenant") activo.
 *
 * - Usuario de empresa: siempre es su propia empresa (y el backend además lo fuerza).
 * - super_usuario: elige en la cabecera qué empresa quiere ver; `null` = todas.
 *   El interceptor agrega `?empresa_id=` a los GET y el chat lo envía en el body.
 */
@Service()
export class TenantContextService {
  private readonly auth = inject(AuthService);

  private readonly selected = signal<number | null>(this.load());

  readonly isSuper = computed(() => this.auth.user()?.role === 'super_usuario');

  /** Empresa que se está viendo (null = todas, solo posible para el super_usuario). */
  readonly empresaId = computed<number | null>(() => {
    if (!this.isSuper()) return this.auth.user()?.empresa_id ?? null;
    return this.selected();
  });

  select(empresaId: number | null): void {
    this.selected.set(empresaId);
    try {
      if (empresaId === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(empresaId));
    } catch {
      /* almacenamiento no disponible: el contexto sigue vigente en memoria */
    }
  }

  private load(): number | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  }
}
