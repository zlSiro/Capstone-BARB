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
## 2.9 Chat multimodal — análisis de imágenes (HU-05, estado final)

> CGBIDA-276/277 (backend, PR #24) + CGBIDA-278/279 (frontend, PR #25) + Fase 3
> de verificación (CGBIDA-280/281/282). Diseño completo:
> `docs/MULTIMODAL_ARCHITECTURE.md` · Contrato: `docs/contrato_api_chat_multimedia.md`
> · Evidencia: `docs/verificacion_hu05_multimedia.md`.
>
> ⚠️ Vigencia: las secciones 2.3–2.8 describen el estado de la HU-03 (deepseek,
> `RunnableWithMessageHistory` con memoria en RAM). El estado vigente del chat
> textual es NVIDIA NIM (`LLM_PROVIDER=nvidia`, modelo `nemotron-3.5-lightning`,
> historial reconstruido desde `chat_session` vía `chat_repository`).

**Decisión:** el chat tiene **dos modelos**. El textual (nemotron, text-only) no se
reemplaza; para imágenes, un endpoint separado consulta un segundo modelo multimodal
de la misma cuenta NIM.

### Endpoint

`POST /api/chat/multimedia` (`routers/chat.py`) — reutiliza toda la infra del
stream textual: JWT, rate limit 10 req/min, límite de 50k tokens/día, SSE con los
mismos eventos (`session`/`token`/`error`/`done`) y la misma sesión conversacional
(la conversación aparece en el Historial como cualquier otra).

| Validación | Respuesta |
|---|---|
| Sin imagen (data URL inválido/base64 ilegible) o mensaje vacío | `400` "Debes adjuntar una imagen y una pregunta." |
| Formato no permitido (solo jpeg/png/webp) | `422` array de errores Pydantic |
| Imagen > 5 MB **decodificados** | `413` "La imagen supera el máximo de 5 MB." |
| Sin modelo o sin key | `503` "El análisis de imágenes no está disponible (MULTIMODAL_MODEL)." |
| Sin token / rate limit / límite diario / sesión ajena | `401` / `429` / `429` / `404` — igual que el stream |

El super_usuario elige empresa como en el stream (`chat_session.empresa_id` es
NOT NULL).

### Modelo multimodal

`meta/muse-glimmer-30b` (multilingüe con imagen, +100 idiomas) vía
`create_multimodal_chain()` en `llm_service.py`: `ChatOpenAI` + `base_url` de NIM
con `MULTIMODAL_TIMEOUT=120` s. El turno humano viaja como bloques estándar
`[{type:"text"}, {type:"image_url", image_url:{url:"data:..."}}]`.

**Hallazgo operativo clave:** el system prompt incluye `Reasoning strength: low`
(mecanismo oficial del modelo para respuestas directas). Sin esa línea, el
razonamiento interno consume el `max_tokens` y `content` llega **vacío** — el
equivalente multimodal del `enable_thinking: false` de nemotron. Verificado
empíricamente contra NIM (2026-10-15; documentado en el diseño D5).

**Sin reintentos ni fallbacks**: el modelo solo existe en NIM y la latencia del
free tier (4–20 s por request) hace un reintento peor que el error.

### Persistencia y contabilidad

- **La imagen NO se persiste** (decisión D2): se usa en memoria y se descarta;
  el historial guarda solo el texto del turno. El frontend muestra la miniatura
  solo en la sesión viva.
- **Cada imagen suma ~4096 tokens visuales** (presupuesto del ViT-G/14 del
  modelo) al límite diario del usuario (D6), junto con entrada y salida.
- **Sin RAG en v1** (D5): el turno multimodal consulta solo imagen+texto;
  integrar "imagen + documentación de la empresa" quedó registrado como mejora
  futura en el backlog (HU-23).

### Configuración

```env
MULTIMODAL_MODEL=meta/muse-glimmer-30b   # vacío → endpoint responde 503
NVIDIA_MULTIMODAL_API_KEY=               # vacía = usa NVIDIA_API_KEY (la misma key sirve)
MULTIMODAL_TIMEOUT=120
MULTIMODAL_MAX_IMAGE_MB=5
```

Al arrancar, `main.py` registra el estado en el log (verificación en Render):
`Chat multimodal (HU-05) activo: <modelo>`.
