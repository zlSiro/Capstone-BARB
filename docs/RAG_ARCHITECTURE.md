# Arquitectura RAG — HU-04: Que la IA pueda recibir documentos

> **Estado:** D1 (proveedor de embeddings) **VALIDADA por el equipo** — 03/10/2026,
> se cierra CGBIDA-240. Contrato API formalizado en `docs/contrato_api_documents.md`
> (CGBIDA-232). Al implementarse, este documento se actualiza (CGBIDA-252).

## 1. Objetivo

Permitir que un administrador suba manuales PDF que la IA use como base de
conocimiento al responder el chat (HU-04, criterios: interfaz de subida,
almacenamiento externo en Supabase Storage, y consulta del contenido por la IA).

## 2. Flujo de alto nivel

```
                    INGESTA (subir manual)                          CONSULTA (chat)
┌──────────────┐    POST /api/documents/upload      ┌──────────────┐    POST /api/chat/stream
│  FRONTEND    │ ────────────────────────────────► │   BACKEND    │ ◄───────────────────────────
│  Angular     │   (multipart, RBAC)               │   FastAPI    │
└──────────────┘                                   └──────┬───────┘
                                                          │ 1. pypdf: extraer texto (en memoria)
                                                          │ 2. RecursiveCharacterTextSplitter: chunks
                                                          │ 3. Embeddings (NIM) por lote
                                                          │ 4. Supabase Storage: guardar PDF
                                                          │ 5. INSERT documento + documento_embedding (pgvector)
                                                          ▼
                                                   ┌─────────────────────────────────────┐
                                                   │ a. embed(mensaje del usuario)       │
                                                   │ b. SELECT top-k chunks (coseno)    │
                                                   │ c. system prompt + contexto → LLM   │
                                                   └─────────────────────────────────────┘
```

## 3. Decisiones (a validar con el equipo)

### D1 — Proveedor de embeddings: `nvidia/nemotron-3-embed-1b`

Coherente con la decisión de la HU-03 (todo el stack con la cuenta NVIDIA del equipo).

| Atributo | Valor |
|----------|-------|
| Endpoint | `https://integrate.api.nvidia.com/v1/embeddings` (OpenAI-compatible) |
| Dimensión del vector | **2048** (admite slice a 1024/512) |
| Español | ✅ (34 idiomas, evaluado explícitamente en retrieval multilingüe) |
| Contexto máx | 32 768 tokens |
| Benchmarks | RTEB 72.38 (SOTA en su tamaño; generación anterior: 60.47) |
| Uso comercial | ✅ OpenMDW 1.1 |

- **Integración:** cliente OpenAI de LangChain (`OpenAIEmbeddings`) con `base_url`
  de NIM, igual que el chat (`ChatOpenAI`).
- **Key:** cada key free queda asociada a la función del modelo desde cuya página
  se genera (verificado en HU-03). Habrá que generar una key desde la página del
  modelo de embeddings y **validar si una misma key sirve para chat + embeddings**;
  si no, se usan dos (`NVIDIA_API_KEY` y `NVIDIA_EMBEDDINGS_API_KEY`).
- **Alternativa registrada:** `openai/text-embedding-3-small` (si el equipo prefiere
  pagar por estabilidad). **Descartado:** DeepSeek — no ofrece API de embeddings.

### D2 — Vector store: pgvector en PostgreSQL

- **Producción (Supabase):** pgvector viene incluido — solo `CREATE EXTENSION vector`.
- **Local:** el `docker-compose.yml` usa `postgres:17-alpine` → cambiar a
  `pgvector/pgvector:pg17` (el volumen persiste los datos).
- **Nueva tabla `documento_embedding`** (vía migración Alembic — regla del repo:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documento_embedding (
    documento_embedding_id SERIAL PRIMARY KEY,
    documento_id          INTEGER NOT NULL REFERENCES documento(documento_id) ON DELETE CASCADE,
    chunk_index           INTEGER NOT NULL,
    content               TEXT NOT NULL,
    embedding             vector(2048) NOT NULL,
    created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX documento_embedding_idx ON documento_embedding
    USING hnsw (embedding vector_cosine_ops);
```

- La tabla `documento` ya existe (migración `0002_runtime_tables`); su columna
  `chunks_indexed` se usa como contador de chunks indexados.

### D3 — Archivos: Supabase Storage (bucket `barb-files`)

- El backend guarda/recupera/elimina PDFs con la **service role key** (flujo
  server-to-server, sin login de Supabase en el frontend).
- Variables: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` en `config.py`,
  **tolerante a fallos** si no están configuradas (mismo patrón que Redis): los
  endpoints de documentos responden `503` con mensaje claro, el chat sigue funcionando.
- Orden de la ingesta (evita re-descargar el archivo):
  leer bytes del form → extraer texto con pypdf **en memoria** → subir a Supabase →
  insertar metadatos + chunks + embeddings.

### D4 — Chunking: `RecursiveCharacterTextSplitter`

- `chunk_size=1200`, `overlap=200` (parámetros por `.env`: `RAG_CHUNK_SIZE`,
  `RAG_CHUNK_OVERLAP`).
- Justificación: manuales técnicos con secciones/señales de estructura; valores
  iniciales estándar para RAG de documentación. **Ajustar con manuales reales**
  durante la verificación (CGBIDA-251).

### D5 — Ingesta síncrona dentro del POST de subida

- Simple y suficiente para el alcance (un manual de 10-50 páginas procesa en
  segundos; las llamadas de embeddings van **por lote** — la API acepta listas).
- `documento.chunks_indexed` refleja el avance; si la ingesta falla a mitad,
  el documento queda con `chunks_indexed=0` y se reintenta re-subiendo.
- **Deuda futura:** job asíncrono con estado "procesando" para PDFs enormes.

### D6 — Retrieval en el chat

1. Al llegar un mensaje: `embed(mensaje)`.
2. `SELECT content FROM documento_embedding ORDER BY embedding <=> :query_vec LIMIT :top_k`
   (coseno, `top_k` por `.env`, default 4).
3. Inyección en el system prompt: *"Contexto de manuales técnicos: [chunks]"* con
   instrucción de usarlo solo si es relevante (CGBIDA-243/244).
- v1 **sin filtro** por disciplina/máquina (los documentos son de la empresa);
  refinamiento futuro usando los FKs de `documento`.
- Sin documentos indexados → el chat funciona exactamente igual que hoy.

### D7 — Permisos y validaciones

- RBAC existente: permiso `subir_documentos` (engineer/gerente/admin) → `POST`
  y `DELETE`. El listado `GET` para todos los autenticados.
- Validaciones del upload (ver subtarea nueva S1): solo `application/pdf`,
  tamaño máximo `UPLOAD_MAX_SIZE_MB` (default 10 MB).

## 4. Variables de entorno nuevas (`.env`)

```env
# --- RAG (HU-04) ---
EMBEDDINGS_MODEL=nvidia/nemotron-3-embed-1b
NVIDIA_EMBEDDINGS_API_KEY=        # validar si NVIDIA_API_KEY sirve para ambas funciones
EMBEDDINGS_TIMEOUT=60
RAG_CHUNK_SIZE=1200
RAG_CHUNK_OVERLAP=200
RAG_TOP_K=4
UPLOAD_MAX_SIZE_MB=10
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## 5. Contrato API (borrador — formaliza en CGBIDA-232)

| Método | Endpoint | Permiso | Respuesta |
|--------|----------|---------|-----------|
| `POST` | `/api/documents/upload` (multipart: file, title, notes, discipline_id?, maquina_id?) | `subir_documentos` | `201 {documento_id, title, chunks_indexed}` |
| `GET` | `/api/documents` | autenticado | `200 {documents: [{documento_id, title, original_name, discipline, machine, chunks_indexed, created_at}]}` |
| `DELETE` | `/api/documents/{id}` | `subir_documentos` | `200 {ok: true}` — borra Storage + metadatos + chunks |

Errores: `400` (no PDF / tamaño excedido), `401`, `403`, `413`, `503` (Supabase sin configurar), `500`.

## 6. Orden de implementación (mapeo a subtareas)

1. **Fase 0:** 231 (este documento) → 232 (contrato) → 240 (se cierra al validar D1)
2. **Fase 1:** 241 (imagen pgvector + migración Alembic) · 233 (bucket Supabase) · S2 (credenciales)
3. **Fase 2 (backend):** 234 → 235 → 236 → 238 → 239 → 242 → 243 → 244
4. **Fase 3 (frontend):** 245 → 246 → 247 → 248 → 249
5. **Fase 4:** 250 (tests) → 251 (E2E) → 252 (actualizar este doc) → 253 (README)

## 7. Subtareas nuevas sugeridas (a crear en Jira)

- **S1 — Validaciones de seguridad del upload:** tipos MIME permitidos (solo PDF),
  tamaño máximo, límite de documentos. *Ninguna subtarea existente lo cubre.*
- **S2 — Credenciales de Supabase Storage en el backend:** `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` en `config.py`, tolerante a fallos (patrón Redis).

## 8. Riesgos y deuda conocida

- **Latencia variable del free endpoint de NVIDIA** (ya observada en HU-03):
  mitigado con embeddings por lote y `EMBEDDINGS_TIMEOUT`.
- **Keys free por función de modelo:** puede requerir una segunda key para
  embeddings — validar al generarla.
- **Cambio de imagen del contenedor local** (`postgres:17-alpine` → `pgvector/pgvector:pg17`):
  el volumen persiste; el equipo debe recrear su contenedor local (10 min).
- La búsqueda solo cubre documentos subidos tras la implementación (no hay
  backfill de archivos históricos del repositorio documental del legado).
