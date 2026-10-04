# Contrato API `/api/documents` (HU-04)

> Gestión de manuales PDF que la IA usa como base de conocimiento (RAG).
> Diseño: `docs/RAG_ARCHITECTURE.md` (CGBIDA-231).

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
| `maquina_id` | int | ❌ | Debe existir en `maquina` |

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

## Notas de integración

- **El chat consulta estos documentos automáticamente** (D6 de
  `RAG_ARCHITECTURE.md`): cada mensaje busca los `RAG_TOP_K` chunks más
  similares y los inyecta al system prompt. Sin documentos indexados, el chat
  funciona igual que hoy.
- `chunks_indexed` sirve de indicador de salud de la ingesta: `0` = PDF subido
  pero sin contexto indexado.
- El límite de tamaño es configurable (`UPLOAD_MAX_SIZE_MB` en `.env`) y el
  permiso `subir_documentos` ya existe en el RBAC (migración `0001`).
