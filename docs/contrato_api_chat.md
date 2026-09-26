### 📄 Contrato de API: `/api/chat`

**Autenticación:** Bearer JWT (requerido en todos los endpoints).
**Base URL:** `/api/chat`
**Content-Type:** `application/json`

#### 1. `POST /api/chat/stream` (Endpoint principal)
Inicia o continúa una conversación con streaming de tokens vía SSE.

**Request Body:**
```json
{
  "session_id": "uuid | null", 
  "message": "string"
}
```
*   `session_id`: Opcional. Si es `null`, el backend crea una nueva sesión en `chat_session` y la devuelve en el primer evento SSE.
*   `message`: El mensaje del usuario (máximo 2000 caracteres).

**Response (Server-Sent Events):**
El servidor responde con `Content-Type: text/event-stream`. Se emiten 4 tipos de eventos:

| Evento | Payload (data) | Cuándo se emite |
|--------|----------------|-----------------|
| `session` | `{"session_id": "uuid", "created_at": "iso"}` | Al inicio, para informar al frontend el ID de la sesión (nuevo o existente). |
| `token` | `{"text": "fragmento"}` | Cada vez que el LLM genera un token o fragmento de texto. |
| `error` | `{"code": "string", "message": "string"}` | Si ocurre un error (API caída, timeout, rate limit). Cierra el stream. |
| `done` | `{}` | Al finalizar la generación de la respuesta. Cierra el stream. |

**Ejemplo de flujo SSE:**
```text
event: session
data: {"session_id": "123e4567-e89b-12d3-a456-426614174000", "created_at": "2026-09-26T10:00:00Z"}

event: token
data: {"text": "Hola"}

event: token
data: {"text": ", "}

event: token
data: {"text": "¿en qué puedo ayudarte?"}

event: done
data: {}
```

#### 2. `GET /api/chat/sessions` (Historial)
Obtiene la lista de sesiones del usuario autenticado.

**Response (200 OK):**
```json
[
  {
    "id": "uuid",
    "created_at": "iso",
    "updated_at": "iso",
    "last_message_preview": "string"
  }
]
```

#### 3. `GET /api/chat/sessions/{session_id}`
Obtiene el historial completo de una sesión.

**Response (200 OK):**
```json
{
  "session_id": "uuid",
  "messages": [
    { "role": "user", "content": "string", "created_at": "iso" },
    { "role": "assistant", "content": "string", "created_at": "iso" }
  ]
}
```

---

### ⚙️ Configuración de LangChain (Siguiente subtarea)

Para que el desarrollador pueda empezar con el setup en los próximos 6 días, aquí tienes los comandos y variables de entorno iniciales.

**1. Dependencias (usando `uv`):**
```bash
uv add langchain langchain-openai sse-starlette python-dotenv
```

**2. Variables de entorno (`.env`):**
```env
# LLM
OPENAI_API_KEY="sk-proj-..."
LLM_MODEL="gpt-4o-mini"
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=1024

# Memoria
CHAT_MEMORY_WINDOW=10
```

**3. Estructura sugerida en el backend:**
```text
src/barb/
├── routers/
│   └── chat.py              # Endpoints HTTP + SSE
├── schemas/
│   └── chat.py              # Pydantic models (ChatRequest, etc.)
├── services/
│   └── llm_service.py       # Configuración de LangChain, memoria y cadenas
└── core/
    └── config.py            # Carga de variables de entorno (pydantic-settings)
```

**4. Lógica central en `llm_service.py`:**
```python
from langchain_openai import ChatOpenAI
from langchain.memory import ConversationBufferWindowMemory
from langchain.chains import ConversationChain

def get_llm_chain(session_history: list = None):
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7, streaming=True)
    
    memory = ConversationBufferWindowMemory(
        k=10,
        return_messages=True
    )
    # Cargar historial de PostgreSQL a la memoria si existe
    if session_history:
        for msg in session_history:
            memory.chat_memory.add_message(msg)
            
    return ConversationChain(llm=llm, memory=memory)
```
