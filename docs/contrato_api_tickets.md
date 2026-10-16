# Contrato API — Tickets conversacionales (HU-06)

## Base

- **Ruta base:** `/api/tickets`
- **Autenticación:** ✅ **requerida**. Header `Authorization: Bearer <token>`.
  El token se obtiene en `POST /api/auth/login` y se valida contra la tabla `sesion`.
- **Content-Type request:** `application/json`
- **Content-Type response:** `application/json`

Diseño: `docs/TICKETS_ARCHITECTURE.md` (decisiones D1–D7).

### Visibilidad

- Cada usuario ve los tickets creados desde **sus propias conversaciones**.
- `supervisor`, `gerente` y `admin` (permiso `history`) ven **todos los tickets
  de su empresa**.
- Todo endpoint filtra SIEMPRE por `empresa_id` (aislamiento multi-empresa).
  El `super_usuario` no accede a datos operativos (igual que en OT).
- Un recurso inexistente o fuera de alcance responde **404** con el mismo
  mensaje (no se revela si el ticket existe para otro usuario o empresa).

### Estados y transiciones

```
open ──► in_progress ──► resolved (final)
  │             │
  └─────────────┴──────► cancelled (final)
```

- El **dueño** del ticket puede avanzarlo (`open → in_progress → resolved`).
- `supervisor`/`gerente`/`admin` pueden transicionar **cualquier** ticket de su
  empresa, incluido cancelarlo.
- **Cancelar** es exclusivo de esos roles (el dueño no puede cancelar el suyo).
- Toda respuesta de ticket incluye `allowed_transitions`: los destinos válidos
  para el estado actual **ya filtrados por tu rol y dueñez**.

### Códigos de error comunes

| Código | Causa | Detalle |
|--------|-------|---------|
| `401` | Token faltante, inválido o expirado | `{"detail": "Token de autenticación requerido."}` |
| `403` | Rol sin permiso para la acción | Ej.: visitante creando, dueño cancelando |
| `404` | Ticket/sesión inexistente o fuera de alcance | Mensaje no revelador |
| `409` | Conflicto de estado | Sesión ya con ticket · transición inválida |
| `422` | Validación de payload | Array de errores Pydantic |

### Ejemplo de request autenticado

```bash
TOKEN=$(curl -s -X POST http://localhost:9000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@barb.com","password":"admin123"}' | grep -oP '(?<="token":")[^"]+')

curl -s http://localhost:9000/api/tickets -H "Authorization: Bearer $TOKEN"
```

---

## Crear un ticket desde una conversación

### `POST /api/tickets`

Promueve una conversación del usuario autenticado a ticket (relación **1:1**:
una sesión ya con ticket responde `409`).

**Body:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `session_id` | UUID | ✅ | Conversación propia (obtenida de `GET /api/chat/sessions`) |
| `titulo` | string ≤ 200 | — | Default: título de la conversación |

**Permiso:** acción `crear_ticket` (todos los roles de empresa; no visitante ni
super_usuario).

**Response 201:**

```json
{
  "ticket_id": 12,
  "titulo": "Diagnóstico fuga hidráulica prensa B3",
  "estado": "open",
  "session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd",
  "creado_por": "Operador Molino",
  "created_at": "2026-10-16T18:30:00Z",
  "updated_at": "2026-10-16T18:30:00Z",
  "resolved_at": null,
  "allowed_transitions": ["in_progress"]
}
```

> `allowed_transitions` del ejemplo corresponde a un dueño `operador` (puede
> avanzar, no cancelar). Un dueño `supervisor`/`gerente`/`admin` recibiría
> `["in_progress", "cancelled"]`.

**Errores:**

| Código | Causa |
|--------|-------|
| `401` | Sin token o token inválido |
| `403` | Rol sin `crear_ticket` (visitante) o super_usuario |
| `404` | La sesión no existe o no pertenece al usuario |
| `409` | La sesión ya tiene un ticket — el detail incluye el existente |
| `422` | `session_id` no es UUID, `titulo` > 200 caracteres |

Detalle del `409` (structured):

```json
{
  "detail": {
    "message": "Esta conversación ya tiene un ticket asociado.",
    "ticket_id": 12
  }
}
```

**Ejemplo:**

```bash
curl -s -X POST http://localhost:9000/api/tickets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd"}'
```

---

## Listar tickets

### `GET /api/tickets`

Lista los tickets visibles para el usuario autenticado, ordenados por
`updated_at DESC` (los más recientemente movidos primero).

**Query params:**

| Param | Tipo | Default | Rango | Descripción |
|-------|------|---------|-------|-------------|
| `estado` | string | — | `open` \| `in_progress` \| `resolved` \| `cancelled` | Filtro opcional |
| `limit` | int | 20 | 1–100 | Tamaño de página |
| `offset` | int | 0 | ≥ 0 | Desplazamiento |

**Response 200:**

```json
{
  "tickets": [
    {
      "ticket_id": 12,
      "titulo": "Diagnóstico fuga hidráulica prensa B3",
      "estado": "in_progress",
      "session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd",
      "creado_por": "Operador Molino",
      "created_at": "2026-10-16T18:30:00Z",
      "updated_at": "2026-10-16T19:12:00Z",
      "resolved_at": null,
      "allowed_transitions": ["resolved", "cancelled"]
    }
  ],
  "total": 1
}
```

> `total` es la cantidad de tickets que cumplen el filtro (independiente de la
> paginación), para que el frontend pueda paginar.

**Errores:** `401`, `422` (params fuera de rango).

**Ejemplo:**

```bash
curl -s "http://localhost:9000/api/tickets?estado=open&limit=10&offset=0" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Ver un ticket (con la conversación)

### `GET /api/tickets/{ticket_id}`

Devuelve el ticket y los **mensajes en vivo de la conversación** que lo originó
(`role`/`content`/`timestamp`, igual que `GET /api/chat/sessions/{id}`).

**Path params:**

| Param | Tipo | Descripción |
|-------|------|-------------|
| `ticket_id` | int | Identificador del ticket |

**Response 200:**

```json
{
  "ticket_id": 12,
  "titulo": "Diagnóstico fuga hidráulica prensa B3",
  "estado": "open",
  "session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd",
  "creado_por": "Operador Molino",
  "created_at": "2026-10-16T18:30:00Z",
  "updated_at": "2026-10-16T18:30:00Z",
  "resolved_at": null,
  "allowed_transitions": ["in_progress"],
  "messages": [
    {
      "role": "user",
      "content": "La prensa B3 muestra una caída de presión de 50 bar en 30 segundos. ¿Cuál es el procedimiento?",
      "timestamp": 1748000000000
    },
    {
      "role": "assistant",
      "content": "⚠️ Esto indica una fuga activa. Pasos: 1) Despresurizar el sistema...",
      "timestamp": 1748000010000
    }
  ]
}
```

**Errores:**

| Código | Causa |
|--------|-------|
| `401` | Sin token o token inválido |
| `404` | No existe, es de otra empresa, o es de otro usuario y tu rol no es `history` |
| `422` | `ticket_id` no es un entero |

**Ejemplo:**

```bash
curl -s http://localhost:9000/api/tickets/12 -H "Authorization: Bearer $TOKEN"
```

---

## Cambiar el estado de un ticket

### `PATCH /api/tickets/{ticket_id}/estado`

Transiciona el ticket según la máquina de estados (§ Estados y transiciones).

**Body:**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `estado` | string | ✅ | `open` \| `in_progress` \| `resolved` \| `cancelled` |

**Response 200:** el ticket actualizado con `allowed_transitions` recalculado
(igual que el listado; al llegar a `resolved` se completa `resolved_at`).

**Errores:**

| Código | Causa |
|--------|-------|
| `401` | Sin token o token inválido |
| `403` | Puedes ver el ticket pero tu rol no puede ir a ese estado (ej.: dueño → `cancelled`) |
| `404` | No existe o fuera de alcance |
| `409` | Transición inválida por la máquina de estados (ej.: `resolved` → `in_progress`, `open` → `resolved`) |
| `422` | `estado` fuera del enum, `ticket_id` no entero |

**Ejemplo:**

```bash
curl -s -X PATCH http://localhost:9000/api/tickets/12/estado \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"estado": "in_progress"}'
```

---

## Interacción con el historial de chat

`DELETE /api/chat/sessions/{session_id}` sigue existiendo, pero si la conversación
tiene un ticket asociado responde:

```
409 {"detail": "Esta conversación tiene un ticket asociado y no se puede eliminar
mientras exista. Cancela o cierra el ticket primero."}
```

(FK `ON DELETE RESTRICT` en la migración 0007; decisión D4 de la arquitectura.)
