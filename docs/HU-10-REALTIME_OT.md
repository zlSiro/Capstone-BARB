# Monitoreo de OTs en tiempo real (HU-10)

Streaming de cambios de OT hacia el navegador por **SSE** (Server-Sent Events). Cubre CGBIDA-334 a 342, 353.

- Broker + tickets: `backend/src/barb/services/realtime.py`
- Endpoints: `backend/src/barb/routers/realtime.py`
- Puntos de publicación: `backend/src/barb/routers/work_orders.py` (crear / cambiar estado / eliminar)
- Tests: `backend/tests/test_realtime_broker.py`, `backend/tests/test_realtime_stream.py`
- Carga: `backend/scripts/sse_load.py`

## Decisiones

### SSE vs WebSocket (CGBIDA-334) — SSE

| | SSE | WebSocket |
|---|---|---|
| Dirección | servidor → cliente (lo único que necesitamos) | bidireccional |
| Infra | HTTP plano; pasa por Render y Cloudflare sin configuración | upgrade de protocolo, más sensible a proxies |
| Reconexión | nativa en `EventSource`, con `Last-Event-ID` | a mano |
| Código | `sse-starlette` ya se usa en `/api/chat/stream` | dependencia nueva |

El cliente nunca envía mensajes por el canal: los cambios de estado siguen entrando por `PATCH /api/work-orders/{numero_ot}/status`.

### Modelo de eventos (CGBIDA-335)

Cada evento SSE: `event:` = tipo, `data:` = JSON, `id:` = `<boot>-<seq>` (`boot` = arranque del proceso, `seq` = contador).

| `event` | cuándo | `data` |
|---|---|---|
| `hello` | al conectar | `{connected, empresa_id}` (sin `id`; incluye `retry: 3000`) |
| `ot.created` | OT creada | `{numero_ot, ot_id, estado, usuario_id, empresa_id, timestamp}` |
| `ot.status_changed` | cambio de estado | `{numero_ot, ot_id, estado_anterior, estado_nuevo, usuario_id, empresa_id, timestamp}` |
| `ot.deleted` | OT eliminada | `{numero_ot, ot_id, usuario_id, empresa_id, timestamp}` |
| `resync` | gap no recuperable | `{reason: "gap" \| "overflow"}` (sin `id`) |
| `error` | sesión expirada | `{code: "session_expired"}`; el servidor cierra el stream |

Heartbeat: comentario SSE `: ping` cada 15 s.

El evento **no** incluye `allowed_transitions` (depende del rol de cada cliente). Para refrescar una fila el cliente llama `GET /api/work-orders/{numero_ot}`.

### Alcance del "tiempo real" (CGBIDA-336)

- Entra: crear, cambiar estado y eliminar OT vía API. Objetivo de latencia < 1 s.
- Aislamiento multi-empresa: usuario de empresa solo recibe eventos de su empresa (se ignora cualquier `empresa_id` del cliente). `super_usuario` recibe todas, o filtra con `?empresa_id=`.
- Fuera: cambios hechos por SQL directo, y el paso automático a `overdue` (no hay scheduler en proceso; ver `docs/NOTIFICACIONES.md`).
- Una sola instancia (plan gratis de Render). Escalar a varias = broker en Redis pub/sub.

### Reconexión (CGBIDA-337, 341)

- El servidor guarda los últimos **500** eventos en un buffer circular.
- El navegador reconecta solo y envía `Last-Event-ID`:
  - mismo `boot` y el id sigue en el buffer → se reenvían los eventos perdidos (solo de su empresa);
  - otro `boot` (reinicio), id viejo o inválido → `resync`;
  - sin `Last-Event-ID` (primera conexión) → solo eventos nuevos.
- Cada conexión tiene una cola de 100 eventos. Si el cliente es lento y se llena, se descartan sus pendientes y recibe `resync`. Un cliente lento no frena a los demás ni al request que publica.
- Al cerrarse la conexión (o fallar) el suscriptor se da de baja; la sesión se revalida cada 60 s.

## Flujo

```
PATCH /status ──► transacción (FOR UPDATE + UPDATE + audit) ──► COMMIT
                                                                   │
                                                  publish_safe(ot.status_changed)
                                                                   │
                                     buffer circular (500) ◄───────┤
                                                                   ▼
                                       cola de cada suscriptor con la misma empresa
                                                                   ▼
                                           EventSourceResponse ──► navegador
```

`publish_safe` va **después** del commit y nunca lanza: si falla, el cambio de estado igual se confirma.

## API

### `POST /api/work-orders/stream/ticket` (alias `/api/work_orders/...`)

Header `Authorization: Bearer <token>`. Devuelve `{"ticket": "...", "expires_in": 60}`. Ticket de **un solo uso**, 60 s.

### `GET /api/work-orders/stream` (alias `/api/work_orders/...`)

Autenticación (CGBIDA-340), una de:

- `Authorization: Bearer <token>` (p. ej. `fetch` + stream, como `chat.service.ts`).
- `?ticket=<ticket>`: para `EventSource` nativo, que no puede enviar headers. El token de sesión nunca viaja en la URL.

Query opcional: `empresa_id` (solo `super_usuario`). Header opcional `Last-Event-ID` (lo envía el navegador solo).

| Código | Causa |
|---|---|
| 200 | stream abierto |
| 401 | sin credenciales, token/ticket inválido o expirado |
| 403 | empresa suspendida/cancelada |

Cualquier rol autenticado puede abrir el stream (mismo criterio que `GET /api/work-orders`: `require_auth`).

## Guía para el cliente (frontend)

```ts
const { ticket } = await http.post<{ ticket: string }>('/api/work-orders/stream/ticket', {}).toPromise();
const es = new EventSource(`/api/work-orders/stream?ticket=${ticket}`);

es.onopen = () => estado.set('conectado');
es.onerror = () => estado.set(es.readyState === EventSource.CLOSED ? 'desconectado' : 'reconectando');
es.addEventListener('ot.status_changed', (e) => actualizarFila(JSON.parse(e.data)));
es.addEventListener('ot.created', () => recargarListado());
es.addEventListener('ot.deleted', (e) => quitarFila(JSON.parse(e.data).numero_ot));
es.addEventListener('resync', () => recargarListado());
es.addEventListener('error', ...) // evento SSE "error": session_expired -> login
```

Ojo:

- **El ticket vale una vez.** Si `EventSource` reconecta solo, la URL vieja lleva un ticket ya consumido y responde 401 (readyState `CLOSED`). Ante `CLOSED` pedir un ticket nuevo y crear otro `EventSource`. Con `fetch` + `Authorization` no hay este problema, pero la reconexión y `Last-Event-ID` hay que hacerlos a mano.
- Tras reconectar, el `EventSource` nuevo no hereda `Last-Event-ID`; para no perder eventos conviene refrescar el listado al reabrir.
- Degradación (CGBIDA-346): si no hay conexión, el listado sigue funcionando por carga manual; mostrar "desconectado".

## Proxy / balanceador (CGBIDA-342)

- Respuesta con `Cache-Control: no-cache` y `X-Accel-Buffering: no`; `ping` cada 15 s evita el corte por inactividad.
- Render free = 1 instancia: no hacen falta sticky sessions. Detalle en `DEPLOY.md`.
- Con varias instancias, sticky sessions **no** bastan (un evento publicado en la instancia A no llega a los clientes de B). Habría que publicar en Redis pub/sub (`redis.asyncio` ya está en el proyecto) y que cada instancia reparta a sus suscriptores locales. El buffer de replay también tendría que salir de memoria.

## Pruebas

- **Unitarias (CGBIDA-348)**: `test_realtime_broker.py`: aislamiento por empresa, replay, `resync` por gap/boot/overflow, baja de suscriptor, tickets (un uso, expiración). No usan BD.
- **Integración (CGBIDA-350 / 351, parte backend)**: `test_realtime_stream.py`: 401 del canal, publicación al cambiar/crear/eliminar OT, aislamiento entre empresas, replay tras reconexión. Requieren Postgres + seed. `httpx.ASGITransport` no entrega SSE en streaming, por eso el fan-out se verifica suscribiéndose al broker.
- **Carga mínima (CGBIDA-352)**: `uv run python scripts/sse_load.py --clients 50 --changes 10` contra un servidor levantado; imprime clientes caídos, eventos recibidos y latencia p50/p95.
- **E2E en navegador**: pendiente, lado frontend.

Resultados de carga: _pendiente de ejecutar con la BD arriba._
