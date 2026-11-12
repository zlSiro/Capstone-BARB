import { AccionKey, RutaKey } from '../../core/permissions/permissions';

/**
 * Contenido de «Aprende BARB»: qué recorridos y tareas existen y qué necesita cada uno.
 *
 * Nota: el espejo de permisos del frontend (`permissions.ts`) todavía no tiene `validar_ot` ni `enviar_a_validacion` (existen
 * en el backend). Mientras tanto se usan sus equivalentes en la matriz del frontend: `cambiar_estado_ot` (solo el supervisor,
 * quien valida y devuelve) e `iniciar_ot_asignada` (solo el técnico, quien inicia y envía a validación su OT).
 *
 * Los textos viven en `core/i18n/textos/ayuda.ts` (por convención de clave, ver `claveRecorrido` y `claveTarea`).
 * Aquí NO hay listas de roles: cada elemento declara la `RutaKey` y/o `AccionKey` que necesita y se filtra con
 * `PermissionsService.canAccess()` / `canPerform()`, así la matriz de `permissions.ts` sigue siendo la única fuente de verdad.
 */
export interface Requisito {
  ruta?: RutaKey;
  accion?: AccionKey;
}

export interface PasoDef {
  /** Ruta donde ocurre el paso. Si falta, hereda la del paso anterior (o la pantalla actual en el primero). */
  ruta?: string;
  /** Valor del atributo `data-tour` del elemento a resaltar. Sin objetivo, el paso se muestra sin resaltado. */
  objetivo?: string;
}

export interface RecorridoDef {
  id: string;
  requiere: Requisito;
  /** Pantalla a la que lleva «Ir a …» (debe ser la ruta de un ítem del menú). */
  pantalla?: string;
  pasos: PasoDef[];
}

export interface TareaDef {
  id: string;
  requiere?: Requisito;
  /** Recorrido que se inicia con «Mostrarme cómo»; la tarea se marca como hecha al terminarlo. */
  recorrido?: string;
  /** Tareas que se marcan solas: `privilegios` = ya se aceptó el aviso de privilegios. */
  automatica?: 'privilegios';
}

/** Clave i18n de un texto de un recorrido (`titulo`, `resumen`, `claves`, `p1_titulo`, `p1_texto`…). */
export const claveRecorrido = (id: string, sufijo: string): string => `ayuda.r_${id}_${sufijo}`;
/** Clave i18n de un texto de una tarea de primeros pasos (`titulo`, `desc`). */
export const claveTarea = (id: string, sufijo: 'titulo' | 'desc'): string => `ayuda.t_${id}_${sufijo}`;

export const RECORRIDOS: readonly RecorridoDef[] = [
  { id: 'reportar_falla', requiere: { accion: 'reportar_falla' }, pantalla: '/avisos', pasos: [{ objetivo: 'reportar-falla' }, {}] },
  { id: 'seguir_aviso', requiere: { ruta: 'avisos' }, pantalla: '/avisos', pasos: [{ ruta: '/avisos', objetivo: 'aviso-fila' }, { objetivo: 'aviso-fila' }] },
  { id: 'ver_ot', requiere: { ruta: 'menu' }, pantalla: '/work-orders', pasos: [{ ruta: '/work-orders', objetivo: 'ot-fila' }, { objetivo: 'ot-fila' }] },
  { id: 'docchat', requiere: { ruta: 'docchat' }, pantalla: '/chat', pasos: [{ ruta: '/chat', objetivo: 'chat-pregunta' }, { objetivo: 'chat-pregunta' }] },
  {
    id: 'iniciar_enviar',
    requiere: { accion: 'iniciar_ot_asignada' },
    pantalla: '/work-orders',
    pasos: [{ ruta: '/work-orders', objetivo: 'ot-fila' }, { objetivo: 'ot-fila' }, { objetivo: 'ot-estado' }, { objetivo: 'ot-estado' }, {}],
  },
  { id: 'revisar_avisos', requiere: { ruta: 'avisos' }, pantalla: '/avisos', pasos: [{ ruta: '/avisos', objetivo: 'aviso-fila' }, { objetivo: 'aviso-fila' }] },
  { id: 'generar_ot', requiere: { accion: 'gestionar_avisos' }, pantalla: '/avisos', pasos: [{ ruta: '/avisos', objetivo: 'aviso-generar' }, { objetivo: 'aviso-descartar' }] },
  { id: 'validar_devolver', requiere: { accion: 'cambiar_estado_ot' }, pantalla: '/work-orders', pasos: [{ ruta: '/work-orders', objetivo: 'ot-fila' }, { objetivo: 'ot-estado' }, {}] },
  { id: 'salud_operacional', requiere: { ruta: 'dashboard' }, pantalla: '/dashboard', pasos: [{ ruta: '/dashboard', objetivo: 'dash-salud' }, { objetivo: 'dash-kpis' }] },
  { id: 'dashboard_operativo', requiere: { ruta: 'dashboard' }, pantalla: '/dashboard', pasos: [{ ruta: '/dashboard', objetivo: 'dash-kpis' }, { objetivo: 'dash-salud' }] },
  { id: 'top5', requiere: { ruta: 'dashboard' }, pantalla: '/dashboard', pasos: [{ ruta: '/dashboard', objetivo: 'dash-top5' }, { objetivo: 'dash-top5' }] },
  { id: 'subir_documento', requiere: { accion: 'subir_documentos' }, pantalla: '/documentos', pasos: [{ ruta: '/documentos', objetivo: 'doc-subir' }, {}] },
  {
    id: 'dashboard_completo',
    requiere: { ruta: 'dashboard', accion: 'ver_kpis_financieros' },
    pantalla: '/dashboard',
    pasos: [{ ruta: '/dashboard', objetivo: 'dash-kpis' }, { objetivo: 'dash-costo' }, { objetivo: 'dash-salud' }],
  },
  {
    id: 'costo_maquina',
    requiere: { ruta: 'dashboard', accion: 'ver_kpis_financieros' },
    pantalla: '/dashboard',
    pasos: [{ ruta: '/dashboard', objetivo: 'dash-costo' }, { objetivo: 'dash-costo-detalle' }],
  },
  { id: 'crear_usuario', requiere: { ruta: 'usuarios', accion: 'gestionar_usuarios' }, pantalla: '/usuarios', pasos: [{ ruta: '/usuarios', objetivo: 'usuarios-nuevo' }, {}] },
  { id: 'bitacora', requiere: { ruta: 'transacciones_empresa' }, pantalla: '/transacciones-empresa', pasos: [{ ruta: '/transacciones-empresa', objetivo: 'trx-tabla' }, { objetivo: 'trx-tabla' }] },
  { id: 'registrar_planta', requiere: { ruta: 'plantas' }, pantalla: '/topology', pasos: [{ ruta: '/topology', objetivo: 'topo-gestionar' }, {}] },
  { id: 'disciplinas', requiere: { ruta: 'plantas' }, pantalla: '/topology', pasos: [{ ruta: '/topology', objetivo: 'topo-gestionar' }, {}] },
  { id: 'crear_empresa', requiere: { accion: 'gestionar_empresas' }, pantalla: '/empresas', pasos: [{ ruta: '/empresas', objetivo: 'empresas-nueva' }, {}, {}] },
  { id: 'suspender_empresa', requiere: { accion: 'gestionar_empresas' }, pantalla: '/empresas', pasos: [{ ruta: '/empresas', objetivo: 'empresa-estado' }, {}] },
  { id: 'mis_transacciones', requiere: { ruta: 'transacciones' }, pantalla: '/transacciones', pasos: [{ ruta: '/transacciones', objetivo: 'trx-tabla' }] },
];

export const TAREAS: Readonly<Record<string, TareaDef>> = Object.fromEntries(
  (
    [
      { id: 'privilegios', automatica: 'privilegios' },
      { id: 'reportar_falla', requiere: { accion: 'reportar_falla' }, recorrido: 'reportar_falla' },
      { id: 'seguir_aviso', requiere: { ruta: 'avisos' }, recorrido: 'seguir_aviso' },
      { id: 'ver_ot_generada', requiere: { ruta: 'menu' }, recorrido: 'ver_ot' },
      { id: 'docchat', requiere: { ruta: 'docchat' }, recorrido: 'docchat' },
      { id: 'iniciar_ot', requiere: { accion: 'iniciar_ot_asignada' }, recorrido: 'iniciar_enviar' },
      { id: 'enviar_validacion', requiere: { accion: 'iniciar_ot_asignada' }, recorrido: 'iniciar_enviar' },
      { id: 'revisar_avisos', requiere: { ruta: 'avisos' }, recorrido: 'revisar_avisos' },
      { id: 'generar_ot', requiere: { accion: 'gestionar_avisos' }, recorrido: 'generar_ot' },
      { id: 'validar_devolver', requiere: { accion: 'cambiar_estado_ot' }, recorrido: 'validar_devolver' },
      { id: 'salud', requiere: { ruta: 'dashboard' }, recorrido: 'salud_operacional' },
      { id: 'dash_operativo', requiere: { ruta: 'dashboard' }, recorrido: 'dashboard_operativo' },
      { id: 'top5', requiere: { ruta: 'dashboard' }, recorrido: 'top5' },
      { id: 'subir_documento', requiere: { accion: 'subir_documentos' }, recorrido: 'subir_documento' },
      { id: 'dashboard_completo', requiere: { ruta: 'dashboard', accion: 'ver_kpis_financieros' }, recorrido: 'dashboard_completo' },
      { id: 'costo_maquina', requiere: { ruta: 'dashboard', accion: 'ver_kpis_financieros' }, recorrido: 'costo_maquina' },
      { id: 'crear_administrador', requiere: { accion: 'gestionar_usuarios' }, recorrido: 'crear_usuario' },
      { id: 'crear_usuario_operativo', requiere: { accion: 'gestionar_usuarios' }, recorrido: 'crear_usuario' },
      { id: 'bitacora', requiere: { ruta: 'transacciones_empresa' }, recorrido: 'bitacora' },
      { id: 'registrar_planta', requiere: { ruta: 'plantas' }, recorrido: 'registrar_planta' },
      { id: 'disciplinas', requiere: { ruta: 'plantas' }, recorrido: 'disciplinas' },
      { id: 'consultar_ot', requiere: { ruta: 'menu' }, recorrido: 'ver_ot' },
      { id: 'crear_empresa', requiere: { accion: 'gestionar_empresas' }, recorrido: 'crear_empresa' },
      { id: 'crear_gerente', requiere: { accion: 'gestionar_empresas' }, recorrido: 'crear_empresa' },
      { id: 'suspender', requiere: { accion: 'gestionar_empresas' }, recorrido: 'suspender_empresa' },
      { id: 'mis_transacciones', requiere: { ruta: 'transacciones' }, recorrido: 'mis_transacciones' },
    ] satisfies TareaDef[]
  ).map((t) => [t.id, t]),
);

/**
 * Primeros pasos propuestos para cada perfil, en orden. Es solo la selección y el orden: que una tarea aparezca
 * depende además de que el perfil tenga la ruta o la acción que declara (si la matriz cambia, la tarea desaparece sola).
 *
 * Falta «Asignar una OT» (supervisor): el frontend todavía no tiene una pantalla para asignar, así que no hay nada
 * que mostrar. Cuando exista, se agrega su recorrido y su tarea aquí.
 */
export const PRIMEROS_PASOS: Readonly<Record<string, readonly string[]>> = {
  operador: ['privilegios', 'reportar_falla', 'seguir_aviso', 'ver_ot_generada', 'docchat'],
  tecnico: ['privilegios', 'reportar_falla', 'iniciar_ot', 'enviar_validacion', 'docchat'],
  supervisor: ['revisar_avisos', 'generar_ot', 'validar_devolver', 'salud'],
  engineer: ['dash_operativo', 'top5', 'subir_documento', 'reportar_falla', 'docchat'],
  gerente: ['dashboard_completo', 'costo_maquina', 'crear_administrador', 'bitacora', 'revisar_avisos'],
  admin: ['crear_usuario_operativo', 'registrar_planta', 'disciplinas', 'subir_documento', 'consultar_ot'],
  super_usuario: ['crear_empresa', 'crear_gerente', 'suspender', 'mis_transacciones'],
};
