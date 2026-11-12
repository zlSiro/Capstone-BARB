import { Service, computed, inject } from '@angular/core';

import { I18nService } from '../../core/i18n/i18n.service';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AuthService } from '../../core/services/auth.service';
import { NAV_ITEMS } from '../../shared/components/layout/nav-items';
import { GuiaBusqueda } from './ayuda-buscador';
import { AyudaProgresoService } from './ayuda-progreso.service';
import { PRIMEROS_PASOS, RECORRIDOS, RecorridoDef, Requisito, TAREAS, TareaDef, claveRecorrido } from './ayuda-contenido';

export interface TareaVista {
  def: TareaDef;
  hecha: boolean;
}

/**
 * Qué ve cada perfil dentro de la ayuda. Todo se filtra con la matriz de permisos (`PermissionsService`): ninguna guía,
 * tarea ni recorrido se muestra a un rol sin la ruta o la acción que declara.
 */
@Service()
export class AyudaService {
  private readonly permisos = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly progreso = inject(AyudaProgresoService);
  private readonly i18n = inject(I18nService);

  readonly rol = computed(() => this.permisos.role());

  /** ¿El perfil actual cumple el requisito (ruta y/o acción de la matriz)? */
  cumple(req: Requisito | undefined): boolean {
    this.permisos.role();
    if (!req) return true;
    return (!req.ruta || this.permisos.canAccess(req.ruta)) && (!req.accion || this.permisos.canPerform(req.accion));
  }

  /** Recorridos que el perfil puede hacer. */
  readonly recorridos = computed<RecorridoDef[]>(() => RECORRIDOS.filter((r) => this.cumple(r.requiere)));

  /**
   * Guías sobre las que busca «Pregúntale a la ayuda»: las del perfil actual, con título y palabras clave en el IDIOMA ACTIVO
   * (se recalcula al cambiar de idioma). Cada guía es un recorrido: comparten texto y pasos.
   */
  readonly guias = computed<GuiaBusqueda[]>(() =>
    this.recorridos().map((r) => ({
      id: r.id,
      titulo: this.i18n.tr(claveRecorrido(r.id, 'titulo')),
      claves: this.i18n.tr(claveRecorrido(r.id, 'claves')),
    })),
  );

  recorrido(id: string): RecorridoDef | null {
    return this.recorridos().find((r) => r.id === id) ?? null;
  }

  /** Primeros pasos del perfil: solo las tareas cuyo requisito (y el de su recorrido) cumple. */
  readonly tareas = computed<TareaVista[]>(() => {
    const rol = this.rol();
    const ids = rol ? (PRIMEROS_PASOS[rol] ?? []) : [];
    const visibles = new Set(this.recorridos().map((r) => r.id));
    return ids
      .map((id) => TAREAS[id])
      .filter((t): t is TareaDef => !!t && this.cumple(t.requiere) && (!t.recorrido || visibles.has(t.recorrido)))
      .map((def) => ({ def, hecha: this.estaHecha(def) }));
  });

  readonly hechas = computed(() => this.tareas().filter((t) => t.hecha).length);

  private estaHecha(def: TareaDef): boolean {
    if (def.automatica === 'privilegios') return !this.auth.privilegiosPendientes();
    return !!def.recorrido && this.progreso.hechos().includes(def.recorrido);
  }

  /**
   * Pantalla del menú a la que lleva «Ir a …»: solo si el perfil puede entrar (la ruta sale de `nav-items`, que ya sabe
   * qué `RutaKey` pide cada pantalla). Devuelve la ruta y la clave de texto del menú.
   */
  pantalla(ruta: string | undefined): { path: string; nav: string } | null {
    this.permisos.role();
    const item = ruta ? NAV_ITEMS.find((i) => i.path === ruta) : undefined;
    if (!item || (item.ruta && !this.permisos.canAccess(item.ruta))) return null;
    return { path: item.path, nav: `nav.${item.label}` };
  }
}
