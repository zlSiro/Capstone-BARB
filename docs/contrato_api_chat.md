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

  