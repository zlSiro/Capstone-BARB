# Órdenes de Trabajo (OT)

Documento de las HU-07 «Usuario crea OT» (secciones 1–6) y HU-09 «Actualizar el estado de una OT» (secciones 7–13). Cubre modelo, contrato API, validaciones, permisos, flujo y verificación.

## 1. Modelo de creación

| Campo (API) | Alias aceptados | Obligatorio | Tipo / valores | Notas |
|---|---|---|---|---|
| `maquina_id` | `machine_id` | Sí | entero | Debe existir en `maquina`. |
| `tecnico_id` | `technician_id` | Sí | entero | Debe existir, estar activo y tener rol `tecnico`. |
| `descripcion_problema` | `description`, `title`, `issue_description` | Sí | texto, máx. 5000 | El frontend envía `título + "\n\n" + descripción`. |
| `tipo` | — | No (`corrective`) | `corrective`, `preventive`, `predictive`, `inspection` | |
| `priority` | — | No (`medium`) | `low`, `medium`, `high`, `urgent` | |
| `severity` | — | No | `low`, `medium`, `high`, `critical` | |
| `estado` | `status` | No (`pending`) | `pending`, `assigned`, `in_progress`, `completed`, `cancelled`, `overdue` (también `open`, `closed`, etc.) | |
| `descripcion_reparacion` | — | No | texto | |
| `resolution` | — | No | texto | |
| `fecha_vencimiento` | `due_date` | No | ISO 8601 | |
| `photos` / `images` / `attachments` / `photo` | — | No | archivos JPEG, PNG o WEBP (solo `multipart`) | |

- `creado_por` **no** se acepta desde el cliente: siempre es el usuario de la sesión autenticada.
- `numero_ot` se genera en el servidor con el formato `OT-<año>-<ot_id con 4 dígitos>` (ej. `OT-2026-0042`). El cliente no lo envía.

## 2. Contrato API

`POST /api/work-orders` (alias `POST /api/work_orders`)

- Header: `Authorization: Bearer <token>`.
- `Content-Type`: `application/json` o `multipart/form-data` (para adjuntar fotos).

Ejemplo de request (JSON):

```json
{
  "maquina_id": 1,
  "tecnico_id": 4,
  "descripcion_problema": "Vibración anormal en motor D1",
  "priority": "high",
  "tipo": "corrective"
}
```

Response `200` (respuesta real del servidor; la misma forma que `GET /api/work-orders/{numero_ot}`):

```json
{
  "id": "OT-2026-0039",
  "numero_ot": "OT-2026-0039",
  "ot_id": 39,
  "title": "Vibración anormal en motor D1",
  "description": "Vibración anormal en motor D1",
  "resolution": null,
  "machine": "Compressor A1",
  "machine_name": "Compressor A1",
  "machine_id": 1,
  "plant": "Planta Central San Bernardo",
  "plant_name": "Planta Central San Bernardo",
  "plant_id": 1,
  "discipline": "Mecánica",
  "discipline_name": "Mecánica",
  "priority": "high",
  "status": "Open",
  "estado": "pending",
  "severity": null,
  "age_minutes": 0,
  "created_at": "2026-10-01T03:35:31.444783Z",
  "fecha_inicio": null,
  "fecha_cierre": null,
  "photo_count": 0,
  "photos": [],
  "tecnico_nombre": "Carlos Mendoza",
  "tipo": "corrective",
  "costo_estimado": 0.0,
  "costo_real": 0.0,
  "downtime_minutes": null,
  "reporte_id": null,
  "diagnostico_id": null
}
```

Notas sobre la respuesta:

- Cada dato tiene clave en español y en inglés (`machine`/`machine_name`, `plant`/`plant_name`, `discipline`/`discipline_name`) por compatibilidad con el contrato anterior.
- `status` es el texto legible (`Open`, `Assigned`, `In Progress`, `Closed`, `Cancelled`, `Overdue`); `estado` es el valor de la BD.
- `photos` lista las fotos adjuntas (`id`, `ot_id`, `file_name`, `original_name`, `content_type`, `file_path`, `created_at`).

### Errores

| Código | Cuándo | Ejemplo de `detail` |
|---|---|---|
| 400 | Campo obligatorio vacío, no numérico, JSON inválido, descripción > 5000, estado inválido | `El campo 'maquina_id' es obligatorio.` |
| 401 | Token inválido o sesión expirada | `Sesión inválida o expirada. Vuelve a iniciar sesión.` |
| 403 | Rol sin permiso `crear_ot` | `El rol 'tecnico' no puede ejecutar 'crear_ot'.` |
| 422 (header) | Falta el header `Authorization` (validación de FastAPI, no llega a 401) | `{"detail":[{"type":"missing","loc":["header","Authorization"],"msg":"Field required"}]}` |
| 415 | `Content-Type` no soportado, o foto que no es JPEG/PNG/WEBP | `Content-Type no soportado para crear OT.` |
| 422 | Valor de enum inválido, máquina o técnico inexistente, usuario sin rol técnico o inactivo | `La máquina 999 no existe.` |
| 500 | Error interno (el detalle se registra en el log, no se expone) | `Error interno al crear la OT.` |

## 3. Permisos

Acción `crear_ot` (`backend/src/barb/core/permissions.py`, espejo en `frontend/src/app/core/permissions/permissions.ts`):
solo **gerente** y **admin**. Los demás roles reciben `403` y no ven el botón «Crear OT».

## 4. Flujo completo

1. En la lista de OT (`/work-orders`), gerente/admin pulsa **+ Crear OT**; se abre `CreateOtModalComponent`.
2. El modal carga catálogos (`/api/disciplines`, `/api/machines`, `/api/technicians`). Las máquinas se filtran por disciplina.
3. Validación en el cliente (Signal Forms): título, disciplina, máquina, técnico y descripción obligatorios; no se aceptan textos solo con espacios. Foto opcional (JPEG/PNG/WEBP).
4. Envío `multipart/form-data` a `POST /api/work-orders`.
5. El backend: autentica → verifica permiso → valida payload y enums → verifica máquina y técnico → inserta la OT y genera `numero_ot` en una transacción → guarda fotos (si falla, revierte la OT).
6. Éxito: toast «OT … creada correctamente», la OT se agrega al inicio de la lista y el modal se cierra. Error: toast con el mensaje del backend (o uno genérico según código).

## 5. Formulario (frontend)

| Campo | Requerido | Mensaje de error |
|---|---|---|
| Título | Sí | Ingresa un título para la OT. |
| Disciplina | Sí | Selecciona una disciplina. |
| Máquina | Sí | Selecciona una máquina. |
| Técnico | Sí | Selecciona un técnico. |
| Prioridad | No (default Media) | — |
| Estado | No (default Abierta) | — |
| Descripción | Sí | Describe la falla. |
| Foto | No | Solo se permiten imágenes JPEG, PNG o WEBP. |

Accesibilidad: el modal es `role="dialog"` con `aria-modal`, cada campo tiene `label` asociado, los errores usan `role="alert"` y `aria-invalid`/`aria-describedby`; se cierra con `Esc`. Diseño responsive con Tailwind (grilla de 1 columna en móvil, 2 desde `md`, scroll interno si el contenido excede la pantalla).

## 6. Tests y verificación

Backend: `uv run pytest tests/test_work_orders_create.py` (requiere Postgres, migraciones y seed). Cubre caso feliz, aparición en listado, `creado_por` desde sesión, 403 para técnico/operador, campos vacíos (400), máquina/técnico inexistentes y enums inválidos (422), 415 y JSON inválido.

Checklist manual end-to-end (`uv run fastapi dev src/barb/main.py --port 9000` + `npm start`):

- [ ] Login como `gerente1@planta.com` o `admin@barb.com`: aparece **+ Crear OT**.
- [ ] Login como `carlos@planta.com` (técnico) u `operador1@planta.com`: el botón no aparece; un `POST` directo responde 403.
- [ ] Crear OT válida: toast de éxito y la OT aparece primera en la lista.
- [ ] Enviar con campos vacíos: errores en línea, no hay request.
- [ ] `POST` con `maquina_id` inexistente: 422 con mensaje claro, toast de error en el modal.

---

# HU-09 — Actualización de estado de una OT

## 7. Máquina de estados

```
Pendiente ──► En curso ──► Cerrada
    │             │
    └─────────────┴──────► Cancelada
```

| Estado actual (`estado`) | Etiqueta UI | Puede pasar a | Efecto en fechas |
|---|---|---|---|
| `pending` | Pendiente | `in_progress`, `cancelled` | — |
| `assigned` (heredado) | Asignada | `in_progress`, `cancelled` | — |
| `overdue` (heredado) | Vencida | `in_progress`, `cancelled` | — |
| `in_progress` | En curso | `completed`, `cancelled` | al entrar: `fecha_inicio` = ahora (si estaba vacía) |
| `completed` | Cerrada | — (final) | al entrar: `fecha_cierre` = ahora |
| `cancelled` | Cancelada | — (final) | — |

- No se puede cerrar una OT sin pasar por «En curso», ni volver a un estado anterior, ni modificar una OT cerrada o cancelada.
- `assigned` y `overdue` existen en el esquema (`estado_ot`) pero la HU no los usa como destino: se tratan como «pendiente».
- Implementación: `backend/src/barb/core/work_order_states.py` (`TRANSICIONES`, `ACCION_POR_DESTINO`). Es la única fuente de verdad: el backend entrega en cada OT `allowed_transitions` ya filtrado por rol y el frontend solo lo pinta.

## 8. Permisos por rol del cambio de estado

Dos acciones en `ACCIONES` (`permissions.py`, espejo en `permissions.ts`):

| Acción | Se exige para ir a | Roles |
|---|---|---|
| `cambiar_estado_ot` | `in_progress`, `completed` | supervisor, engineer, gerente, admin, super_usuario |
| `cancelar_ot` | `cancelled` | supervisor, gerente, admin, super_usuario (**engineer no**) |

**Técnico, operador y visitante no pueden cambiar el estado** (403). Antes de esta HU el técnico sí podía; se le quitó. Cancelar es más restrictivo porque es irreversible.
El aislamiento multi-empresa se mantiene: una OT de otra empresa responde `404`.

## 9. Contrato API: `PATCH /api/work-orders/{numero_ot}/status`

Alias: `PATCH /api/work_orders/{numero_ot}/status`. `PUT` en ambas rutas sigue funcionando por compatibilidad y hace lo mismo. El identificador es el `numero_ot` (ej. `OT-2026-0042`).

Header: `Authorization: Bearer <token>`.

Request:

```json
{ "status": "in_progress", "comment": "Se inicia el cambio de rodamiento" }
```

| Campo | Obligatorio | Detalle |
|---|---|---|
| `status` | Sí | Estado destino: `in_progress`, `completed`, `cancelled`. Acepta también los alias del sistema (`open`, `closed`, `canceled`…). |
| `comment` | No | Texto libre, máx. 500. Se guarda en la auditoría. |

Response `200`: la OT actualizada (misma forma que `GET /api/work-orders/{numero_ot}`) con dos campos propios de esta HU:

```json
{
  "numero_ot": "OT-2026-0042",
  "estado": "in_progress",
  "status": "In Progress",
  "fecha_inicio": "2026-10-06T14:02:11.120Z",
  "fecha_cierre": null,
  "allowed_transitions": ["completed", "cancelled"],
  "status_history": [
    {
      "id": 17,
      "from_status": "pending",
      "to_status": "in_progress",
      "comment": "Se inicia el cambio de rodamiento",
      "user_id": 2,
      "user_name": "Supervisor Turno A",
      "user_role": "supervisor",
      "changed_at": "2026-10-06T14:02:11.120Z"
    }
  ]
}
```

- `allowed_transitions`: estados a los que **el rol del usuario autenticado** puede mover la OT ahora. Vacío = estado final o rol sin permiso. Viene en todos los endpoints de OT (listado, detalle, creación y este).
- `status_history`: auditoría, más reciente primero. Viene en el detalle y en la respuesta de este endpoint (no en el listado).

Errores:

| Código | Cuándo | Ejemplo de `detail` |
|---|---|---|
| 400 | `status` no es un estado válido | `Estado de OT inválido.` |
| 401 | Token inválido o expirado | `Sesión inválida o expirada. Vuelve a iniciar sesión.` |
| 403 | Rol sin `cambiar_estado_ot`, o sin `cancelar_ot` al cancelar | `El rol 'tecnico' no puede ejecutar 'cambiar_estado_ot'.` / `El rol 'engineer' no puede cambiar una OT a 'Cancelada'.` |
| 404 | OT inexistente o de otra empresa | `OT no encontrada.` |
| 409 | Transición fuera de la máquina de estados, o la OT ya está en ese estado | `Transición no permitida: una OT 'Pendiente' no puede pasar a 'Cerrada'.` |
| 422 | `comment` de más de 500 caracteres | (validación de FastAPI) |
| 500 | Error interno (el detalle solo queda en el log) | `Error interno al actualizar el estado de la OT.` |

Orden de validación: autenticación → permiso base (`cambiar_estado_ot`) → la OT existe en la empresa → transición válida (409) → permiso del estado destino (403).
La OT se bloquea (`SELECT … FOR UPDATE`) mientras se valida y actualiza: dos cambios simultáneos no pueden saltarse la máquina de estados, el segundo recibe 409.

## 10. Auditoría

Cada cambio exitoso inserta una fila en `ot_audit_log` (tabla del esquema inicial, **no requiere migración**) en la misma transacción que el `UPDATE`:

| Columna | Contenido |
|---|---|
| `ot_id` | OT modificada |
| `usuario_id` | Usuario de la sesión (nunca viene del cliente) |
| `estado_anterior` / `estado_nuevo` | Valores de `estado_ot` |
| `comentario` | `comment` opcional |
| `timestamp` | Momento del cambio (UTC) |

Un cambio rechazado (403/404/409) no deja registro. Si falla el insert, también se revierte el cambio de estado.

## 11. Frontend: listado y detalle

`/work-orders` (`features/work-orders/`):

- **Listado**: columnas N° OT (abre el detalle), descripción + tipo, máquina + planta, técnico, prioridad, **estado** y fecha de creación. Estados, prioridades y tipos se muestran en español y con texto (el color nunca es el único indicador). La barra superior filtra por estado (con conteo) y busca por N° OT, máquina, técnico o descripción. La tabla hace scroll horizontal en pantallas angostas.
- **Selector de estado** (`ot-status-select`): un `<select>` con el estado actual y, solo si el usuario puede, los destinos de `allowed_transitions` (`→ En curso`). Sin destinos (estado final o rol sin permiso) se muestra solo la etiqueta.
- **Confirmación** (`ot-status-change-dialog`): al elegir un destino se abre un diálogo con «de → a», el efecto del cambio (avisa si es final/irreversible) y un comentario opcional. Nada se guarda hasta pulsar *Confirmar cambio*.
- **Feedback**: toast verde `OT-2026-0042: Pendiente → En curso`. Si el backend responde 403/404/409 (otro usuario cambió la OT, cambió el permiso…) se muestra su mensaje en un toast rojo y la OT se refresca para mostrar el estado real; ante un error de red o de servidor el diálogo queda abierto para reintentar.
- **Detalle** (`ot-detail-sheet`): datos clave, el mismo selector de estado y el **historial de estados** (de → a, usuario y rol, fecha, comentario).
- Accesibilidad: `aria-label` en cada selector con la OT y su estado actual, diálogos con `role="dialog"`, contenedor de toasts con `aria-live`.

## 12. Tests (HU-09)

- `backend/tests/test_work_order_states.py` — unitarios de la máquina de estados y de los permisos por rol (sin BD).
- `backend/tests/test_work_orders_status.py` — integración del endpoint: flujo completo, auditoría (usuario + timestamp), 403 para técnico/operador/visitante y para engineer al cancelar, 409 por transición inválida / mismo estado / estados finales, 400, 404, aislamiento entre empresas, rutas con guion bajo y `PUT` heredado.
- Frontend: `ot-status-select.component.spec.ts` y `work-orders-list.component.spec.ts` (selector, confirmación, PATCH, toast y manejo de 409).

```bash
cd backend && uv run pytest tests/test_work_order_states.py tests/test_work_orders_status.py
cd frontend && npm test
```

(`app.spec.ts`, del scaffold de Angular, falla desde antes de esta HU: espera el texto «Hello, frontend».)

## 13. Verificación end-to-end

Usuarios del seed (ver `docs/MULTIEMPRESA.md`): `supervisor1@planta.com / super123`, `engineer1@planta.com / engineer123`, `carlos@planta.com / tecnico123`, `operador1@planta.com / operador123`.

- [ ] Supervisor en `/work-orders`: la columna Estado muestra un selector; una OT Pendiente ofrece `→ En curso` y `→ Cancelada`.
- [ ] Elegir `→ En curso` y confirmar: toast de éxito; el selector pasa a «En curso» y ahora ofrece `→ Cerrada` / `→ Cancelada`.
- [ ] Abrir el detalle (clic en el N° OT): el historial muestra el cambio con tu nombre, rol y hora.
- [ ] Cerrar la OT: queda solo la etiqueta «Cerrada» (sin selector) y el historial tiene dos entradas.
- [ ] Engineer: puede iniciar y cerrar, pero «Cancelada» no aparece como opción.
- [ ] Técnico u operador: no hay selectores, solo etiquetas; un `PATCH` directo responde 403.
- [ ] Con dos pestañas: cambiar la misma OT en una y luego en la otra → la segunda muestra el error 409 y se refresca.
