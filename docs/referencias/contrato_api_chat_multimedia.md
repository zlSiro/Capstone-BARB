# Contrato API `/api/chat/multimedia` (HU-05)

> Análisis de imágenes en el chat IA (multimodal). Diseño:
> `docs/referencias/MULTIMODAL_ARCHITECTURE.md` (CGBIDA-274).

## Base

- **Ruta:** `POST /api/chat/multimedia`
- **Autenticación:** ✅ **requerida**. Header `Authorization: Bearer <token>`
  (idéntico al resto del sistema).
- **Content-Type request:** `application/json`
- **Content-Type response:** `text/event-stream` (SSE, mismos eventos que
  `/api/chat/stream`: `session`, `token`, `error`, `done`)

### Rate limiting (compartido con el resto del chat)

| Límite | Valor | Respuesta |
|--------|-------|-----------|
| Peticiones/min por usuario | 10 | `429` con header `Retry-After` |
| Tokens/24h por usuario (incluye ~4096 tokens por imagen) | 50 000 | `429` con mensaje explicativo |

## Request

```json
{
  "session_id": "711d5726-a3a6-2f2c-b738-2c15b1a5f0e2  (opcional: null = conversación nueva)",
  "message": "¿Qué le pasa a esta bomba?",
  "image_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "maquina_id": "5  (opcional, HU-23: ausente = conserva la de la sesión · entero = fija/cambia · null = desvincula)"
}
```

| Campo | Tipo | Requerido | Validación |
|-------|------|-----------|------------|
| `session_id` | string (UUID) \| null | ❌ | Si es null, se crea conversación nueva (evento `session`) |
| `message` | string | ✅ | 1–2000 caracteres (mismo límite que el chat) |
| `image_base64` | string (data URL) | ✅ | Prefijo `data:image/{jpeg\|png\|webp};base64,` · tamaño decodificado ≤ 5 MB |
| `maquina_id` | int \| null | ❌ | Máquina del catálogo de la empresa del usuario (HU-23). Misma semántica ausente/entero/null que en `/api/chat/stream` |

## Response (SSE, idéntico a `/api/chat/stream`)

```
event: session
data: {"session_id": "..."}

event: token
data: {"text": "Basado en la imagen, ..."}

event: done
data: {}
```

## Códigos de error

| Código | Causa | Detalle |
|--------|-------|---------|
| `400` | Sin imagen o mensaje vacío | `{"detail": "Debes adjuntar una imagen y una pregunta."}` |
| `401` | Token inválido/expirado | Igual que el resto del sistema |
| `403` | Perfil sin acceso a DocChat (`super_usuario` o usuario sin empresa) | `{"detail": "Tu perfil no tiene acceso a DocChat."}` — misma política que `/api/chat/stream` |
| `413` | Imagen > 5 MB | `{"detail": "La imagen supera el máximo de 5 MB."}` |
| `404` | `maquina_id` inexistente o de otra empresa (HU-23) | `{"detail": "Máquina no encontrada."}` — se valida antes del rate limit: no consume cuota |
| `422` | Formato no permitido (solo jpeg/png/webp) | Array de errores Pydantic |
| `429` | Rate limit / límite diario de tokens | Igual que el chat |
| `503` | Modelo multimodal no configurado | `{"detail": "El análisis de imágenes no está disponible (MULTIMODAL_MODEL)."}` |
| `500` / evento `error` | Fallo del modelo durante el stream | Evento estructurado dentro del SSE (el HTTP ya es 200) |

## Ejemplo

```bash
TOKEN=$(curl -s -X POST http://localhost:9000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@barb.com","password":"admin123"}' | grep -oP '(?<="token":")[^"]+')

IMG=$(base64 -w0 foto_bomba.jpg)
curl -i -N -X POST http://localhost:9000/api/chat/multimedia \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"message\": \"¿Qué le pasa a esta bomba?\", \"image_base64\": \"data:image/jpeg;base64,$IMG\"}" \
  --max-time 60
```

## Notas de integración

- La conversación (texto del turno) se persiste en `chat_session` como
  cualquier otra: aparece en el Historial de Diagnósticos. La imagen NO se
  persiste en v1 (ver D2 del diseño).
- El consumo de tokens de la imagen (~4096 visuales) se registra contra el
  límite diario del usuario (D6).
- El frontend valida formato/tamaño antes de enviar (feedback inmediato);
  el backend revalida (nunca confiar solo en el cliente).
- **Desde v1.1 (review de la HU-05):** el turno multimodal también consulta la
  documentación ACTIVA de la empresa (fragmentos relevantes rankeados con el
  mensaje y el historial reciente); el modelo etiqueta el origen de su
  respuesta — "identificación visual" vs documentación citada — y sin
  documentación aplicable no inventa valores ni procedimientos de la empresa.
- **HU-23 (máquina vinculada):** con `maquina_id`, la búsqueda prioriza los documentos de esa máquina y completa con
  los generales de la empresa, la ficha del equipo (`EQUIPO SELECCIONADO: nombre (código) — planta …, disciplina …`)
  se inyecta en el prompt y el modelo advierte si la imagen parece de un equipo distinto del seleccionado (sigue con
  el seleccionado). Sin equipo y sin documentación aplicable, el prompt exige identificación visual y decir
  explícitamente que no hay documentación de ese equipo. Los seguimientos heredan la máquina de la sesión.
- **`has_image`:** el mensaje de usuario de un turno con imagen se persiste con `"has_image": true` (y ningún campo de
  la imagen: ni base64 ni URL). `GET /api/chat/sessions/{id}` lo devuelve por mensaje.
