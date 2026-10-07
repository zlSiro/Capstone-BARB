# Ejecución HU-09 — Actualización de estado de una Orden de Trabajo (OT)

Rama: `feat/HU-09-OT` · Estado del trabajo: implementado y probado localmente, **sin commit ni despliegue** (ver sección 9).

Este documento explica qué se pidió, qué se construyó, por qué se tomaron ciertas decisiones, cómo se probó y qué queda pendiente. La referencia técnica detallada (contrato API, errores, checklist manual) está en `docs/WORK_ORDERS.md`, secciones 7 a 13.

---

## 1. Qué se pidió

Historia de usuario: *los supervisores de mantenimiento deben poder actualizar el estado de una OT para reflejar su avance real.*

Criterios de aceptación:

1. Existe una máquina de estados definida (pendiente → en curso → cerrada / cancelada).
2. Se puede cambiar el estado desde el listado o el detalle de la OT.
3. Los cambios se registran con usuario y timestamp.
4. Solo los roles autorizados pueden cambiar a ciertos estados.

Requisito adicional: la vista de OT debe ser ordenada, intuitiva, escalable y no dejar dudas sobre la información que muestra.

## 2. Punto de partida

Antes de esta HU, "actualizar una OT" solo existía como `PUT /api/work-orders/{numero_ot}/status`, que cambiaba el estado a cualquier valor, sin validar transiciones ni dejar registro de quién lo hizo. Además:

- El rol **técnico** sí podía cambiar estados.
- El frontend tenía un método `updateStatus`, pero ninguna pantalla lo usaba.
- El listado mostraba valores en inglés sin formato (`in_progress`, `corrective`, `high`).
- La tabla de auditoría `ot_audit_log` ya existía en el esquema inicial, pero nada escribía en ella.

## 3. Qué se construyó

### 3.1 Máquina de estados

```
Pendiente ──► En curso ──► Cerrada
    │             │
    └─────────────┴──────► Cancelada
```

| Estado actual | Puede pasar a |
|---|---|
| Pendiente (`pending`) | En curso, Cancelada |
| Asignada (`assigned`, heredado) | En curso, Cancelada |
| Vencida (`overdue`, heredado) | En curso, Cancelada |
| En curso (`in_progress`) | Cerrada, Cancelada |
| Cerrada (`completed`) | — (estado final) |
| Cancelada (`cancelled`) | — (estado final) |

Reglas derivadas: no se puede cerrar sin pasar por «En curso», no se puede volver a un estado anterior y no se puede tocar una OT cerrada o cancelada. Al pasar a «En curso» se registra `fecha_inicio`; al cerrar, `fecha_cierre`.

Los estados «Asignada» y «Vencida» existen en el esquema de base de datos pero la HU no los usa como destino; se tratan como «Pendiente».

Implementación: `backend/src/barb/core/work_order_states.py`. Es la **única fuente de verdad** de las reglas.

### 3.2 Permisos por rol

| Acción | Para pasar a | Roles autorizados |
|---|---|---|
| `cambiar_estado_ot` | En curso, Cerrada | supervisor, engineer, gerente, admin, super_usuario |
| `cancelar_ot` (nueva) | Cancelada | supervisor, gerente, admin, super_usuario |

- **Técnico, operador y visitante no pueden cambiar estados.** Recibirán 403.
- **Decisión tomada por el equipo de desarrollo (no venía en la HU):** cancelar exige una acción propia y excluye a `engineer`, porque cancelar es irreversible. Si el negocio prefiere otra regla, se cambia en un solo lugar (`ACCIONES` en `permissions.py` y su espejo `permissions.ts`).
- Se mantiene el aislamiento entre empresas: una OT de otra empresa responde 404.

### 3.3 Endpoint

`PATCH /api/work-orders/{numero_ot}/status` (también `/api/work_orders/...`). `PUT` sigue funcionando como alias por compatibilidad.

Entrada: `{ "status": "in_progress", "comment": "texto opcional, máx. 500" }`.

Orden de validación: autenticación → permiso base → la OT existe en la empresa del usuario → transición válida → permiso del estado destino.

| Código | Cuándo |
|---|---|
| 200 | Cambio aplicado; devuelve la OT actualizada |
| 400 | Estado inválido |
| 401 | Sesión inválida o expirada |
| 403 | Rol sin permiso (incluye cancelar sin `cancelar_ot`) |
| 404 | OT inexistente o de otra empresa |
| 409 | Transición no permitida, o la OT ya está en ese estado |
| 422 | Comentario de más de 500 caracteres |

Mientras se valida y actualiza, la OT queda bloqueada (`SELECT … FOR UPDATE`). Si dos personas cambian la misma OT a la vez, la segunda recibe 409 en lugar de saltarse la máquina de estados.

### 3.4 Auditoría

Cada cambio exitoso inserta una fila en `ot_audit_log` **dentro de la misma transacción** que el cambio de estado: OT, usuario de la sesión (nunca enviado por el cliente), estado anterior, estado nuevo, comentario y momento (UTC). Si algo falla, no queda ni el cambio ni el registro. Un cambio rechazado no deja registro. **No se necesita migración**: la tabla ya existía.

### 3.5 Datos que el backend entrega para la interfaz

- `allowed_transitions` en toda respuesta de OT (listado, detalle, creación, cambio de estado): la lista de estados a los que *el rol del usuario actual* puede mover esa OT. Así el frontend solo dibuja esas opciones y **no duplica las reglas**.
- `status_history` en el detalle y en la respuesta del cambio: quién cambió qué, cuándo y con qué comentario, del más reciente al más antiguo.

### 3.6 Interfaz (Angular)

Pantalla `/work-orders`:

- **Listado ordenado:** columnas N° OT, descripción con tipo de mantenimiento, máquina con planta, técnico, prioridad, estado y fecha de creación. Todo en español (Pendiente, En curso, Cerrada, Cancelada; Baja, Media, Alta, Urgente; Correctivo, Preventivo…). Los estados se muestran con texto además de color. La tabla hace scroll horizontal en pantallas angostas.
- **Filtro por estado con conteos y búsqueda** por N° OT, máquina, técnico o descripción, pensados para cuando haya muchas OT.
- **Selector de estado en cada fila:** muestra el estado actual y, solo si el usuario puede, los destinos permitidos (`→ En curso`). Sin permiso, o en estado final, se muestra solo la etiqueta.
- **Diálogo de confirmación:** al elegir un destino muestra «de → a», explica el efecto (avisa si es final e irreversible) y permite un comentario opcional. Nada se guarda hasta confirmar.
- **Feedback:** toast verde con el resultado (por ejemplo, `OT-2026-0042: Pendiente → En curso`). Si el servidor rechaza el cambio (403/404/409, por ejemplo porque otra persona cambió la OT antes), se muestra su mensaje en un toast rojo y la OT se refresca para mostrar el estado real. Ante un error de red o de servidor, el diálogo queda abierto para reintentar.
- **Detalle de la OT:** se abre al hacer clic en el N° de OT. Muestra los datos clave, el mismo selector de estado y el **historial de estados** (de → a, usuario y rol, fecha y hora, comentario).
- **Accesibilidad:** etiqueta descriptiva en cada selector, diálogos con `role="dialog"`, y el contenedor de toasts anuncia los mensajes (`aria-live`).

## 4. Archivos

**Backend**

| Archivo | Cambio |
|---|---|
| `backend/src/barb/core/work_order_states.py` | Nuevo. Máquina de estados y reglas por destino |
| `backend/src/barb/core/permissions.py` | Técnico pierde `cambiar_estado_ot`; nueva acción `cancelar_ot` |
| `backend/src/barb/routers/work_orders.py` | Endpoint PATCH (y PUT alias), auditoría, historial, `allowed_transitions` |
| `backend/src/barb/schemas/work_orders.py` | Campo `comment` |
| `backend/tests/test_work_order_states.py` | Nuevo. Tests unitarios |
| `backend/tests/test_work_orders_status.py` | Nuevo. Tests de integración del endpoint |

**Frontend** (`frontend/src/app/`)

| Archivo | Cambio |
|---|---|
| `core/permissions/permissions.ts` | Espejo de los permisos del backend |
| `core/models/work-order.model.ts` | `allowed_transitions`, `status_history` |
| `core/services/work-orders.service.ts` | `updateStatus` ahora usa PATCH y comentario |
| `shared/components/ui/toast/toast.component.ts` | Accesibilidad (`aria-live`) y capa por encima de los diálogos |
| `features/work-orders/pages/work-orders-list/` | Listado rediseñado + su spec |
| `features/work-orders/components/ot-status-badge/` | Nuevo. Etiqueta de estado |
| `features/work-orders/components/ot-status-select/` | Nuevo. Selector de estado + spec |
| `features/work-orders/components/ot-status-change-dialog/` | Nuevo. Confirmación con comentario |
| `features/work-orders/components/ot-detail-sheet/` | Nuevo. Detalle con historial |
| `features/work-orders/components/ot-filter-bar/` | Nuevo. Filtro por estado y búsqueda |
| `features/work-orders/utils/work-order-labels.ts` | Nuevo. Etiquetas y colores en español |

**Documentación:** `docs/WORK_ORDERS.md` (secciones 7 a 13) y `CLAUDE.md` (nota sobre el flujo de estados).

## 5. Cumplimiento de criterios y subtareas

| Criterio / subtarea | Estado |
|---|---|
| Máquina de estados definida | Hecho (3.1) |
| Cambio desde el listado o el detalle | Hecho: ambos tienen el selector |
| Registro con usuario y timestamp | Hecho (3.4) |
| Solo roles autorizados por estado | Hecho (3.2) |
| Documentar contrato `PATCH /api/work-orders/{id}/status` | Hecho: `docs/WORK_ORDERS.md` §9 |
| Implementar endpoint PATCH | Hecho |
| Reglas de permisos (técnico y operador no cambian estado) | Hecho |
| Auditoría de cambios | Hecho |
| Validaciones de transición | Hecho (409) |
| Tests unitarios y de integración | Hechos (sección 6) |
| Selector de estado en el listado | Hecho |
| Feedback visual (toast) | Hecho |
| Verificación end-to-end | **Parcial**: el flujo está cubierto por tests automáticos; **no se probó manualmente en un navegador** (checklist en `docs/WORK_ORDERS.md` §13) |
| Documentar flujo y estados | Hecho: `docs/WORK_ORDERS.md` y este archivo |

## 6. Pruebas realizadas

**Backend**

- `test_work_order_states.py`: reglas de la máquina de estados y permisos por rol, sin base de datos.
- `test_work_orders_status.py`: flujo completo pendiente → en curso → cerrada; auditoría con usuario, rol y timestamp; 403 para técnico, operador, visitante y para engineer al cancelar; 409 por transición inválida, mismo estado y estados finales; 400, 404 y 422; aislamiento entre empresas; rutas con guion bajo y `PUT` heredado; un cambio rechazado no deja auditoría.
- Con la base de datos limpia, los 39 tests nuevos pasaron junto con los de permisos y los de creación de OT.

**Frontend**

- 9 tests nuevos (selector de estado y listado: opciones por rol, confirmación, PATCH, toast de éxito y manejo de 409). Pasan.
- `ng build` de producción compila.
- `app.spec.ts` falla, pero es del código de ejemplo original de Angular (espera el texto «Hello, frontend») y fallaba antes de esta HU.

**Lint:** los archivos de esta HU pasan `ruff` sin avisos.

## 7. Problema detectado en el entorno de pruebas (pendiente)

Al correr **toda** la suite de backend, el test existente `test_multiempresa.py::test_email_duplicado_devuelve_409` deja en la base de datos local un segundo usuario con el correo `admin@barb.com` (nombre «Duplicado»). Con dos filas iguales, el login del admin falla de forma intermitente y arrastra a otros tests. Esto **no lo causa esta HU**, pero impide dar un resultado confiable de la suite completa.

## 8. Impacto en producción

- **Sin migraciones nuevas.** `alembic heads` da un único head (`0005_merge_heads`). Conviene confirmar en Supabase que `alembic current` es ese mismo valor y que existe la tabla `ot_audit_log`.
- **Cambio de comportamiento visible:** al desplegar, los técnicos pierden la capacidad de cambiar estados de OT (antes la tenían). Conviene avisarles.
- Los endpoints siguen aceptando las rutas antiguas, incluido `PUT`, así que no se rompe ningún cliente existente.
- El despliegue es automático: al hacer merge a `main`, Render (backend) y Cloudflare Pages (frontend) publican solos. La base de datos no se toca.

## 9. Estado de entrega y siguientes pasos

- Todo el trabajo está en el árbol local de la rama `feat/HU-09-OT`, **sin commit, sin push y sin PR**.
- Siguientes pasos sugeridos: resolver la sección 7, correr la suite completa, hacer la verificación manual en navegador (checklist en `docs/WORK_ORDERS.md` §13), crear el commit y el PR hacia `main`, y avisar a los técnicos del cambio de permisos.
