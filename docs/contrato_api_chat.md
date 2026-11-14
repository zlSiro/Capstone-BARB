## Base

- **Ruta base:** `/api/chat`
- **Autenticación:** ✅ **requerida**. Header `Authorization: Bearer <token>`.
  El token se obtiene en `POST /api/auth/login` y se valida contra la tabla `sesion`.
- **Content-Type request:** `application/json`
- **Content-Type response:** `text/event-stream; charset=utf-8`

### Rate limiting

| Límite | Valor | Respuesta |
|--------|-------|-----------|
| Peticiones/min por usuario | 10 | `429` con header `Retry-After` |
| Tokens/24h por usuario | 50 000 | `429` con mensaje explicativo  |

### Códigos de error

| Código | Causa | Detalle |
|--------|-------|---------|
| `401` | Token faltante, inválido o expirado | `{"detail": "Token de autenticación requerido."}` |
| `422` | Mensaje vacío o > 2000 caracteres | Devuelve array de errores de validación Pydantic |
| `429` | Rate limit por minuto o límite diario de tokens | Header `Retry-After` con segundos |
| `500` | Error interno del backend | Revisar logs del servidor |

### Ejemplo de request autenticado

```bash
TOKEN=$(curl -s -X POST http://localhost:9000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@barb.com","password":"admin123"}' | grep -oP '(?<="token":")[^"]+')

curl -i -N -X POST http://localhost:9000/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message": "Hola"}' \
  --max-time 30
```

---

## Máquina vinculada a la conversación (HU-23)

`POST /api/chat/stream` acepta un campo opcional `maquina_id` para vincular la conversación a una máquina del
catálogo de la empresa del usuario. La IA prioriza y cita los documentos de esa máquina (completando con los
documentos generales de la empresa) y recibe la ficha del equipo en el prompt. El mismo campo existe en
`POST /api/chat/multimedia` (ver `contrato_api_chat_multimedia.md`).

| Valor de `maquina_id` en el request | Efecto |
|-------------------------------------|--------|
| Campo **ausente** | Conserva la máquina de la sesión (los seguimientos la heredan aunque no la nombren) |
| Entero | Fija o cambia la máquina de la sesión |
| `null` | Desvincula la sesión de la máquina |

```json
{ "session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd", "message": "¿y el torque?", "maquina_id": 5 }
```

- **Validación:** la máquina debe pertenecer a la empresa del usuario. Si no existe o es de otra empresa responde
  `404 {"detail": "Máquina no encontrada."}` (no se revela cuál de los dos casos). La validación ocurre **antes** del
  rate limit y del límite de tokens: un request inválido no consume cuota.
- **Historial de Diagnósticos:** `machine_name`, `plant_name` y `discipline` de la sesión se llenan desde la máquina
  elegida, con prioridad sobre la detección por texto del primer mensaje. La detección por texto solo rellena esos
  datos; no vincula la sesión (no fija `maquina_id`).
- Si la máquina se elimina del catálogo, la sesión queda sin vínculo (`maquina_id = null`) y conserva `machine_name`.

---

## Listado, consulta y eliminación de conversaciones

Endpoints añadidos en CGBIDA-254/255/256/257 para gestionar el historial de conversaciones del usuario. Requieren autenticación (`Authorization: Bearer <token>`).

Todos filtran por el `usuario_id` del JWT: **un usuario nunca ve, lee ni borra conversaciones de otro**.

### `GET /api/chat/sessions`

Lista las conversaciones del usuario autenticado, ordenadas por `saved_at DESC`.

**Query params:**

| Param | Tipo | Default | Rango | Descripción |
|-------|------|---------|-------|-------------|
| `limit` | int | 20 | 1-100 | Tamaño de página |
| `offset` | int | 0 | ≥ 0 | Desplazamiento |

**Response 200:**

```json
{
  "sessions": [
    {
      "session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd",
      "titulo": "Hola",
      "saved_at": "2026-09-29T18:38:49.396891Z",
      "message_count": 4
    }
  ],
  "total": 1
}

Errores:

Código	Causa
401	Sin token o token inválido
422	limit fuera de rango o offset negativo
Ejemplo:

bash
curl -s http://localhost:9000/api/chat/sessions?limit=10&offset=0 \
  -H "Authorization: Bearer $TOKEN"
GET /api/chat/sessions/{session_id}
Devuelve el historial completo de una conversación.

Path params:

Param	Tipo	Descripción
session_id	UUID	Identificador de la conversación
Response 200:

json
{
  "session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd",
  "titulo": "Hola",
  "saved_at": "2026-09-29T18:38:49.396891Z",
  "messages": [
    {
      "role": "user",
      "content": "Hola",
      "timestamp": 1790706723216,
      "has_image": false
    },
    {
      "role": "assistant",
      "content": "¡Hola! Soy BARB...",
      "timestamp": 1790706723217,
      "has_image": false
    }
  ],
  "maquina_id": 5,
  "machine_name": "Compressor A1"
}
HU-23: `maquina_id` / `machine_name` son la máquina vinculada a la conversación (`null` si no tiene) y sirven para
restaurar el selector al reabrir la sesión. `has_image` es `true` en el mensaje de usuario de un turno con imagen
(la imagen no se guarda; solo se deja la marca).

Valores de role:

Rol	Descripción
user	Mensaje enviado por el usuario
assistant	Respuesta del LLM
system	(Reservado, no se emite actualmente)
Errores:

Código	Causa
401	Sin token o token inválido
404	Sesión no existe o no pertenece al usuario (no se revela cuál)
422	session_id no es un UUID válido
Ejemplo:

bash
curl -s http://localhost:9000/api/chat/sessions/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN"
DELETE /api/chat/sessions/{session_id}
Elimina una conversación y sus mensajes.

Path params:

Param	Tipo	Descripción
session_id	UUID	Identificador de la conversación
Response 200:

json
{
  "deleted": true,
  "session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd"
}
Errores:

Código	Causa
401	Sin token o token inválido
404	Sesión no existe o no pertenece al usuario
422	session_id no es un UUID válido
Ejemplo:

bash
curl -s -X DELETE http://localhost:9000/api/chat/sessions/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN"

  