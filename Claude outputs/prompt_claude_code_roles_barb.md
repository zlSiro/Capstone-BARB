Necesito que implementes el rediseño de roles y privilegios de BARB que el equipo ya aprobó. Lee completo este mensaje antes de empezar y trabaja por etapas, verificando cada una.

## 0. Antes de tocar código

1. Lee `CLAUDE.md`, `AGENTS.md`, `frontend/CLAUDE.md`, `matriz_rol.md`, `docs/WORK_ORDERS.md` y `docs/NOTIFICACIONES.md`.
2. Ejecuta `git status`. Ya hay archivos modificados sin commitear (entre ellos `backend/migrations/versions/0013_eliminar_rol_visitante.py` y archivos de `backend/docs/samples/`). **No los toques ni los incluyas en tus cambios.** Si alguno interfiere con la tarea, detente y avísame.
3. Revisa las fuentes de verdad de permisos: `backend/src/barb/core/permissions.py` (`RUTAS`, `ACCIONES`, `ROLES_GESTIONABLES_POR_ADMIN`), `backend/src/barb/core/work_order_states.py`, `backend/src/barb/routers/users.py`, `backend/src/barb/routers/work_orders.py`, `backend/src/barb/routers/notifications.py` y `frontend/src/app/core/permissions/permissions.ts`.
4. Antes de programar, muéstrame un plan corto con los archivos que vas a modificar y espera mi confirmación.

## 1. Reglas obligatorias

- **Migraciones:** NO modifiques, renombres ni borres ninguna migración existente en `backend/migrations/versions/` (0001 a 0013). La única migración permitida es la NUEVA descrita en la etapa 3. JP autorizó este cambio estructural (decisión D6 validada por el equipo); es una excepción puntual a la regla de `AGENTS.md`, solo para lo que se indica aquí.
- No ejecutes `alembic upgrade` contra Supabase ni modifiques `alembic_version`. No cambies el esquema por fuera de la nueva migración.
- Todo cambio de permisos va en los tres lugares a la vez: backend (`permissions.py`), frontend (`permissions.ts`) y `matriz_rol.md`. Los tests `backend/tests/test_permissions.py` y `frontend/src/app/core/permissions/permissions.spec.ts` deben quedar alineados.
- Mantén las convenciones del repo: rutas con doble registro (guion y guion bajo), SQL crudo con psycopg3, filtro por empresa con `resolver_empresa`, claves de respuesta en español e inglés y auditoría en la misma transacción.
- No hagas commit ni push. Yo hago el commit con el resumen que me entregues al final.

## 2. Etapa A — Ajuste de matrices (sin cambios de esquema)

Matriz objetivo (✓ = acceso, — = sin acceso):

| Privilegio | operador | tecnico | supervisor | engineer | admin | gerente | super_usuario |
|---|---|---|---|---|---|---|---|
| Reportar una falla | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| Ver órdenes de trabajo | propias | asignadas | ✓ | ✓ | lectura | lectura | — |
| Iniciar y registrar avance | — | asignadas | ✓ | — | — | — | — |
| Enviar a validación (nuevo) | — | asignadas | ✓ | — | — | — | — |
| Priorizar y asignar | — | — | ✓ | — | — | — | — |
| Validar y cerrar OT | — | — | ✓ | — | — | — | — |
| Cancelar OT (con motivo) | — | — | ✓ | — | — | — | — |
| Eliminar OT | — | — | — | — | — | — | — |
| KPIs operativos | — | — | ✓ | ✓ | — | ✓ | — |
| KPIs financieros | — | — | — | — | — | ✓ | — |
| Historial | — | — | ✓ | ✓ | — | ✓ | — |
| Gestionar usuarios | — | — | — | — | operativos | solo admin | solo gerentes |
| Plantas, máquinas y disciplinas | — | — | — | — | ✓ | — | — |
| Configurar notificaciones de atrasadas | — | — | ✓ | — | ✓ | — | — |
| Recibir escalamiento de atrasos (nuevo) | — | — | ✓ | — | — | ✓ | — |
| Subir documentos | lectura | lectura | lectura | ✓ | ✓ | lectura | — |
| Bitácora de la empresa | — | — | — | — | — | ✓ | — |
| Empresas y gerentes | — | — | — | — | — | — | ✓ |

Cambios concretos en `permissions.py`:

1. **gerente** → `False` en `cambiar_estado_ot`, `cancelar_ot`, `eliminar_ot`, `gestionar_avisos`, `asignar_ot`, `subir_documentos`, `eliminar_documentos` y `configurar_notificaciones`. En `RUTAS`: `plantas` y `notificaciones` en `False`; `documentos` en `"ver"`. Mantiene `menu`, `dashboard`, `history`, `avisos` (solo consulta del repositorio: no decide avisos), `usuarios` y `transacciones_empresa`. Revisa en `routers/avisos.py` que el gerente pueda ver el repositorio sin generar OT ni descartar avisos.
2. **engineer** → `False` en `cambiar_estado_ot`.
3. **admin** → `dashboard` y `history` en `False`.
4. **eliminar_ot** → `False` para todos los roles (decisión D1: el endpoint DELETE se mantiene y responde 403 por permisos; no lo borres).
5. **Gestión de usuarios en cascada** (D5): el gerente solo crea, ve, edita y elimina usuarios con rol `admin`. Crea una constante análoga a `ROLES_GESTIONABLES_POR_ADMIN` (por ejemplo `ROLES_GESTIONABLES_POR_GERENTE = frozenset({"admin"})`) y aplícala en `routers/users.py` con el mismo patrón que hoy usa el admin (403 al crear o asignar, 404 al ver o editar fuera de su alcance). Los gerentes solo los gestiona el `super_usuario`. Se mantienen las reglas actuales: nadie asigna `super_usuario`, nadie se modifica a sí mismo y se respeta `max_usuarios`.
6. **Al menos un supervisor activo:** en `routers/users.py` impide desactivar, eliminar o cambiar el rol del último supervisor activo de una empresa (409 con mensaje claro). No bloquees la creación de empresas nuevas que todavía no tengan supervisor.
7. Actualiza el frontend (`permissions.ts`) para que oculte lo que el gerente, el ingeniero y el admin ya no pueden hacer (botones de estado, asignar, cancelar, eliminar, mantenedor de plantas, configuración de notificaciones, subida de documentos y las pantallas de dashboard e historial para el admin).
8. Actualiza `test_permissions.py`, `permissions.spec.ts` y `matriz_rol.md`.

Ejecuta `uv run pytest`, `uv run ruff check` y `npm test` al terminar esta etapa y corrige lo que falle antes de seguir.

## 3. Etapa B — Doble validación del cierre (nueva migración)

### 3.1 Migración nueva

- Archivo: `backend/migrations/versions/0014_estado_por_validar.py`, con `revision = "0014_estado_por_validar"` y `down_revision = "0013_eliminar_rol_visitante"`. El id debe tener 32 caracteres o menos (`alembic_version.version_num` es `VARCHAR(32)`).
- Contenido: `ALTER TYPE estado_ot ADD VALUE IF NOT EXISTS 'por_validar' AFTER 'in_progress'`. Ejecútalo dentro de `op.get_context().autocommit_block()`, porque un valor nuevo de enum no se puede usar en la misma transacción en que se crea.
- `downgrade`: Postgres no permite quitar valores de un enum. Antes de hacer nada, el downgrade debe fallar con un mensaje claro si existe alguna OT en `por_validar`. Documenta en el docstring cómo se revierte y qué limitaciones tiene, con el mismo estilo de las migraciones 0012 y 0013.
- No apliques la migración en Supabase. Indica en el resumen final que debe aplicarse manualmente con `uv run alembic upgrade heads` antes de mergear.

### 3.2 Máquina de estados (`core/work_order_states.py`)

| Desde | Hacia | Quién | Condición |
|---|---|---|---|
| `pending` / `assigned` / `overdue` | `in_progress` | técnico asignado o supervisor | — |
| `in_progress` | `por_validar` | técnico asignado o supervisor | — |
| `por_validar` | `completed` | supervisor | no puede validar quien envió la OT a validación (D3, sin excepciones) |
| `por_validar` | `in_progress` | supervisor | devolución con comentario obligatorio |
| cualquier estado activo (incluido `por_validar`) | `cancelled` | supervisor | comentario (motivo) obligatorio |

- `in_progress → completed` directo deja de existir.
- Nuevas acciones en `ACCIONES`: `enviar_a_validacion` (tecnico solo sobre su OT asignada, supervisor) y `validar_ot` (supervisor). Actualiza `ACCION_POR_DESTINO` y `rol_puede_ir_a`, y agrega `ETIQUETA_ES["por_validar"] = "Por validar"`.
- Para la regla de "quien envía no valida", obtén quién hizo la última transición a `por_validar` desde la auditoría existente (`ot_audit_log`) dentro de la misma transacción `FOR UPDATE`. No agregues columnas.
- El motivo de cancelación y el comentario de devolución usan el campo `comment` que ya existe en `WorkOrderStatusRequest`; si viene vacío, responde 422.
- `allowed_transitions` debe considerar la regla de "quien envía no valida", para que el frontend no muestre "Validar" a quien no puede.
- Revisa que `por_validar` cuente como estado activo en todo lo que hoy distingue activos de finales (stats, OT atrasadas, topología, tiempo real/SSE, `test_stats_*`, `test_overdue_report.py`). Una OT en `por_validar` con fecha vencida sigue contando como atrasada.
- Frontend: muestra el estado "Por validar" (etiqueta, color e i18n). Los botones salen de `allowed_transitions`; agrega el campo de comentario obligatorio para cancelar y devolver.
- Tests: agrega casos en `test_work_order_states.py` y `test_work_orders_status.py` (transiciones válidas e inválidas por rol, autovalidación bloqueada, comentario obligatorio) y en los specs de frontend que correspondan.

## 4. Etapa C — Escalamiento de atrasos al gerente

- Sin cambios de esquema. En el job de OT atrasadas (`POST /api/jobs/ot-atrasadas` y el servicio que usa), agrega como destinatarios a los usuarios activos con rol `gerente` y `supervisor` de la empresa, además de los destinatarios configurados. Normaliza a minúsculas y quita duplicados.
- Solo aplica a empresas con la notificación activa.
- Actualiza `docs/NOTIFICACIONES.md` y `test_overdue_report.py`.

## 5. Etapa D — KPIs financieros solo para el gerente (D4)

- Primero identifica en `routers/stats.py` qué campos o endpoints entregan costos o impacto económico (costo de inactividad, `downtime_cost_per_minute`, SLA/costo por máquina, impacto). **Antes de cambiar nada, muéstrame la lista y espera mi confirmación.**
- Después crea en `ACCIONES` la acción `ver_kpis_financieros` (solo gerente). Para los demás roles, el backend omite esos campos o responde 403 en los endpoints exclusivamente financieros, sin romper el contrato de los KPIs operativos. Replica la acción en `permissions.ts` y oculta esas tarjetas en el dashboard.
- Si el cambio obliga a rehacer el contrato del dashboard, detente y repórtamelo en vez de implementarlo.

## 6. Verificación final

1. `cd backend && uv run ruff check && uv run pytest`
2. `cd frontend && npm test && npm run build`
3. `git diff --stat` y confirmación de que ninguna migración 0001 a 0013 aparece modificada por ti (`git diff --name-only -- backend/migrations/versions/` solo debe mostrar el archivo nuevo 0014 y, si ya estaba, la modificación previa de 0013 que no es tuya).

## 7. Entrega: resumen para el commit

Al terminar, entrégame un resumen en español con exactamente estas secciones:

1. **Resumen general** (3 a 5 líneas).
2. **Cambios en el backend**: tabla con archivo, qué cambió y por qué. Separa claramente permisos, máquina de estados, usuarios, notificaciones y stats.
3. **Migración nueva**: nombre, revisión, `down_revision`, qué hace, cómo se revierte y el comando para aplicarla. Confirma explícitamente que no se modificó ninguna migración existente.
4. **Cambios en el frontend**: tabla con archivo y qué cambió.
5. **Tests**: tests agregados o modificados y el resultado de la ejecución (cantidad de tests aprobados y fallidos, copiada de la salida real; no la estimes).
6. **Cambios de comportamiento visibles para el usuario**, por rol.
7. **Pendientes y riesgos**: lo que no se pudo hacer, lo que requiere acción manual (por ejemplo, aplicar la migración en Supabase antes del merge) y cualquier desviación de este pedido.
8. **Mensaje de commit propuesto**: un título de 72 caracteres o menos y un cuerpo con viñetas, separando backend, migración, frontend y tests.
9. **Muestra nuevamente la tabla de roles con los privilegios actualizados**