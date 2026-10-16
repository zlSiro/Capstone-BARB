# Arquitectura de Tickets — HU-06: Que exista un ticket conversacional

> **Estado:** diseño **VALIDADO con el equipo** (Javier) — 16/10/2026; decisiones D1–D7 aprobadas.
> Contrato API formalizado en `docs/contrato_api_tickets.md` (CGBIDA-284).
> Subtareas: 283 (este documento) · 284 (contrato) · 285–288 (backend) · 289–291 (frontend,
> después de que se fusione la Fase 2 de HU-05 para no chocar con ese branch).

## 1. Objetivo

Que las conversaciones con la IA se puedan **promover a tickets** para darles
seguimiento (CGBIDA-124). Criterios de aceptación:

- Cada ticket tiene un **ID** propio (legible: `ticket_id` secuencial).
- La conversación que lo originó queda consultable en su **historial** (el ticket
  referencia la sesión, no la duplica).
- Los tickets son **consultables después**, con visibilidad por rol (§ D3).

La conversación ya existe (`chat_session`, migración `0001_initial_schema`):
el ticket **nace desde ella**, no la reemplaza ni la altera.

## 2. Flujo de alto nivel

```
                 CONVERSAR (ya existe, HU-03/04/05)         PROMOVER (nuevo, HU-06)
┌──────────────┐   POST /api/chat/stream            ┌────────────────────────────────┐
│  FRONTEND    │ ─────────────────────────────────► │  chat_session (migración 0001) │
│  (DocChat)   │   mensajes persisten en JSONB      │  session_id UUID · empresa_id  │
└──────┬───────┘                                    └───────────────┬────────────────┘
       │  "Guardar como ticket" (botón, Fase                 1:1   │  UNIQUE(session_id)
       │   frontend CGBIDA-289/290)                                │
       │  POST /api/tickets {session_id}                          ▼
       │                                              ┌────────────────────────────────┐
       │  GET /api/tickets · GET /{id} · PATCH /{id}/ │  ticket (migración 0007)       │
       └────────────────────────────────────────────► │  ticket_id · estado · titulo   │
                                                      │  usuario_id · empresa_id       │
                                                      └────────────────────────────────┘
```

El ticket **no copia mensajes**: consulta la sesión en vivo (D4). CRUD puro, sin
LLM (D6) — la IA no participa en la creación ni el cierre.

## 3. Decisiones (validadas con el equipo, 16-10-2026)

### D1 — Cardinalidad 1:1 (UNIQUE en `session_id`)

Una conversación genera **un solo ticket**. El UNIQUE lo impone la BD, no el código
(una segunda carrera de `POST` resuelve en `ON CONFLICT DO NOTHING` → `409` con el
`ticket_id` existente).

- Justificación: el ticket es la unidad de seguimiento de esa conversación.
- Limitación consciente: si en la misma conversación surgen dos problemas, el
  segundo requiere una conversación nueva (registrada en § 9 como deuda aceptada).

### D2 — Ciclo de vida estilo OT

Máquina de estados espejo de `core/work_order_states.py` (única fuente de verdad,
el backend entrega `allowed_transitions` filtrado por rol):

```
open ──► in_progress ──► resolved (final)
  │             │
  └─────────────┴──────► cancelled (final)
```

- **El dueño avanza su propio ticket** (open → in_progress → resolved) sin necesitar
  acción especial: quien conversó, da seguimiento.
- **supervisor / gerente / admin** pueden transicionar CUALQUIER ticket de su
  empresa (acción `cambiar_estado_ticket`).
- **Cancelar es más restrictivo**, igual que en OT: solo supervisor/gerente/admin
  (acción `cancelar_ticket`); el dueño no puede cancelar el suyo.
- `resolved_at` se registra al llegar a `resolved` (para métricas futuras).

### D3 — Visibilidad: dueño + permiso `history`

- Cada usuario ve los tickets creados desde **sus** conversaciones.
- El permiso de ruta `history` (ya definido en `permissions.py`: supervisor,
  gerente, admin) habilita ver **todos los tickets de la empresa**. Es el primer
  uso backend de ese permiso, que existed sin consumidor.
- engineer NO ve tickets ajenos (matriz `history`: False), pero sí los suyos.
- Aislamiento multi-empresa estándar: `empresa_id` SIEMPRE en el WHERE
  (`resolver_empresa`); el `super_usuario` queda fuera de los datos operativos
  (mismo `require_auth` que las OT).
- Acceso denegado = **404** con mensaje no revelador (no se distingue "no existe"
  de "existe pero no es tuyo" — mismo criterio que el historial de chat).

### D4 — Vista en vivo, sin snapshot + `ON DELETE RESTRICT`

- El ticket referencia `chat_session` **en vivo**: los mensajes que la conversación
  agregue después de crear el ticket se ven en el detalle del ticket (decisión
  consciente: la sesión ES el historial; Duplicar mensajes rompería la fuente de
  verdad).
- El usuario puede borrar sus conversaciones (`DELETE /api/chat/sessions/{id}`),
  pero **no una sesión con ticket**: la FK `ON DELETE RESTRICT` lo impide en BD y
  el endpoint traduce la violación a **409** con mensaje claro ("cierra o cancela
  el ticket primero"). Trazabilidad del ticket prima sobre la limpieza del chat.
- Si se elimina el usuario, el ticket sobrevive (`usuario_id ON DELETE SET NULL`,
  mismo patrón que `chat_session`) y pasa a ser visible solo para `history`.

### D5 — Campos mínimos v1

`titulo` (default = título de la conversación, editable en el POST), `estado`,
timestamps y las FKs. **Sin prioridad ni asignación** — deuda futura (§ 9) para
no acercar el alcance a una OT.

### D6 — Sin LLM

El ticket es CRUD + flujo. No se genera título con IA (lo hereda de la sesión).
Si algún día se genera resumen con IA, aplicar la lección de muse-glimmer del
AGENTS.md: system prompt con `Reasoning strength: low`.

### D7 — Estados en inglés con etiquetas ES

Valores en BD en inglés (`open`, `in_progress`, `resolved`, `cancelled`) con
`ETIQUETA_ES` en `core/ticket_states.py`, idéntico al patrón de OT
(`pending`/`"Pendiente"`). La UI traduce con etiquetas, la API habla inglés.

## 4. Modelo de datos (migración `0007_tickets_conversacionales`)

Aditiva: solo `CREATE TABLE` + índices; `down_revision = 0006_notificacion_config`.
Patrón de las migraciones 0002–0006 (DDL en string + `op.execute`).

```sql
CREATE TABLE ticket (
    ticket_id    SERIAL PRIMARY KEY,
    empresa_id    INTEGER NOT NULL REFERENCES empresa(empresa_id),
    usuario_id    INTEGER REFERENCES usuario(usuario_id) ON DELETE SET NULL,
    session_id    UUID NOT NULL UNIQUE REFERENCES chat_session(session_id) ON DELETE RESTRICT,
    titulo        VARCHAR(200) NOT NULL,
    estado        VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ,
    CONSTRAINT ck_ticket_estado CHECK (estado IN ('open', 'in_progress', 'resolved', 'cancelled'))
);

CREATE INDEX ix_ticket_empresa        ON ticket(empresa_id);
CREATE INDEX ix_ticket_empresa_estado ON ticket(empresa_id, estado);
CREATE INDEX ix_ticket_usuario        ON ticket(usuario_id);
```

Notas:

- `UNIQUE (session_id)` materializa D1 en el esquema.
- `ON DELETE RESTRICT` materializa la mitad BD de D4; el endpoint de borrado de
  sesiones traduce la `ForeignKeyViolation` de psycopg a `409`.
- `usuario_id` nullable + `SET NULL`: auditoría que sobrevive al usuario (D4).
- `empresa_id` NOT NULL: un ticket siempre pertenece a una empresa (igual que
  `chat_session.empresa_id`, que es NOT NULL).
- `updated_at` lo gestiona la app (en cada `UPDATE`), sin trigger — ninguna
  migración del repo usa triggers.

## 5. RBAC (matriz)

Acciones nuevas en `permissions.py` (la ruta `history` ya existe y se reutiliza):

| Acción / Ruta            | operador | tecnico | supervisor | engineer | gerente | admin | visitante | super_usuario |
|--------------------------|----------|---------|------------|----------|---------|-------|-----------|---------------|
| `crear_ticket` (nueva)   | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `cambiar_estado_ticket` (nueva) | — | — | ✅ | — | ✅ | ✅ | — | — |
| `cancelar_ticket` (nueva) | — | — | ✅ | — | ✅ | ✅ | — | — |
| `history` (existente, lectura) | — | — | ✅ | — | ✅ | ✅ | — | — |

Reglas de transición (en `core/ticket_states.py`, espejo de OT):

- destino `in_progress` / `resolved`: acción `cambiar_estado_ticket` **o ser dueño**.
- destino `cancelled`: acción `cancelar_ticket` (el dueño no puede).
- Los endpoints entregan `allowed_transitions` ya filtrado por rol y dueñez,
  como hace `work_orders.py` con las OT.

## 6. Variables de entorno

**Ninguna nueva.** El ticket no depende de proveedores externos, storage ni LLM.

## 7. Contrato API (resumen)

Detalle completo (request/response, códigos, ejemplos curl) en
`docs/contrato_api_tickets.md` (CGBIDA-284).

| Método | Endpoint | Permiso | Respuesta |
|--------|----------|---------|-----------|
| `POST` | `/api/tickets` `{session_id, titulo?}` | `crear_ticket` | `201` ticket · `409` ya tiene ticket (devuelve el existente) |
| `GET` | `/api/tickets?estado=&limit=&offset=` | autenticado (dueño; `history` ve todos) | `200 {tickets, total}` |
| `GET` | `/api/tickets/{ticket_id}` | dueño o `history` | `200` ticket + mensajes de la sesión |
| `PATCH` | `/api/tickets/{ticket_id}/estado` `{estado}` | dueño (avanzar) o acción | `200` + `allowed_transitions` |

Errores comunes: `401`, `403` (rol sin acción), `404` (no existe / fuera de
alcance — no revelador), `409` (transición inválida o sesión ya con ticket),
`422` (validación Pydantic).

## 8. Orden de implementación (mapeo a subtareas)

1. **283** — este documento (Fase 0).
2. **284** — contrato API (`docs/contrato_api_tickets.md`).
3. **285** — migración `0007_tickets_conversacionales` (tabla + FKs + índices).
4. **286** — `core/ticket_states.py` + acciones en `permissions.py` + `schemas/tickets.py`.
5. **287** — `services/ticket_repository.py` + `routers/tickets.py` + registro en `main.py`.
6. **288** — relación ticket-sesión en BD aplicada de punta a punta: `409` en
   `DELETE /api/chat/sessions/{id}` (FK RESTRICT) + suite `tests/test_tickets.py`
   (BD real + seed + cleanup propio).

El frontend (289–291: botón "guardar como ticket", listado/detalle, estados)
arranca cuando se fusione la Fase 2 de HU-05.

## 9. Riesgos y deuda conocida

- **1:1 impide un segundo ticket en la misma conversación** (D1): aceptado; si el
  equipo lo levanta, se relaja el UNIQUE en una migración futura.
- **Vista en vivo**: los mensajes posteriores a la creación del ticket aparecen
  en el ticket (D4). Si se pide "congelar" la conversación en el momento del
  ticket, se agrega una tabla de snapshot en v2.
- **Sin prioridad/asignación** (D5): campos naturales para v2, junto con la
  conversión ticket → OT (hoy fuera de alcance).
- **`updated_at` sin trigger**: depende de que todo UPDATE del repo lo setee.
- **Sesiones con ticket no se pueden borrar** (D4): UX a comunicar en el frontend
  (el 409 trae el motivo; el botón de borrar sesión debería avisar).
- **Borrado de tickets**: v1 no expone `DELETE /api/tickets/{id}` — no hay caso de
  uso con permiso claro; si aparece, definiríamos quién puede (dueño vs `history`).
