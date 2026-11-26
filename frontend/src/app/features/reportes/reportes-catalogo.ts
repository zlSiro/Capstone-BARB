import { Role } from '../../core/models';
import { GrupoReporte, ReporteId } from '../../core/models';
import { AccionKey, ROLES_REPOSITORIO_AVISOS, RutaKey } from '../../core/permissions/permissions';

/**
 * Catálogo de reportes: qué reportes existen y qué necesita cada uno.
 *
 * Igual que `ayuda-contenido.ts`, aquí NO hay listas de roles: cada reporte declara las claves de la matriz de permisos
 * (`RutaKey` / `AccionKey`) que necesita y se filtra con los permisos del perfil. La matriz de `permissions.ts` sigue siendo
 * la única fuente de verdad. La única excepción es R7, que usa la constante `ROLES_REPOSITORIO_AVISOS` (quién ve el
 * repositorio completo de avisos), que ya existe en la matriz.
 */
export type Condicion =
  | { ruta: RutaKey }
  | { accion: AccionKey }
  /** El perfil NO tiene esa ruta (R8: «Mi actividad» es para quien no tiene dashboard). */
  | { sinRuta: RutaKey }
  | { repositorioAvisos: true };

export interface Requisito {
  /** Todas deben cumplirse. */
  todas?: Condicion[];
  /** Basta con una. */
  alguna?: Condicion[];
}

/** Lo mínimo de permisos que el catálogo necesita (lo implementa `PermissionsService`; los tests usan la matriz real). */
export interface PermisosReporte {
  role(): Role | null;
  canAccess(ruta: RutaKey): boolean;
  canPerform(accion: AccionKey): boolean;
}

export interface ReporteDef {
  id: ReporteId;
  grupo: GrupoReporte;
  requiere: Requisito;
  /** ¿Su dato depende del periodo? (R3 es una foto del momento; R7 y R8 usan el periodo solo en el cliente). */
  usaPeriodo: boolean;
}

export const REPORTES: readonly ReporteDef[] = [
  { id: 'r1', grupo: 'desempeno', requiere: { todas: [{ ruta: 'dashboard' }] }, usaPeriodo: true },
  { id: 'r2', grupo: 'desempeno', requiere: { todas: [{ ruta: 'dashboard' }] }, usaPeriodo: true },
  { id: 'r5', grupo: 'desempeno', requiere: { todas: [{ ruta: 'dashboard' }] }, usaPeriodo: true },
  { id: 'r3', grupo: 'operacion', requiere: { todas: [{ ruta: 'dashboard' }] }, usaPeriodo: false },
  { id: 'r7', grupo: 'operacion', requiere: { todas: [{ repositorioAvisos: true }] }, usaPeriodo: true },
  { id: 'r8', grupo: 'operacion', requiere: { todas: [{ accion: 'reportar_falla' }, { sinRuta: 'dashboard' }] }, usaPeriodo: true },
  { id: 'r9', grupo: 'operacion', requiere: { todas: [{ ruta: 'menu' }] }, usaPeriodo: false },
  { id: 'r4', grupo: 'confiabilidad', requiere: { todas: [{ ruta: 'dashboard' }] }, usaPeriodo: true },
  { id: 'r6', grupo: 'confiabilidad', requiere: { todas: [{ accion: 'ver_kpis_financieros' }] }, usaPeriodo: true },
  { id: 'r10', grupo: 'confiabilidad', requiere: { alguna: [{ accion: 'cambiar_estado_ot' }, { ruta: 'plantas' }] }, usaPeriodo: true },
];

export const GRUPOS: readonly GrupoReporte[] = ['desempeno', 'operacion', 'confiabilidad'];

function cumple(c: Condicion, p: PermisosReporte): boolean {
  if ('ruta' in c) return p.canAccess(c.ruta);
  if ('accion' in c) return p.canPerform(c.accion);
  if ('sinRuta' in c) return !p.canAccess(c.sinRuta);
  const rol = p.role();
  return rol !== null && ROLES_REPOSITORIO_AVISOS.includes(rol);
}

export function puedeVerReporte(def: ReporteDef, p: PermisosReporte): boolean {
  if (p.role() === 'super_usuario' || p.role() === null) return false;
  const { todas, alguna } = def.requiere;
  const todasOk = (todas ?? []).every((c) => cumple(c, p));
  const algunaOk = !alguna || alguna.some((c) => cumple(c, p));
  return todasOk && algunaOk;
}

/** Reportes que el perfil puede abrir, en el orden del catálogo. */
export function reportesVisibles(p: PermisosReporte): ReporteDef[] {
  return REPORTES.filter((r) => puedeVerReporte(r, p));
}

/** Biblioteca agrupada: un grupo sin reportes para el perfil no se muestra. */
export function biblioteca(p: PermisosReporte): { grupo: GrupoReporte; reportes: ReporteDef[] }[] {
  const visibles = reportesVisibles(p);
  return GRUPOS.map((grupo) => ({ grupo, reportes: visibles.filter((r) => r.grupo === grupo) })).filter((g) => g.reportes.length > 0);
}

export function reportePorId(id: string | null | undefined): ReporteDef | undefined {
  return REPORTES.find((r) => r.id === id);
}
