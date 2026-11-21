# Contrato API `/api/documents` (HU-04)

> Gestión de manuales PDF que la IA usa como base de conocimiento (RAG).
> Diseño: `docs/referencias/RAG_ARCHITECTURE.md` (CGBIDA-231).

## Base

- **Ruta base:** `/api/documents`
- **Autenticación:** ✅ **requerida**. Header `Authorization: Bearer <token>`.
  El token se obtiene en `POST /api/auth/login` y se valida contra la tabla `sesion`.
- **Permisos RBAC** (tabla `permisos`, rol → permiso `subir_documentos`):
  - `POST` y `DELETE`: solo `engineer`, `gerente`, `admin`
  - `GET`: cualquier usuario autenticado
- **Content-Type request:** `multipart/form-data` (upload) · respuestas `application/json`

### Códigos de error comunes

| Código | Causa | Detalle |
|--------|-------|---------|
| `401` | Token faltante, inválido o expirado | `{"detail": "Token de autenticación requerido."}` |
| `403` | Rol sin permiso `subir_documentos` | `{"detail": "No tienes permiso para esta acción."}` |
| `422` | Validación de campos | Array de errores de Pydantic |
| `503` | Supabase Storage sin configurar | `{"detail": "El almacenamiento de documentos no está configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."}` |
| `500` | Error interno | Revisar logs del servidor |

---

## `POST /api/documents/upload`

Sube un PDF, lo indexa para RAG (extraer → trocear → embeddings) y lo guarda en
Supabase Storage. Responde `201` con el documento creado.

**Request (`multipart/form-data`):**

| Campo | Tipo | Requerido | Validación |
|-------|------|-----------|------------|
| `file` | archivo | ✅ | Solo `application/pdf`; tamaño ≤ `UPLOAD_MAX_SIZE_MB` (default 10) |
| `title` | string | ✅ | 1–255 caracteres |
| `notes` | string | ❌ | Texto libre |
| `discipline_id` | int | ❌ | Debe existir en `disciplina` |
| `maquina_id` | int | ❌ | Debe existir en `maquina` **y ser de la empresa del documento** (404 si no; ver sección HU-23) |

**Response `201`:**

```json
{
  "documento_id": 12,
  "title": "Manual Celda Robotizada A-3",
  "original_name": "manual_celda_a3.pdf",
  "chunks_indexed": 47
}
```

**Errores propios:** `400` (no es PDF) · `413` (excede tamaño) · `403` · `404`
(disciplina/máquina inexistente) · `503` · `500` (ingesta fallida; el documento
queda con `chunks_indexed = 0` y puede re-subirse).

**Ejemplo:**

```bash
TOKEN=$(curl -s -X POST http://localhost:9000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@barb.com","password":"admin123"}' | grep -oP '(?<="token":")[^"]+')

curl -i -X POST http://localhost:9000/api/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@manual_celda_a3.pdf" \
  -F "title=Manual Celda Robotizada A-3"
```

---

## `GET /api/documents`

Lista los documentos subidos, ordenados por `created_at DESC` (los más recientes primero).

**Query params:**

| Param | Tipo | Default | Rango | Descripción |
|-------|------|---------|-------|-------------|
| `limit` | int | 20 | 1-100 | Tamaño de página |
| `offset` | int | 0 | ≥ 0 | Desplazamiento |

**Response `200`:**

```json
{
  "documents": [
    {
      "documento_id": 12,
      "title": "Manual Celda Robotizada A-3",
      "original_name": "manual_celda_a3.pdf",
      "notes": "Incluye torreta y PLC",
      "discipline": "Eléctrica",
      "machine": "Celda A-3",
      "chunks_indexed": 47,
      "created_at": "2026-10-03T12:00:00"
    }
  ]
}
```

---

## `DELETE /api/documents/{documento_id}`

Elimina el documento completo en cascada: archivo en **Supabase Storage**
(por `file_id`), chunks en `documento_embedding` (FK `ON DELETE CASCADE`) y
metadatos en `documento`.

**Response `200`:**

```json
{
  "ok": true,
  "documento_id": 12
}
```

**Errores propios:** `404` (no existe) · `403` · `503` · `500`.

---

---

## Máquina del catálogo en los documentos (HU-23)

Un documento puede ligarse opcionalmente a una máquina de la empresa para que el chat (texto e imagen) priorice sus
documentos cuando el usuario fija esa máquina en la conversación (ver `contrato_api_chat.md`). Los documentos sin
máquina son generales de la empresa y siguen sirviendo de relleno.

> Nota: el código actual expone las rutas `POST /api/documents` (alias `/api/documentos`), `GET /api/documents` y
> `PATCH /api/documents/{id}`, y responde con la forma de abajo. Las secciones anteriores de este contrato
> describen el diseño original de HU-04 y están desactualizadas respecto de ellas.

| Operación | Campo | Semántica |
|-----------|-------|-----------|
| `POST /api/documents` (multipart) | `maquina_id` (int, opcional) | Liga el documento a la máquina al subirlo |
| `PATCH /api/documents/{id}` (JSON) | `maquina_id` | **Ausente** = no cambia · **entero** = asigna/cambia · `null` = desvincula |

- **Permiso:** el mismo `subir_documentos` (`engineer`, `gerente`, `admin`); no cambia la matriz de roles.
- **Validación:** la máquina debe pertenecer a la empresa del documento. Si no existe o es de otra empresa responde
  `404 {"detail": "Máquina no encontrada."}` y **no modifica nada** (en el upload se valida antes de leer y guardar el
  archivo; en el PATCH, antes de aplicar cualquier cambio, incluidos los demás campos del mismo request).
- **Respuesta** (POST, PATCH y cada elemento de GET): suma `maquina_id`, `maquina_nombre` y `maquina_codigo`
  (`null` los tres si el documento no tiene máquina).

```json
{
  "id": 12,
  "title": "Manual Compresor A1",
  "maquina_id": 5,
  "maquina_nombre": "Compressor A1",
  "maquina_codigo": "COMP-A1"
}
```

- **Recuperación (RAG):** con máquina en la conversación, `search_chunks` hace dos pasadas: primero los documentos de
  esa máquina y luego, si falta cupo, los generales de la empresa (nunca de otra empresa). Cada fragmento devuelto
  lleva `de_maquina` (`true` de la máquina, `false` general).

## Notas de integración

- **El chat consulta estos documentos automáticamente** (D6 de
  `RAG_ARCHITECTURE.md`): cada mensaje busca los `RAG_TOP_K` chunks más
  similares y los inyecta al system prompt. Sin documentos indexados, el chat
  funciona igual que hoy.
- `chunks_indexed` sirve de indicador de salud de la ingesta: `0` = PDF subido
  pero sin contexto indexado.
- El límite de tamaño es configurable (`UPLOAD_MAX_SIZE_MB` en `.env`) y el
  permiso `subir_documentos` ya existe en el RBAC (migración `0001`).
