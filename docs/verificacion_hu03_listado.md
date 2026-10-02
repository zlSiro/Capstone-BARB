# Verificación end-to-end — Listado de conversaciones (HU-03)

**Fecha:** 2026-09-29
**Verificador:** René Rojas
**Alcance:** CGBIDA-254 a CGBIDA-257 (endpoints de historial del chat IA)

---

## Entorno

| Componente | Versión / Detalle |
|------------|-------------------|
| Backend | FastAPI + Python 3.12 (Docker Compose) |
| Base de datos | PostgreSQL 17 en `localhost:5432` |
| LLM | DeepSeek `deepseek-chat` |
| Usuario de prueba | `admin@barb.com` (id=1, empresa_id=1) |

---

## Casos verificados

### CA-1 — Listar conversaciones del usuario autenticado

Comando ejecutado:

    TOKEN=$(curl -s -X POST http://localhost:9000/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email":"admin@barb.com","password":"admin123"}' \
      | grep -oP '(?<="token":")[^"]+')

    curl -s http://localhost:9000/api/chat/sessions \
      -H "Authorization: Bearer $TOKEN" | python -m json.tool

Resultado esperado: 200 OK con array `sessions` y campo `total`.

Resultado obtenido:

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

Estado: CUMPLIDO.

---

### CA-2 — Ver historial completo de una conversación

Comando ejecutado:

    curl -s http://localhost:9000/api/chat/sessions/bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd \
      -H "Authorization: Bearer $TOKEN" | python -m json.tool

Resultado esperado: 200 OK con array `messages` (rol + contenido + timestamp).

Resultado obtenido: 4 mensajes (2 turnos user/assistant) con contenido completo.

Estado: CUMPLIDO.

---

### CA-3 — Eliminar conversación

Comando ejecutado:

    curl -s -X DELETE http://localhost:9000/api/chat/sessions/bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd \
      -H "Authorization: Bearer $TOKEN" | python -m json.tool

Resultado esperado: 200 OK con `{"deleted": true, "session_id": "..."}`.

Resultado obtenido:

    {
      "deleted": true,
      "session_id": "bff4ff3f-6630-4cf6-ab6e-3aec6d1ececd"
    }

Verificación posterior: la sesión desaparece del listado.

Estado: CUMPLIDO.

---

### CA-4 — Aislamiento entre usuarios

Verificado por tests automatizados:

- `test_get_session_404_si_no_pertenece` — usuario B recibe 404 al pedir sesión de usuario A.
- `test_delete_session_respeta_aislamiento` — usuario B no puede borrar sesiones de usuario A.
- `test_list_by_user_no_devuelve_otras_sesiones` — listado filtra por `usuario_id`.

Resultado: 13 tests verdes en `tests/test_chat_history.py`.

Estado: CUMPLIDO.

---

### CA-5 — Validación de formato UUID

Verificado por tests:

- `test_session_id_formato_invalido` — 422 con mensaje "UUID válido".
- `test_get_session_uuid_invalido` — 422.
- `test_delete_session_uuid_invalido` — 422.

Estado: CUMPLIDO.

---

### CA-6 — Paginación

Verificado por test `test_list_sessions_paginacion`, que confirma que
`limit` y `offset` se pasan al repositorio.

Prueba manual ejecutada:

    curl -s "http://localhost:9000/api/chat/sessions?limit=5&offset=0" \
      -H "Authorization: Bearer $TOKEN" | python -m json.tool

Estado: CUMPLIDO.

---

## Resultado de la suite de tests

Comando ejecutado:

    uv run pytest tests/test_chat.py tests/test_chat_history.py tests/test_chat_repository.py -v

Resultado: 41 tests verdes (16 + 13 + 12).

---

## Conclusión

Los 4 endpoints del listado de conversaciones funcionan end-to-end:

1. `GET /api/chat/sessions` — lista del usuario.
2. `GET /api/chat/sessions/{id}` — historial completo con ownership.
3. `DELETE /api/chat/sessions/{id}` — borra con ownership.
4. `POST /api/chat/stream` — persiste automáticamente cada turno.

**HU-03 → CGBIDA-267 marcado como Listo.**