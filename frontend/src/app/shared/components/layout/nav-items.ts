import { RutaKey } from '../../../core/permissions/permissions';
import { IconName } from '../ui/icon/icon';

export interface NavItem {
  path: string;
  icon: IconName;
  /** Clave de `nav.*` en translations.ts (nombre completo y versión corta para la barra inferior). */
  label: 'avisos' | 'workOrders' | 'dashboard' | 'topology' | 'chat' | 'documentos' | 'usuarios' | 'empresas' | 'transacciones' | 'ayuda';
  /** Pantalla de la matriz de permisos que habilita el ítem. Sin `ruta`, el ítem se muestra a toda sesión iniciada (p. ej. Ayuda). */
  ruta?: RutaKey;
  /** Orden de prioridad en la barra inferior del móvil (1 = primero). Lo que no cabe va al menú «Más». */
  prioridad: number;
}

/** Orden del menú. Cada ítem solo aparece si el rol tiene acceso a su ruta (el backend igualmente valida cada endpoint). */
export const NAV_ITEMS: NavItem[] = [
  { path: '/empresas', icon: 'edificio', label: 'empresas', ruta: 'empresas', prioridad: 1 },
  { path: '/transacciones', icon: 'registro', label: 'transacciones', ruta: 'transacciones', prioridad: 2 },
  { path: '/transacciones-empresa', icon: 'registro', label: 'transacciones', ruta: 'transacciones_empresa', prioridad: 4 },
  { path: '/dashboard', icon: 'panel', label: 'dashboard', ruta: 'dashboard', prioridad: 3 },
  { path: '/avisos', icon: 'etiqueta', label: 'avisos', ruta: 'avisos', prioridad: 1 },
  { path: '/work-orders', icon: 'orden', label: 'workOrders', ruta: 'menu', prioridad: 2 },
  { path: '/topology', icon: 'topologia', label: 'topology', ruta: 'topology', prioridad: 4 },
  { path: '/chat', icon: 'chat', label: 'chat', ruta: 'docchat', prioridad: 5 },
  { path: '/documentos', icon: 'libro', label: 'documentos', ruta: 'documentos', prioridad: 6 },
  { path: '/usuarios', icon: 'usuarios', label: 'usuarios', ruta: 'usuarios', prioridad: 3 },
  // Contenido fijo del frontend: sin ruta de la matriz, lo ve toda sesión. Siempre al final del menú (WCAG 2.2, criterio 3.2.6).
  { path: '/ayuda', icon: 'ayuda', label: 'ayuda', prioridad: 99 },
];

/** ¿El ítem es la pestaña de ayuda? Va separada al fondo del menú lateral y siempre dentro de «Más» en el celular. */
export const esAyuda = (item: NavItem): boolean => item.label === 'ayuda';

