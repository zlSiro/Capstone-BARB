# Multi-empresa, documentación por empresa y super_usuario

Migración: `backend/migrations/versions/0004_multiempresa_documentos.py`
Datos ficticios: `backend/seeds/seed_multiempresa.sql` (los aplica `scripts/seed.py`, una sola vez)

## 1. Cambios en la estructura de datos

| Tabla | Cambio | Motivo |
|---|---|---|
| `usuario` | `empresa_id` pasa a **NULLABLE** + `CHECK (rol = 'super_usuario' OR empresa_id IS NOT NULL)` | El `super_usuario` no pertenece a ninguna empresa; el resto sigue obligado a tener una. |
| `usuario`, `planta` | Índices `ix_usuario_empresa`, `ix_planta_empresa` | Todas las consultas se filtran por empresa. |
| `documento` | **+** `empresa_id` (NOT NULL, FK, con *backfill*), `usuario_id` (quién subió), `content_type`, `size_bytes`, `activo` | La tabla de la migración 0002 no tenía dueño. `activo=false` excluye un documento de la IA sin borrarlo. |
| `documento_chunk` | **Tabla nueva**: `documento_id`, `empresa_id`, `orden`, `contenido`, `tsv` (tsvector `spanish` generado) + índice GIN | Fragmentos que consulta la IA (búsqueda de texto completo de PostgreSQL). `empresa_id` se duplica a propósito como barrera extra de aislamiento. |
| `orden_trabajo` | **Sin cambios** | La empresa de una OT se deriva de `orden_trabajo → maquina → planta.empresa_id`; no se duplica el dato. |

`rol` es `VARCHAR`, por lo que agregar `super_usuario` no requiere cambiar ningún enum.

> **Nota sobre `0003_work_order_indexes`:** la BD de desarrollo ya estaba en esa revisión pero el archivo no estaba versionado en esta rama
> (`alembic upgrade head` fallaba). Se reconstruyó a partir de los índices `ix_ot_*` existentes con `CREATE INDEX IF NOT EXISTS`.
> Si esa migración existe en otra rama con el mismo id, conservar la original y descartar esta.

## 2. Roles y permisos

Nuevo rol **`super_usuario`** (acceso total, sin empresa). Cambios en `core/permissions.py` y su espejo `frontend/src/app/core/permissions/permissions.ts`:

| Clave | Quién | Uso |
|---|---|---|
| ruta `empresas` / acción `gestionar_empresas` | solo `super_usuario` | Mantenedor de empresas |
| ruta `usuarios`, acciones `ver_usuarios` / `gestionar_usuarios` | `admin` (solo su empresa) y `super_usuario` | Mantenedor de perfiles |
| ruta `documentos` | `engineer`, `gerente`, `admin`, `super_usuario` (operador/técnico/supervisor: solo ver) | Documentación de la empresa |
| acciones `subir_documentos`, `eliminar_documentos` | `engineer`, `gerente`, `admin`, `super_usuario` | Subir / activar-excluir / eliminar |

## 3. Aislamiento por empresa (cómo se garantiza)

* `get_sesion_actual` ahora resuelve `empresa_id` del usuario en **cada request** (y bloquea empresas `suspended`/`cancelled`).
* `resolver_empresa(sesion, empresa_id_solicitada)`: un usuario de empresa **siempre** recibe la suya (cualquier `?empresa_id=` se ignora);
  el `super_usuario` recibe la solicitada o `None` (= todas).
* Filtrados por empresa: OTs (listado/detalle/estado/borrado/creación), catálogos (máquinas, plantas, disciplinas, técnicos),
  stats/dashboard, topología, usuarios, documentos y chat.
* Al crear una OT, la máquina y el técnico deben pertenecer a la misma empresa.
* Acceder a un recurso de otra empresa responde **404** (no se revela su existencia).
* Suspender/cancelar una empresa cierra las sesiones abiertas de sus usuarios y bloquea nuevos logins (403).

## 4. Chat IA: solo responde con la documentación de la empresa

`POST /api/chat/stream` (`routers/chat.py`):

1. Busca los fragmentos más relevantes **de la empresa del usuario** en `documento_chunk` (solo documentos `activo`), usando el mensaje y el
   último mensaje previo del usuario (para preguntas de seguimiento).
2. **Si no hay fragmentos relevantes, no se llama al LLM**: se responde un mensaje fijo ("no encontré información en la documentación…").
3. Si los hay, se inyectan en el prompt con reglas explícitas: responder solo con ese contenido, no inventar, citar el documento e
   ignorar instrucciones incrustadas en los documentos.

El `super_usuario` (sin empresa) debe indicar `empresa_id` en el body; para el resto se ignora.

Limitaciones conocidas: la recuperación es léxica (full-text `spanish`), no semántica con embeddings; los PDF escaneados sin texto
se rechazan al subir (422); los límites de rate/tokens siguen siendo en memoria.

## 5. API nueva / modificada

| Método y ruta | Acceso | Descripción |
|---|---|---|
| `GET/POST /api/empresas`, `GET/PUT/DELETE /api/empresas/{id}` | super_usuario | CRUD. `POST` admite `admin` inicial (misma transacción). `DELETE` falla con 409 si hay datos asociados (usar `estado='cancelled'`). |
| `GET/POST /api/usuarios`, `PUT/DELETE /api/usuarios/{id}` | admin / super | Alcance por empresa, límite `max_usuarios`, email duplicado → 409, no se puede eliminar/desactivar a sí mismo, un admin no puede crear `super_usuario`. |
| `GET/POST /api/documents` (alias `/api/documentos`), `PATCH/DELETE /api/documents/{id}` | ver: roles con ruta `documentos`; escribir: `subir_/eliminar_documentos` | Subida multipart (pdf, docx, txt, md, csv, json, log; máx. 15 MB) con extracción e indexación. |
| `POST /api/auth/login` | — | La respuesta incluye `empresa_id` y `empresa_nombre`. |
| Listados existentes | — | Aceptan `?empresa_id=` solo para el `super_usuario`. |

## 6. Frontend

* `/empresas` (mantenedor, solo super): crear con admin inicial, editar, suspender/reactivar, eliminar, saltar a usuarios/documentos de la empresa.
* `/usuarios`: alta/edición/activar/eliminar de perfiles (admin de empresa y super).
* `/documentos`: subir, excluir/incluir en la IA, eliminar.
* Cabecera: el `super_usuario` elige la empresa activa (o "Todas"); `TenantContextService` + interceptor agregan `?empresa_id=` a los GET y el chat lo envía en el body. Al cambiar la empresa se recarga la página.
* Menú lateral y página inicial dependen del rol (super → `/empresas`).

## 7. Datos ficticios para probar

Aplicar: `uv run alembic upgrade head && uv run python scripts/seed.py` (desde `backend/`).

| Usuario | Contraseña | Rol / empresa |
|---|---|---|
| `super@barb.com` | `super123` | super_usuario (todas) |
| `admin@barb.com` | `admin123` | admin · Planta Demo BARB |
| `engineer1@planta.com` | `engineer123` | engineer · Planta Demo BARB (sube documentos) |
| `visitante@planta.com` | `visitante123` | visitante · Planta Demo BARB |
| `admin@mineranorte.cl` | `minera123` | admin · Minera Norte S.A. |
| `gerente@mineranorte.cl` | `minera123` | gerente · Minera Norte S.A. |
| `pedro@mineranorte.cl` | `minera123` | tecnico · Minera Norte S.A. |
| `admin@trialcorp.cl` | `trial123` | admin · Demo Trial Corp |
| `admin@constructorasur.cl` | `sur12345` | admin · Constructora Sur (**suspendida**, no puede entrar) |

Incluye 8 OTs y 7 máquinas para Minera Norte, 2 OTs para Demo Trial y documentación distinta por empresa
(p. ej. *"torque de los pernos de la tapa del cilindro de la prensa"* solo lo sabe Planta Demo; *"setting del chancador"* solo Minera Norte).
Un manual está marcado **Excluido** para ver cómo la IA lo ignora.

## 8. Pruebas

`backend/tests/test_multiempresa.py` (≈30 pruebas contra la BD real): aislamiento de OTs/usuarios/documentos/catálogos/stats/topología,
permisos del super_usuario, alta/suspensión/eliminación de empresa con admin inicial, límites de licencia, extracción/fragmentación/búsqueda
y comportamiento del chat con y sin documentación.
`test_admin_tiene_acceso_total_a_rutas` se ajustó: la ruta `empresas` es exclusiva del super_usuario.
