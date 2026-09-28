# Arquitectura del Chat IA — HU-03

> Documento de decisiones técnicas del módulo de chat conversacional de BARB.
> Última actualización: 28 de septiembre de 2026
> Autor: René Rojas (verificador transversal)
> Sprint: 1

---

## 1. Contexto

HU-03 permite al usuario (principalmente rol `tecnico`) conversar con un asistente IA
para resolver dudas técnicas de mantenimiento industrial. Los criterios de aceptación
son:

- Existe una pantalla de chat.
- El usuario puede enviar mensajes y recibir respuestas de la IA.
- La conversación se mantiene en contexto.

## 2. Decisiones de arquitectura

### 2.1 Proveedor LLM: DeepSeek (activo)

**Decisión:** usar **DeepSeek** (`deepseek-chat`, familia V4-Flash) como proveedor
LLM principal durante el Sprint 1.

**Motivos:**
- Costo extremadamente bajo ($0.15 USD / 1M tokens entrada, $0.60 USD / 1M tokens salida).
- Recarga mínima de **$2 USD** cubre todo el desarrollo del Capstone.
- API compatible con el formato OpenAI → integración directa con LangChain.
- Estable, sin rate-limits agresivos (a diferencia de proveedores gratuitos).

**Proveedores alternativos evaluados:**

| Proveedor | Estado | Motivo de descarte / uso |
|-----------|--------|--------------------------|
| OpenAI GPT-4o-mini | Descartado | Sin crédito disponible, requiere recarga $5 USD |
| Groq (Llama 3.3 70B) | Descartado | Requiere tarjeta; límites agresivos en plan free |
| OpenRouter (Qwen3, Nemotron) | Descartado | Modelos `:free` con rate-limiting frecuente (errores 429) |
| Google Gemini | No usado | Reserva (capa gratuita amplia pero sin integrar) |
| **DeepSeek** | **Activo** | Balance costo-estabilidad óptimo |
| NVIDIA (Alloxentric) | Futuro | Modelos corporativos disponibles en producción |

### 2.2 Estrategia de streaming: SSE

**Decisión:** usar **Server-Sent Events (SSE)** mediante `sse-starlette`.

**Motivos:**
- Comunicación unidireccional (servidor → cliente), ideal para streaming de LLM.
- Estándar HTTP, no requiere upgrades de protocolo (a diferencia de WebSocket).
- Compatible con el backend FastAPI y consumible desde Angular vía `fetch` + `ReadableStream`.

**Alternativa descartada:** WebSocket (sobredimensionado para chat de una sola vía).

### 2.3 Gestión de memoria: `RunnableWithMessageHistory` + `InMemoryChatMessageHistory`

**Decisión:** usar la API moderna de LangChain 1.x con `RunnableWithMessageHistory`
y almacenamiento en memoria RAM por sesión.

**Configuración:**
- Ventana de memoria: `CHAT_MEMORY_WINDOW=10` (últimas 10 interacciones).
- Almacén actual: `dict[str, InMemoryChatMessageHistory]` en `llm_service.py`.
- Clave de sesión: `session_id` recibido del frontend (o `"default-session"`).

**Deuda técnica conocida:**
- La memoria se pierde al reiniciar el backend.
- Todos los usuarios comparten `"default-session"` si no envían un UUID propio.
- Pendiente migrar a PostgreSQL (tabla `chat_session`) en CGBIDA-150.

### 2.4 Abstracción del proveedor: factory pattern

**Decisión:** centralizar la construcción del LLM en una función `_build_llm()`
que decide el proveedor según `settings.llm_provider`.

**Ventajas:**
- Cambiar de proveedor es solo editar `.env` y reiniciar el backend.
- El router (`chat.py`) y el frontend permanecen agnósticos al proveedor.
- Facilita migrar a los modelos NVIDIA de Alloxentric sin tocar el resto del código.

```python
def _build_llm():
    if settings.llm_provider == "deepseek":
        from langchain_deepseek import ChatDeepSeek
        return ChatDeepSeek(model=settings.llm_model, ...)
    if settings.llm_provider == "openrouter":
        from langchain_openrouter import ChatOpenRouter
        return ChatOpenRouter(model=settings.llm_model, ...)
    if settings.llm_provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=settings.llm_model, ...)
    raise ValueError(f"Proveedor LLM no soportado: {settings.llm_provider}")


┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (Angular 22, localhost:4200)                          │
│                                                                 │
│  DocChatComponent                                               │
│    ├── Messages (signal<ChatMessage[]>)                         │
│    ├── isLoading / errorMessage (signals)                       │
│    └── ChatService.streamChat()  ── fetch + ReadableStream ──┐  │
└──────────────────────────────────────────────────────────────┼──┘
                                                               │
                                       POST /api/chat/stream   │
                                       (JSON: {session_id, message})
                                                               │
                                                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND (FastAPI, localhost:9000)                              │
│                                                                 │
│  Router: chat.py                                                │
│    └── EventSourceResponse(event_generator())                   │
│           │                                                     │
│           ├── event: session  →  {session_id}                   │
│           ├── event: token    →  {text: "..."}                  │
│           ├── event: error    →  {code, message}                │
│           └── event: done     →  {}                             │
│                                                                 │
│  Service: llm_service.py                                        │
│    ├── _build_llm() → ChatDeepSeek                              │
│    ├── ChatPromptTemplate (system + history + human)            │
│    ├── StrOutputParser                                          │
│    └── RunnableWithMessageHistory                               │
│           └── _store: dict[session_id → history]                │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       │ HTTPS (streaming)
                                       ▼
                              ┌──────────────────────┐
                              │ api.deepseek.com     │
                              │ (deepseek-chat)      │
                              └──────────────────────┘