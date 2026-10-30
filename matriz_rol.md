# Matriz de roles y privilegios

Fuente de verdad: `backend/src/barb/core/permissions.py` (matrices `RUTAS` y `ACCIONES`), con las reglas adicionales de
`routers/users.py`, `routers/empresas.py`, `routers/work_orders.py`, `routers/avisos.py` y `core/work_order_states.py`.
El frontend la replica en `frontend/src/app/core/permissions/permissions.ts` (solo controla qué se muestra; el backend es quien valida).
**Cualquier cambio de permisos debe hacerse en los tres lugares** (backend, frontend y este documento). Los tests
`backend/tests/test_permissions.py` y `frontend/src/app/core/permissions/permissions.spec.ts` verifican que no se desalineen.

Leyenda: ✔ acceso total · 👁 solo lectura · propio = solo lo suyo · — sin acceso

## Roles

| Rol | Qué es |
|---|---|
| `operador` | Personal de planta. Reporta fallas y sigue en qué quedaron; ve solo las OT que nacieron de sus avisos. |
| `tecnico` | Ejecuta el trabajo. Ve las OT que tiene asignadas, puede iniciarlas y reporta fallas. |
| `supervisor` | Dirige el trabajo: decide sobre los avisos, asigna, cambia estados y cancela OT. |
| `engineer` | Ingeniería: cambia estados y gestiona documentación técnica; analiza el historial. No cancela OT. |
| `gerente` | Responsable de la empresa: todo lo de supervisión, más eliminar OT, gestionar usuarios y su bitácora de empresa. |
| `admin` | Gobierno del sistema: usuarios operativos, plantas, máquinas, documentos y notificaciones. No opera sobre las OT. |
| `visitante` | Solo lectura limitada. Sin cambios en esta versión. |
| `super_usuario` | Contraparte comercial de BARB. Sin empresa: administra empresas y gerentes; no accede a datos operativos. |

## Pantallas y rutas (`RUTAS`)

| Pantalla / ruta | operador | tecnico | supervisor | engineer | gerente | admin | visitante | super_usuario |
|---|---|---|---|---|---|---|---|---|
| Órdenes de trabajo (`menu`) | propias | asignadas | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| **Avisos de falla (`avisos`)** | propios | propios | ✔ repositorio | propios | ✔ repositorio | — | — | — |
| DocChat (`docchat`), `debug`, `report` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| Topología, `memory` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | 👁 | — |
| Dashboard | — | — | ✔ | ✔ | ✔ | ✔ | 👁 | — |
| Historial (`history`) | — | — | ✔ | ✔ | ✔ | 👁 | — | — |
| Documentos | 👁 | 👁 | 👁 | ✔ | ✔ | ✔ | — | — |
| Plantas, disciplinas y máquinas (alta) | — | — | — | — | ✔ | ✔ | — | — |
| Notificaciones por correo | — | — | ✔ | — | ✔ | ✔ | — | — |
| Usuarios (mantenedor) | — | — | — | — | ✔ todos | ✔ operativos | — | ✔ solo gerentes |
| Empresas (mantenedor) | — | — | — | — | — | — | — | ✔ |
| Transacciones propias (`transacciones`) | — | — | — | — | — | — | — | ✔ |
| Transacciones de la empresa (`transacciones_empresa`) | — | — | — | — | ✔ | — | — | — |

## Acciones (`ACCIONES`)

| Acción | operador | tecnico | supervisor | engineer | gerente | admin | visitante | super_usuario |
|---|---|---|---|---|---|---|---|---|
| `crear_ot` (directa, sin aviso) | — | — | ✔ | — | ✔ | — | — | — |
| `cambiar_estado_ot` (iniciar o cerrar) | — | — | ✔ | ✔ | ✔ | — | — | — |
| `iniciar_ot_asignada` | — | solo la suya | — | — | — | — | — | — |
| `cancelar_ot` | — | — | ✔ | — | ✔ | — | — | — |
| `eliminar_ot` | — | — | — | — | ✔ | — | — | — |
| **`reportar_falla`** | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| **`gestionar_avisos`** (generar OT o descartar) | — | — | ✔ | — | ✔ | — | — | — |
| **`asignar_ot`** (priorizar, asignar y reasignar) | — | — | ✔ | — | ✔ | — | — | — |
| `subir_documentos`, `eliminar_documentos` | — | — | — | ✔ | ✔ | ✔ | — | — |
| `configurar_notificaciones` | — | — | ✔ | — | ✔ | ✔ | — | — |
| `ver_usuarios`, `gestionar_usuarios` | — | — | — | — | ✔ todos | ✔ operativos | — | ✔ solo gerentes |
| `gestionar_empresas` | — | — | — | — | — | — | — | ✔ |

## Reglas que no están en las matrices

- **Aislamiento por empresa:** todo usuario de empresa ve únicamente lo de su empresa, y el servidor ignora cualquier `empresa_id`
  que mande el cliente. Solo el superusuario puede indicar una empresa.
- **Alcance «propio» (operador y técnico):** ven las OT que tienen asignadas, que crearon, o que nacieron de un aviso suyo. Las demás
  responden 404 (no se revela que existen), tanto en el listado, el detalle, la topología como en el canal en tiempo real (SSE).
  El resto de los roles de empresa ve todas las OT de su empresa.
- **Aviso de falla → OT:** quien reporta (con foto opcional) ve solo sus avisos. Supervisor y gerente ven el repositorio completo y deciden: generar una OT
  (queda enlazada al aviso) o descartar (con motivo obligatorio, que ve quien reportó). Detalle en `docs/AVISOS_FALLA.md`.
- **Estados de las OT:** `pending → in_progress → completed`, y cualquier estado activo puede pasar a `cancelled`. `completed` y
  `cancelled` son finales. El técnico asignado solo puede iniciar su OT; un técnico que no es el asignado recibe 403.
- **Gestión de usuarios:**
  - Nadie puede asignar `super_usuario`.
  - El **administrador** solo ve y gestiona usuarios operativos (operador, técnico, supervisor, ingeniero y visitante): no puede
    crear, ver, editar ni eliminar gerentes ni otros administradores. Esos los gestiona el gerente.
  - Un usuario no puede desactivarse, cambiarse el rol ni eliminarse a sí mismo.
  - No se puede convertir a alguien en superusuario ni al revés.
  - Se respeta el límite de licencias `max_usuarios`.
- **Superusuario:**
  - Solo crea y gestiona usuarios con perfil gerente.
  - No accede a OT, avisos, dashboard, topología, DocChat ni documentos.
  - Las empresas no se eliminan, solo se suspenden; una empresa suspendida bloquea el acceso de todos sus usuarios.
  - Ve únicamente sus propias transacciones (las de usuarios con rol `super_usuario`).
- **Bitácora (`transacciones`):** el gerente ve las transacciones de los usuarios de su empresa, sin las del superusuario.
  Ninguna vista muestra transacciones sin usuario identificado.

## Detalles a tener presentes

1. **Algunas pantallas solo se restringen en la interfaz.** El backend no valida `menu`, `debug`, `memory`, `report`, `history` ni
   `docchat` con la matriz: cuando el frontend oculta una pantalla, la restricción está solo ahí. El backend sí aplica la matriz en
   dashboard, topología, documentos, plantas, notificaciones, usuarios, empresas, avisos y ambas bitácoras.
2. **El chat IA no usa la matriz.** `/api/chat` solo exige una sesión válida y excluye al superusuario.
3. **Pendiente de las fases siguientes** (no implementado): registro de avance del técnico (notas, fotos, repuestos), datos de cierre
   obligatorios (resolución, tiempo de parada, costo) y separación de los KPIs financieros del dashboard para el gerente.
