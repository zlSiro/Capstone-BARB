# Arquitectura Multimodal — HU-05: Que la IA pueda procesar multimedia

> **Estado: PROPUESTA (CGBIDA-274).** Pendiente de validación con el equipo.
> Al implementarse, se documenta el estado final en `docs/AI_ARCHITECTURE.md` (CGBIDA-282).

## 1. Objetivo

Como técnico, quiero enviar imágenes al chat para que la IA analice visualmente
un problema (criterio de aceptación HU-05: adjuntar imágenes y recibir
respuestas basadas en ellas).

## 2. Restricción crítica: el modelo del chat actual es text-only

`nvidia/nemotron-3.5-lightning-30b-a3b` (modelo activo del chat) solo acepta
texto. La HU-05 requiere un **segundo modelo multimodal** en la cuenta NVIDIA
del equipo, sin reemplazar el text-only (que sigue siendo el más rápido para
consultas puramente textuales y con RAG).

## 3. Comparativa de candidatos (build.nvidia.com, 15-10-2026)

| | `meta/muse-glimmer-30b` | `z-ai/glm-5-3-flash` | `meta/llama-3.2-11b-vision` | `nvidia/nemotron-3-nano-omni-30b` |
|---|---|---|---|---|
| Modalidades | Texto + Imagen | Texto + Imagen (8 por request) | Texto + Imagen | Texto, Imagen, Audio, Video |
| **Idiomas** | **✅ +100 idiomas (con imagen)** | ✅ multilingüe | ❌ **inglés only** con imagen | ❌ **inglés only** |
| Tamaño | 29.6B denso | 320B / 18B activos | 11B denso | 30B / 3B activos |
| Benchmarks multimodal | Charxiv 78.8 · MMMU-Pro 74 · OmniDoc 75.8 | Fuertes (sin datos publicados comparables) | DocVQA 88.4 | OCRBench 67 · Charxiv 63.6 |
| Contexto | 131k | 1M | 128k | 256k |
| Licencia | Apache 2.0 base ✓ comercial | MIT ✓ comercial | Llama Community ✓ | Open Model ✓ |
| Riesgo free endpoint | Bajo (moderate) | Medio (recién publicado 08/2026, patrón deepseek-flash) | Bajo | Bajo |

**Descartes clave:** llama-3.2-11b-vision y nemotron-omni declaran **inglés
único para entradas con imagen** — inaceptable para técnicos hispanohablantes.

## 4. Decisiones

### D1 — Modelo multimodal: `meta/muse-glimmer-30b`

- Único con **soporte multilingüe declarado para texto+imagen**.
- Benchmarks multimodales sobresalientes, superior incluso a modelos más nuevos
  en Charxiv Reasoning (78.8 vs 63.6 de nemotron-omni).
- Reasoning configurable (baja/ alta intensidad; para chat: respuesta directa).
- **Alternativa registrada:** `z-ai/glm-5-3-flash` (8 imágenes por request,
  1M contexto) si muse-glimmer saturara su free endpoint.
- **Key:** generar desde la página del modelo (cada key queda asociada a las
  funciones de los modelos usados — misma mecánica de HU-03/HU-04). Variable:
  `NVIDIA_MULTIMODAL_API_KEY` (fallback a `NVIDIA_API_KEY` si el equipo valida
  que la misma key sirve).

### D2 — Transporte de la imagen: base64 en el request

- El frontend lee el archivo del input → `data:image/jpeg;base64,...` (data URL)
  → campo `image_base64` del request. Estándar OpenAI-compatible
  (`image_url`), igual que consumen todos los modelos NIM.
- **v1 no persiste la imagen**: se usa en memoria para la respuesta y se
  descarta. El historial (`chat_session.messages`) guarda solo el texto del
  turno. La tabla `chat_debug_attachment` (migración 0002) existe para la
  persistencia futura de adjuntos + el bucket de Supabase Storage (PR #21)
  si el PO la pide — documentado como mejora futura, no bloqueante.

### D3 — Endpoint separado: `POST /api/chat/multimedia`

Las subtareas originales (CGBIDA-275/276) piden endpoint propio. Reutiliza
toda la infra del stream actual: JWT, rate limit (10 req/min), límite de
tokens diarios, SSE con los mismos eventos (`session`, `token`, `error`,
`done`), y la misma sesión conversacional (la conversación continúa en el
historial como cualquier otra).

### D4 — Validaciones de imagen (frontend + backend)

| Regla | Valor |
|-------|-------|
| Formatos | `image/jpeg`, `image/png`, `image/webp` |
| Tamaño máx | 5 MB por imagen (base64 infla ~33%: ~6.7 MB en tránsito) |
| Cantidad | 1 imagen por mensaje (v1; muse soporta más, glm-5-3 hasta 8) |
| Rechazo | `422` formato no permitido · `413` tamaño excedido · `400` sin texto |

### D5 — Cadena LangChain multimodal

- Cliente: `ChatOpenAI` con `base_url` de NIM (idéntico al chat actual),
  modelo `MULTIMODAL_MODEL` (config nueva, default `meta/muse-glimmer-30b`).
- Mensaje: `content` como lista `[{type: "text", ...}, {type: "image_url",
  image_url: {url: "data:image/...;base64,..."}}]` — el estándar que muse-glimmer
  espera (verificado en el prototipo de su model card).
- System prompt: el mismo BARB + instrucción de análisis visual + la línea
  `Reasoning strength: low` (mecanismo oficial de la model card para respuestas
  directas). **Hallazgo validado contra NIM (15-10):** sin esa línea, el
  razonamiento interno consume el `max_tokens` y `content` llega vacío — el
  equivalente multimodal del `enable_thinking: false` de nemotron.
- **RAG ligero desde v1.1 (review de la HU-05, 18-10)**: el turno multimodal
  consulta `search_chunks` de la documentación ACTIVA de la empresa (mensaje +
  último mensaje de usuario y de asistente) y el router inyecta los fragmentos
  al system message bajo "DOCUMENTACIÓN DE LA EMPRESA". El prompt obliga a
  **etiquetar el origen del conocimiento**: la identificación del equipo se
  presenta como "identificación visual" (conocimiento general, no información
  de la empresa); la documentación citada se marca igual que en el chat
  documental; y sin documentación aplicable el modelo NO inventa valores ni
  procedimientos de la empresa — remite a la sección Documentos. Motivo: en
  pruebas reales el multimodal describía cualquier equipo con conocimiento
  general mientras el chat textual negaba saber del tema (el asistente parecía
  "amnésico" en la misma conversación). La vinculación con la máquina del
  catálogo (binding por `machine_id`) queda en la **HU-23**.
- Los seguimientos de texto también mejoraron (v1.1): el stream textual incluye
  el último mensaje del **asistente** en los términos de búsqueda, para que un
  turno con imagen ("es un chancador de mandíbulas") aporte el contexto que los
  follow-ups ("¿cómo funciona?") necesitan para encontrar el manual.

### D6 — Contabilidad de tokens

Cada imagen consume ~4096 tokens visuales → cuentan contra el límite diario
de 50 000 tokens/usuario. El backend registra el consumo igual que hoy.

## 5. Variables de entorno nuevas

```env
# --- Multimodal (HU-05) ---
MULTIMODAL_MODEL=meta/muse-glimmer-30b
NVIDIA_MULTIMODAL_API_KEY=       # generada desde la página del modelo
MULTIMODAL_TIMEOUT=120
MULTIMODAL_MAX_IMAGE_MB=5
```

## 6. Contrato API (formalizado en CGBIDA-275 → docs/contrato_api_chat_multimedia.md)

`POST /api/chat/multimedia` · Body: `{session_id?, message, image_base64}`
· Response: SSE idéntico al de `/api/chat/stream`.

## 7. Experimento de validación (previo a implementar — la lección de HU-03/HU-04)

1. Generar key desde https://build.nvidia.com/meta/muse-glimmer-30b
2. Ping en **español** con una imagen técnica (foto de máquina / captura de
   panel) y verificar: HTTP 200, respuesta en español, latencia razonable.
3. Si el endpoint responde como deepseek-flash (saturado), cambiar a
   `z-ai/glm-5-3-flash` y repetir.

> **RESULTADO (15-10-2026):** ✅ validado contra NIM con el patrón exacto de
> producción (ChatOpenAI + base_url NIM + data URL base64, streaming).
> La misma `NVIDIA_API_KEY` del chat sirve para multimodal (no se requiere key
> dedicada). JPEG/PNG/WebP responden en español con análisis visual correcto.
> Latencia observada: 4–20 s por request (free tier) → `MULTIMODAL_TIMEOUT=120`.
> Hallazgo crítico: sin `Reasoning strength: low` en el system prompt, el
> razonamiento interno consume el `max_tokens` y la respuesta llega vacía (ver D5).

## 8. Orden de implementación

1. **Fase 0:** 274 (este documento) + 275 (contrato) ✅
2. **Fase 1 (backend):** 276 endpoint + 277 integración del modelo multimodal ✅
   (`POST /api/chat/multimedia`, cadena multimodal en `llm_service.py`, tests en
   `tests/test_chat_multimedia.py`, smoke test real con muse-glimmer OK)
3. **Fase 2 (frontend):** 278 componente de carga + 279 preview/envío en el chat
4. **Fase 3:** 280 tests + 281 E2E + 282 documentación final

## 9. Riesgos

- **Latencia del free endpoint** (lección HU-03): mitigado con
  `MULTIMODAL_TIMEOUT` y fallback documentado a glm-5-3-flash.
- **Tokens visuales**: una imagen = ~4096 tokens (8% del límite diario por
  imagen) — documento en la UI para gestionar expectativas del usuario.
- muse-glimmer NO garantiza calidad en cada idioma ("not evaluated on every
  language") — el experimento del punto 7 valida español explícitamente.
