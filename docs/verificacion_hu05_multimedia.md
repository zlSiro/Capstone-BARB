# CGBIDA-281 — Verificación de la HU-05: que la IA pueda procesar multimedia

**Fecha:** 2026-10-16 · **Ramas:** `HU05_Chatbot_procesar_multimedia` (Fases 0–1, PR #24),
`HU05_Chatbot_procesar_multimedia_v2` (Fase 2, PR #25), `feat/HU05_Fase3_verificacion` (este doc)
**Alcance:** HU-05 (CGBIDA-123) y sus subtareas CGBIDA-274 a 282.
**Ejecutada por:** quien implementó. **NO es una revisión independiente** — ver "Limitación".

Cada punto lleva la evidencia con la que se comprobó. Lo que no se pudo comprobar se marca
como NO VERIFICABLE en lugar de darse por bueno.

---

## 1. ¿Todo lo que la HU promete está hecho?

Contrastado contra los 2 criterios de aceptación de CGBIDA-123.

| # | Criterio de la HU | Estado | Evidencia |
|---|---|---|---|
| CA-1 | Puedo adjuntar imágenes en el chat | ✅ | `image-attachment.component.ts` (botón 📎, valida jpeg/png/webp ≤5 MB antes de emitir); preview con "Quitar" sobre el input; pruebas: 5 tests del componente + E2E por el proxy del frontend; PR #25 |
| CA-2 | La IA recibe la imagen y responde en base a ella | ✅ | `POST /api/chat/multimedia` (PR #24) → `meta/muse-glimmer-30b` vía NIM; respuestas reales en español describiendo el contenido de la imagen (ver §5); 27 tests de backend + smoke HTTP del contrato |

Fuera de alcance por decisión del equipo (v1): asociar la imagen a una máquina del
catálogo y responder con los manuales de la empresa (RAG multimodal) — **registrado como
HU-23 propuesta** para backlog futuro, con el contexto técnico en Jira.

---

## 2. ¿Las subtareas están correctamente marcadas?

| Subtarea | Qué era | Dónde quedó |
|---|---|---|
| CGBIDA-274 | Propuesta de arquitectura | ✅ `docs/MULTIMODAL_ARCHITECTURE.md` (PR #24) |
| CGBIDA-275 | Contrato API | ✅ `docs/contrato_api_chat_multimedia.md` (PR #24) |
| CGBIDA-276 | Endpoint multimedia | ✅ `routers/chat.py` (PR #24) |
| CGBIDA-277 | Integración modelo multimodal | ✅ `llm_service.py` + config (PR #24) |
| CGBIDA-278 | Componente de carga de imagen | ✅ `image-attachment.component.ts` (PR #25) |
| CGBIDA-279 | Preview y envío en el chat | ✅ `doc-chat.component`, `chat.service` (PR #25) |
| CGBIDA-280 | Tests | ✅ 27 backend + 10 frontend en sus PRs; suite completa: §6 (este doc la registra) |
| CGBIDA-281 | E2E | ✅ este documento (evidencia: §5) |
| CGBIDA-282 | Documentación final | ✅ sección 2.9 de `docs/AI_ARCHITECTURE.md` (este PR) |

---

## 3. ¿El contrato y el código coinciden?

Contraste de cada afirmación de `docs/contrato_api_chat_multimedia.md` contra `routers/chat.py`.

| Afirmación del contrato | ¿La cumple el código? | Evidencia |
|---|---|---|
| Ruta `POST /api/chat/multimedia`, Bearer requerido | ✅ | `@router.post("/multimedia")` + `Depends(get_current_user)`; sin token → 401 verificado por HTTP |
| Body `{session_id?, message, image_base64}` | ✅ | `MultimediaRequest`; `message` ≤2000; `image_base64` data URL |
| Formatos solo jpeg/png/webp | ✅ | Validador Pydantic → `422` con **array** de errores (verificado con image/gif por HTTP) |
| Tamaño decodificado ≤ 5 MB | ✅ | `_validate_image` decodifica y mide bytes; `413` con mensaje exacto (verificado con 5 MB+1) |
| Sin imagen o mensaje vacío | ✅ | `400` "Debes adjuntar una imagen y una pregunta." (verificado por HTTP en ambos casos) |
| Rate limit 10/min compartido + tokens 50k/día | ✅ | `chat_rate_limiter`/`token_limiter` (mismos del stream); `test_rate_limit_429`, `test_token_limit_429` |
| Tokens: incluye ~4096 por imagen (D6) | ✅ | `input_tokens = estimate_tokens(message) + MULTIMODAL_IMAGE_TOKENS`; `test_tokens_imagen_y_texto_se_registran` |
| SSE idéntico al stream (`session`/`token`/`error`/`done`) | ✅ | Mismo `EventSourceResponse`; error de LLM → evento `error` sin `done` (`test_error_llm_emite_evento_error_no_done`) |
| La imagen NO se persiste (D2) | ✅ | `append_messages` guarda solo texto; `test_persistencia_guarda_solo_texto` (además: sin "base64" en el historial); verificado en BD en el smoke E2E |
| 503 sin modelo configurado | ✅ | `settings.multimodal_configurado`; mensaje exacto del contrato; `test_modelo_no_configurado_503` |
| session_id UUID / sesión ajena | ✅ | 422 UUID inválido / 404 no existente o ajena (mismos tests que el stream) |
| super_usuario elige empresa | ✅ | Misma regla que `/stream` (`chat_session.empresa_id` NOT NULL); `test_super_usuario_sin_empresa_422` y `test_super_usuario_con_empresa_...` (backend y frontend) |
| El frontend valida antes de enviar y el backend revalida | ✅ | `image-attachment.component.ts` (formato+tamaño → toast traducido) + backend revalida todo |

---

## 4. Frontend: i18n y validaciones espejo

| Punto | Estado | Evidencia |
|---|---|---|
| Claves nuevas en `translations.ts` ES/EN | ✅ | 12 claves en la sección `docChat` (attachImage, imageReady, imageHint, errores del servicio, etc.) |
| Sin literales sin traducir en el flujo nuevo | ✅ | Componente de carga y DocChat toman todo de `t()`; los mensajes de error del servicio multimodal usan i18n (los del stream textual quedaron como estaban) |
| Validaciones espejo del contrato | ✅ | jpeg/png/webp + 5 MB en el componente (tests: gif rechazado, >5 MB rechazado) |
| Envía por el multimodal solo si hay imagen; textual si no | ✅ | `sendMessage` bifurca; `chat.service.spec.ts` (endpoint y body de cada stream) |
| La miniatura vive solo en la sesión | ✅ | `imageUrl` no se persiste; al recargar desde Historial no aparece (D2) |

---

## 5. Evidencia E2E (real, contra muse-glimmer-30b en NIM)

**Experimento previo del modelo** (punto 7 del diseño, con el patrón exacto de producción):
jpeg/png/webp vía data URL responden en español con análisis visual correcto; latencia
4–20 s (free tier); streaming OK. La misma `NVIDIA_API_KEY` del chat sirvió para
multimodal. **Hallazgo:** sin `Reasoning strength: low` el razonamiento consume el
`max_tokens` y la respuesta llega vacía — fijado en el system prompt (D5).

**Contrato por HTTP** (servidor local, BD real, `admin@barb.com`):

```
401 sin token              → 401                              ✓
400 image_base64="hola"    → {"detail":"Debes adjuntar una imagen y una pregunta."} [400] ✓
400 message="   "          → {"detail":"Debes adjuntar una imagen y una pregunta."} [400] ✓
422 data:image/gif;base64… → array Pydantic "Formato de imagen no permitido (image/gif)…"
                              Solo se aceptan: image/jpeg, image/png, image/webp." [422]  ✓
413 5 MB+1 decodificados   → {"detail":"La imagen supera el máximo de 5 MB."} [413]       ✓
```

**Flujo completo vía el proxy del frontend** (`:4200/api/...` → backend; el camino exacto
de la app): login → `POST /api/chat/multimedia` con PNG de prueba → 71 eventos `token`
en español describiendo la imagen → `done`. La sesión quedó en el Historial con solo el
texto del turno (2 mensajes, sin base64) — verificado consultando
`GET /api/chat/sessions/{id}`.

**Prueba manual en la UI** (Javier, 2026-10-16): foto real de bomba centrífuga
ITT/Xylem → el asistente la identificó, describió solo lo visible (voluta, purgador,
caja de bornes), **se negó a inventar datos de la placa** y pidió la foto específica
que necesitaba. Comportamiento previsto por el system prompt.

---

## 6. ¿Los tests pasan?

```
backend : 297 passed, 1 failed in 20:07
frontend: 80 passed / 1 preexistente (scaffold app.spec.ts)
ruff    : limpio en el código de la HU-05; 3 B904 preexistentes (reportados en verificación HU-07 §6)
```

El fallo de backend es **ambiental y ajeno a la HU-05**:
`test_multiempresa.py::test_empresa_suspendida_no_puede_iniciar_sesion` espera que
Constructora Sur esté `suspended` (estado del seed tras la PR #23), pero el `.env`
local apuntaba a la BD de **Supabase (producción)**, cuyo seed es anterior a ese
cambio. Re-ejecutado contra la BD local de podman (que sí tiene el estado):
**1 passed**.

El fallo del frontend es el scaffold `app.spec.ts` ("should render title"), que
espera el boilerplate de Angular: **preexistente en main** — falla idéntico sin estos
cambios; ya reportado en `verificacion_hu07_topologia.md` §6.

### Los tests no son vacuos: verificado por mutación

Mutaciones aplicadas sobre el código de la HU-05 y los tests que debieran fallar
(batería ejecutada en local, 2026-10-16; cada mutación se restauró y la suite
volvió a 27/27):

| Mutación aplicada | Tests que fallaron |
|---|---|
| Quitar `image/webp` de `ALLOWED_IMAGE_MIME` | 1 (`test_formatos_permitidos_pasan_validacion`) |
| Quitar `+ MULTIMODAL_IMAGE_TOKENS` de la contabilidad (D6) | 2 (`test_tokens_imagen_y_texto_se_registran`, `test_tokens_se_consumen_aunque_falle_el_llm`) |
| Cambiar el mensaje del `413` ("máximo" → "límite") | 1 (`test_imagen_sobre_5mb_413` — fija el texto exacto del contrato) |
| Cambiar el mensaje del `503` (quitar "(MULTIMODAL_MODEL)") | 1 (`test_modelo_no_configurado_503` — fija el texto exacto del contrato) |

El único fallo conocido de la suite frontend es `app.spec.ts > should render title`
(scaffold de Angular que espera el boilerplate): **preexistente y ajeno** — falla
idéntico en main limpio; ya estaba reportado en `verificacion_hu07_topologia.md` §6.

---

## 7. Queda algo suelto

| # | Punto | Estado |
|---|---|---|
| 1 | Verificación en **producción** (Render/Cloudflare) | **PENDIENTE**: JP debe confirmar `MULTIMODAL_MODEL` en Render (ya pedida) y el log de arranque `Chat multimodal (HU-05) activo`; luego probar el flujo completo en la app desplegada |
| 2 | Comentarios/cierres en Jira (274–282) | A cargo de Javier, con los borradores ya redactados |
| 3 | HU-23 (binding a máquina + RAG multimodal) | Propuesta en backlog; sin implementar por decisión del equipo |
| 4 | Capturas del flujo en la UI | Sugeridas en los comentarios de la PR #25 |
| 5 | 3 errores `B904` preexistentes en `chat.py` | Ajenos a la HU-05; ya reportados en `verificacion_hu07_topologia.md` §6.5 |
| 6 | **`.env` local apuntando a la BD de Supabase (producción)** durante estas verificaciones | La suite y los smoke tests corrieron contra producción (el único fallo provino de eso). **Restaurar `DATABASE_URL` local** y revisar con JP si hay que limpiar filas de prueba en Supabase |
| 7 | **BD local con revisión fantasma `0007_tickets_conversacionales`** | El podman local tiene aplicada una migración de HU-06 que aún no está en main (`alembic current` falla desde main). Normalizar al traer main cuando HU-06 avance |

---

## 8. Limitación de esta revisión

**La ejecutó quien implementó** (mismo criterio que la verificación HU-07), así que no
sustituye una revisión independiente. Lo que sí aporta es evidencia reproducible
(comandos HTTP, tests, mutaciones, respuestas crudas del modelo) en lugar de juicio.
Idealmente JP o René le dan una pasada al diff y prueban el flujo en el navegador.

## 9. NO VERIFICABLE

| # | Qué | Por qué |
|---|---|---|
| 1 | Que la UI **se renderice y se sienta** bien en un navegador real (preview, miniatura, foco del botón 📎, lector de pantalla) | No hay navegador en el entorno de desarrollo de esta verificación; jsdom no reproduce layout ni lectores. **Requiere prueba humana** (la prueba manual de Javier cubre parcialmente) |
| 2 | Comportamiento en producción (latencia real de NIM desde Render, arranque con las variables seteadas) | Requiere el despliegue; marcado PENDIENTE en §7.1 |
| 3 | AXE/WCAG AA completo de los componentes nuevos | Requiere auditoría en navegador; se siguió el patrón accesible del repo (botón real + input oculto, aria-label, foco visible) |
