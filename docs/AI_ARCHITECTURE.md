### 2.3 Gestión de memoria: `RunnableWithMessageHistory` + `InMemoryChatMessageHistory`

**Decisión:** usar la API moderna de LangChain 1.x con `RunnableWithMessageHistory`
y almacenamiento en memoria RAM por sesión.

**Configuración:**
- Ventana de memoria: `CHAT_MEMORY_WINDOW=10` (últimas 10 interacciones).
- Almacén actual: `dict[str, InMemoryChatMessageHistory]` en `llm_service.py`.
- Clave de sesión: `f"{user_id}:{session_id}"` — **aislada por usuario** para
  evitar colisiones entre conversaciones de distintos usuarios.

**Deuda técnica conocida:**
- La memoria se pierde al reiniciar el backend.
- Pendiente migrar a PostgreSQL (tabla `chat_session`) en CGBIDA-150.
- `RunnableWithMessageHistory` e `InMemoryChatMessageHistory` están deprecados
  en LangChain 1.x. Migración a LangGraph persistence planificada para Sprint 3.

### 2.5 Autenticación y control de uso

**Decisión:** proteger el endpoint con JWT opaco (tabla `sesion`) y aplicar dos
capas de rate limiting.

**Capas:**
1. **Rate limit por minuto:** 10 peticiones/min por usuario (en memoria, `core/rate_limit.py`).
2. **Límite diario de tokens:** 50 000 tokens/24h por usuario (en memoria, `core/token_limit.py`).

Ambos límites viven en memoria del proceso. Si el backend escala horizontalmente,
deben migrarse a Redis (ya disponible en la infraestructura).

**Autenticación:**
- Dependency `get_current_user` en `core/security.py`.
- Valida `Authorization: Bearer <token>` contra la tabla `sesion`.
- El `usuario_id` autenticado se usa como prefijo del `session_id` del chat.

### 2.6 Resiliencia del LLM

**Decisión:** aplicar reintentos automáticos con backoff exponencial y fallback
entre proveedores a través de la API de LangChain.

**Configuración actual:**
- Reintentos: 3 intentos con `wait_exponential_jitter=True`.
- Fallback: lista configurable vía `LLM_FALLBACK_PROVIDERS` en `.env`.
  Solo se activan los respaldos que tengan key configurada, sin tocar código.

**Proveedores soportados** (`LLM_PROVIDER`): `deepseek` | `openai` | `openrouter` |
`groq` | `nvidia`. El proveedor `nvidia` usa NIM (build.nvidia.com), que expone
una API OpenAI-compatible vía `ChatOpenAI` + `NVIDIA_BASE_URL`
(`https://integrate.api.nvidia.com/v1`); los modelos se referencian con
namespace, p. ej. `deepseek-ai/deepseek-v4.1-flash`.


### 2.7 Manejo de errores en streaming

**Decisión:** si el LLM falla **después** de que el stream SSE ya empezó, la
respuesta HTTP ya es `200` y no se puede cambiar. En ese caso el backend emite
un evento estructurado dentro del stream:

event: error
data: {"code": "internal_error", "message": "<detalle>"}


**Contrato implícito:**
- El evento `done` **no se emite** cuando hubo error.
- El cliente **debe** escuchar el evento `error` y no asumir que `HTTP 200`
  significa éxito.
- El bloque `finally` del generador registra el consumo de tokens de entrada
  **incluso si el LLM falló**, para que el usuario no pueda evadir el límite
  diario lanzando peticiones que fallen.

**Deuda técnica conocida:**
- `str(e)` se expone crudo al cliente. En producción debe sanitizarse a un
  mensaje genérico + log interno del detalle.

---

## 2.8 Gestión del historial de conversaciones

**Decisión:** cada conversación del chat IA se persiste en la tabla
`chat_session` (existente desde la migración `0002_runtime_tables`), y su
historial se reconstruye desde la BD al abrir una sesión.

### Modelo de datos

Se reutiliza la tabla `chat_session` que ya existía en el esquema:

| Columna | Tipo | Notas |
|---------|------|-------|
| `session_id` | `UUID` PK | Autogenerado con `gen_random_uuid()` |
| `empresa_id` | `INT` FK | Multi-tenant (aunque el frontend actual solo usa una empresa) |
| `usuario_id` | `INT` FK | Dueño de la conversación |
| `titulo` | `VARCHAR(200)` | Autogenerado desde el primer mensaje del usuario |
| `saved_by` | `VARCHAR(100)` | Nombre del usuario (desnormalizado para rendimiento) |
| `machine_name` | `VARCHAR(120)` | Contexto del equipo (reservado para HU futura) |
| `discipline` | `VARCHAR(100)` | Contexto de disciplina (reservado) |
| `messages` | `JSONB` | Array `[{role, content, timestamp}, ...]` |
| `metadata` | `JSONB` | Reservado para extensiones |
| `saved_at` | `TIMESTAMPTZ` | Se actualiza en cada append |

### Persistencia durante el streaming

El endpoint `POST /api/chat/stream` persiste el turno completo
(user + assistant) **en el bloque `finally`** del generador, no después
del stream. Esto garantiza que:

- Si el cliente cierra la conexión a mitad del stream, lo que se alcanzó a
  emitir igual se guarda.
- Si el LLM falla a mitad, los tokens parciales quedan persistidos.
- El consumo de tokens se registra siempre, incluso si el stream falla.

### Reconstrucción del historial

Al abrir una conversación existente, el flujo es:


┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (Angular 22, localhost:4200)                          │
│                                                                 │
│  DocChatComponent                                               │
│    ├── messages (signal<ChatMessage[]>)                         │
│    ├── sessionId (signal<string | null>) — UUID por sesión      │
│    ├── resetChat() — botón "Nueva conversación"                 │
│    └── ChatService.streamChat() ── fetch + Authorization Bearer │
└──────────────────────────────────────────────────────────────┬──┘
                                                               │
                                       POST /api/chat/stream   │
                                       Header: Authorization   │
                                       Body: {session_id, message}
                                                               │
                                                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND (FastAPI, localhost:9000)                              │
│                                                                 │
│  Router: chat.py                                                │
│    ├── Depends(get_current_user)     → valida token             │
│    ├── chat_rate_limiter.check()     → 10 req/min               │
│    ├── token_limiter.check()         → 50k tokens/día           │
│    ├── session_id = f"{uid}:{sid}"   → aislamiento              │
│    └── EventSourceResponse(...)                                 │
│           │                                                     │
│           ├── event: session  →  {session_id}                   │
│           ├── event: token    →  {text: "..."}                  │
│           ├── event: error    →  {code, message}                │
│           └── event: done     →  {}                             │
│                                                                 │
│  Service: llm_service.py                                        │
│    ├── _build_llm_with_resilience()                             │
│    │      ├── with_retry(stop_after_attempt=3)                  │
│    │      └── with_fallbacks([...])                             │
│    ├── ChatPromptTemplate (system + history + human)            │
│    ├── StrOutputParser                                          │
│    └── RunnableWithMessageHistory                               │
│           └── _store: dict["uid:sid" → history]                 │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       │ HTTPS (streaming)
                                       ▼
                              ┌──────────────────────┐
                              │ api.deepseek.com     │
                              │ (deepseek-chat)      │
                              └──────────────────────┘