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
  Actualmente vacía (solo DeepSeek tiene key). Cuando lleguen las keys de
  NVIDIA/OpenRouter, se activa sin tocar código.


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