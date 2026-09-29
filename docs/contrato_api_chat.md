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
      "timestamp": 1790706723216
    },
    {
      "role": "assistant",
      "content": "¡Hola! Soy BARB...",
      "timestamp": 1790706723217
    }
  ]
}
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

  