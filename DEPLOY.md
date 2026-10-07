# Guía de despliegue — BARB (Supabase + Render + Cloudflare Pages)

Monorepo con dos proyectos independientes:

| Carpeta | Tecnología | Plataforma | Costo |
|---|---|---|---|
| `backend/` | FastAPI (Python 3.12) | Render (Web Service) | Gratis |
| `frontend/` | Angular 22 | Cloudflare Pages | Gratis |
| Base de datos | Postgres 17 | Supabase | Gratis |

```
Navegador ──> Cloudflare Pages (Angular, estático)
     │
     └──────> Render (FastAPI /api/*) ──> Supabase (Postgres, pooler :6543)
```

## 0. Limitaciones del plan gratis (léelas)

- **Render duerme tras 15 min sin tráfico.** La primera petición tarda ~30-60 s (cold start). Normal; avisar en la defensa o hacer un ping previo.
- **Disco efímero en Render.** Las fotos de OT (`uploads/`) se pierden al redeploy o al dormir. Para demo está bien; a futuro migrar a Supabase Storage.
- **Sin Redis.** No se despliega; `core/cache.py` tolera su ausencia (solo no cachea).
- **Sin pre-deploy command en free.** Render **no aplica migraciones**: se corren a mano desde tu PC (secciones 2.2 y 2.4). Si despliegas código que necesita tablas nuevas antes de migrar, el backend da 500.
- Supabase free pausa proyectos tras 7 días sin actividad (se reactiva desde el dashboard).

## 1. Seguridad previa (HACER PRIMERO)

El archivo `backend/.env.example` contenía una connection string real de Supabase con password en el commit `ec192ec` (historial público de GitHub). Ya se reemplazó por placeholder, pero **el password sigue en el historial**:

1. Supabase → **Project Settings → Database → Reset database password**. Guarda el nuevo password.
2. Nunca commitees `.env` (ya está en `backend/.gitignore`).
3. Si el repo es público, rota también la `NVIDIA_API_KEY` si alguna vez se subió.

## 2. Supabase (base de datos)

### 2.1 Obtener connection strings

Dashboard → botón **Connect** (arriba) → pestaña **ORMs/Connection string**. Necesitas dos:

| Uso | Modo | Puerto | Formato |
|---|---|---|---|
| App en Render | **Transaction pooler** | `6543` | `postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres` |
| Migraciones (tu PC) | **Session pooler** | `5432` | igual pero puerto `5432` |

Notas:
- **No uses "Direct connection"** (`db.<ref>.supabase.co`): es solo IPv6 y Render free no lo alcanza (`Network is unreachable`).
- Si tu password tiene caracteres especiales (`@ : / # ?`), codifícalos en URL (`@` → `%40`).
- El backend ya desactiva prepared statements (`prepare_threshold=None` en `core/db.py`), requisito del Transaction pooler.

### 2.2 Aplicar migraciones y seed (desde tu PC)

```powershell
cd backend
uv sync
$env:DATABASE_URL = "postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres"   # Session pooler
uv run alembic upgrade heads
uv run python scripts/seed.py      # admin@barb.com / admin123 + datos demo (idempotente)
```

(En Git Bash: `export DATABASE_URL="..."`.) La variable de entorno tiene prioridad sobre `.env`, así no tocas tu config local.

> Desde la migración `0005_merge_heads` el repo tiene **un solo head**, así que `upgrade head` funciona. `upgrade heads` (plural) también sirve y es seguro si algún día vuelven a aparecer dos.

Verifica la versión aplicada: `uv run alembic current` debe terminar en el último head del repo (`uv run alembic heads`).

> **`seed.py` crea usuarios DEMO con contraseñas conocidas**, incluido un `super_usuario` (`super@barb.com` / `super123`) que ve toda la plataforma. Si la URL será pública, cambia o elimina esos usuarios (sección 9.4). Para una instalación real, no corras el seed (sección 9.4, opción B).

### 2.3 Verificar

Supabase → **Table Editor**: deben aparecer tablas (`sesion`, usuarios, OT, `documento`, `documento_chunk`, etc.).

### 2.4 Cambios de esquema: orden obligatorio

Render y Pages se despliegan solos al hacer push a `main`, pero **la base de datos no**. Cuando un PR agrega una migración nueva (`backend/migrations/versions/`), el orden es:

1. **Antes de mergear** el PR: aplica la migración en Supabase desde tu PC (sección 2.2, Session pooler :5432). Las migraciones del proyecto son aditivas, así que el código viejo que sigue corriendo en Render no se rompe.
2. **Después** mergea el PR a `main`. Render redepliega con el código que usa las tablas nuevas.
3. Verifica: `/health` = `online` y prueba la función afectada (por ejemplo, el chat).

Si lo haces al revés (mergear primero), el backend nuevo consulta tablas que aún no existen y responde 500 hasta que migres. Caso real de este proyecto: el chat daba `Internal Server Error` porque Supabase estaba en `0002` y el código ya usaba `documento_chunk` (migración `0004`).

Antes de aplicar, revisa qué hay pendiente:

```powershell
uv run alembic current     # versión actual de Supabase
uv run alembic heads       # versión que espera el código
```

Si necesitas revertir, `uv run alembic downgrade -1` deshace la última migración. Haz un backup antes (Supabase → Database → Backups) si la migración borra datos.

## 3. Render (backend)

Cuenta en <https://render.com> con GitHub. Dale acceso al repo del monorepo.

### Opción A — Blueprint (recomendada, usa `render.yaml` de la raíz)

1. Dashboard → **New → Blueprint** → elige el repo → rama `main`.
2. Render lee `render.yaml` y crea el servicio `barb-api` (plan Free).
3. Te pedirá los secretos (`sync: false`):
   - `DATABASE_URL` → Transaction pooler (puerto **6543**).
   - `NVIDIA_API_KEY` → tu key de <https://build.nvidia.com> (chat IA).
4. **Apply**. Espera el build (~3-5 min).

### Opción B — Manual

**New → Web Service** → repo → configurar:

| Campo | Valor |
|---|---|
| Language | Python 3 |
| Branch | `main` |
| **Root Directory** | `backend` |
| Build Command | `pip install uv && uv sync --frozen --no-dev` |
| Start Command | `.venv/bin/uvicorn barb.main:app --app-dir src --host 0.0.0.0 --port $PORT` |
| Instance Type | Free |
| Health Check Path | `/health` |
| **Build Filters → Included Paths** | `backend/**` |

### Variables de entorno (Environment)

| Variable | Valor |
|---|---|
| `PYTHON_VERSION` | `3.12.8` |
| `DATABASE_URL` | Transaction pooler `:6543` |
| `LLM_PROVIDER` | `nvidia` |
| `LLM_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `NVIDIA_API_KEY` | tu key (`nvapi-...`) |
| `NVIDIA_TIMEOUT` | `180` |
| `CORS_ORIGINS` | `https://capstone-barb.pages.dev` (URL exacta del front, sin `/` final) |
| `CORS_ORIGIN_REGEX` | `https://([a-z0-9-]+\.)?capstone-barb\.pages\.dev` (cubre previews; cambia `capstone-barb` por el nombre de tu proyecto Pages) |
| `UPLOAD_DIR` | `/tmp/uploads` |

Otros proveedores LLM: ver `backend/.env.example`.

### Verificar

- `https://<servicio>.onrender.com/health` → `{"status":"online"}` (si `error_db`: revisa `DATABASE_URL`).
- `https://<servicio>.onrender.com/docs` → Swagger.
- Anota la URL: la necesitas en la sección 5.

### Mantenerlo despierto (opcional)

UptimeRobot o cron-job.org: GET a `/health` cada 10-14 min. Útil el día de la presentación.

## 4. Cloudflare Pages (frontend)

Cuenta en <https://dash.cloudflare.com>.

1. **Workers & Pages → Create → Pages → Connect to Git** → elige el repo.
   (Si el dashboard solo muestra Workers, busca el enlace "Looking to deploy Pages? Get started" / "Import a repository" con Pages.)
2. Configuración de build:

| Campo | Valor |
|---|---|
| Production branch | `main` |
| Framework preset | `Angular` (o None) |
| **Root directory** | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist/frontend/browser` |

3. **Environment variables** (Production y Preview): `NODE_VERSION` = `24.15.0`. Angular 22 exige Node `^22.22.3` o `^24.15.0`; `22` a secas resuelve a 22.22.0 y falla. (También existe `frontend/.node-version`.)
4. **Save and Deploy**. Obtendrás `https://<proyecto>.pages.dev`.
5. **Build watch paths** (Settings → Builds → Build watch paths): Include `frontend/*` para que cambios solo en `backend/` no disparen build.

SPA: Pages sirve `index.html` como fallback cuando no hay `404.html`; las rutas de Angular funcionan al recargar. No agregues `404.html`.

### Cómo apunta el front al backend

`angular.json` (config `production`) reemplaza `environment.ts` por `environment.prod.ts` en el build. Todos los servicios (incluido chat) usan `environment.apiUrl`.

## 5. Conectar front y back

1. Edita `frontend/src/environments/environment.prod.ts`:
   ```ts
   export const environment = {
     production: true,
     apiUrl: 'https://<TU-SERVICIO>.onrender.com/api'
   };
   ```
   (El repo trae `https://barb-api.onrender.com/api`; si Render te asignó otro nombre, cámbialo.)
2. Commit + push → Pages redepliega solo.
3. En Render, ajusta `CORS_ORIGINS` con la URL real `*.pages.dev` y redepliega (Manual Deploy) si cambió.

## 6. Monorepo: despliegue por separado

- **Render**: `rootDir: backend` + Build Filter `backend/**` → solo redepliega si cambió algo en `backend/`.
- **Pages**: Root directory `frontend` + watch path `frontend/*` → solo construye si cambió `frontend/`.
- Cada push a `main` = deploy de producción de la parte afectada. Ramas/PRs distintas de `main` generan **preview** en Pages (`<rama>.<proyecto>.pages.dev`), cubierto por `CORS_ORIGIN_REGEX`. Render free no hace previews.
- Orden recomendado la primera vez: Supabase → Render → (URL) → Pages → ajustar CORS.
- Si el PR incluye migraciones: **migrar Supabase primero, mergear después** (sección 2.4).

## 7. Checklist final

- [ ] Password Supabase rotado
- [ ] Migraciones + seed aplicados en Supabase (`alembic current` = último head de `alembic heads`)
- [ ] `/health` en Render = `online`
- [ ] `environment.prod.ts` con URL real de Render
- [ ] `CORS_ORIGINS`/`CORS_ORIGIN_REGEX` con dominio `pages.dev`
- [ ] Login en la URL `pages.dev` funciona
- [ ] Chat IA responde (streaming)
- [ ] Usuarios demo del seed cambiados o eliminados (en especial `super@barb.com` y `admin@barb.com`)

## 8. Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| Consola: `blocked by CORS policy` | `CORS_ORIGINS` / `CORS_ORIGIN_REGEX` no incluyen tu dominio exacto. Sin `/` final. Redeploy Render. |
| Peticiones van a `*.pages.dev/api/...` (404/HTML) | Build sin `fileReplacements` o `environment.prod.ts` mal. Revisa `angular.json`. Verifica: `grep onrender dist/frontend/browser/*.js`. |
| Primera carga tarda ~1 min o 502 | Cold start Render free. Reintentar / ping. |
| `prepared statement "_pg3_0" already exists` | Falta `prepare_threshold=None` o usas pooler equivocado. Ya aplicado en `core/db.py`. |
| `Network is unreachable` / `could not translate host` | Usaste Direct connection (IPv6). Usa pooler. |
| `password authentication failed` | Password rotado/mal codificado en URL. Usuario del pooler es `postgres.<REF>`, no `postgres`. |
| `/health` → `error_db` | `DATABASE_URL` incorrecta en Render. |
| `Multiple head revisions are present` | Hay dos heads de Alembic. Usa `uv run alembic upgrade heads`. |
| Endpoint o chat responde 500, `/health` online | Falta aplicar una migración en Supabase (ej. `relation "documento_chunk" does not exist`). Compara `alembic current` con `alembic heads` y corre `upgrade heads` (sección 2.4). Un redeploy no lo arregla. |
| Build Pages falla: `Angular CLI requires a minimum Node.js version` | `NODE_VERSION=24.15.0` en variables de entorno (Production y Preview) y Retry deployment. |
| `Output directory "frontend/dist/cloudflare" not found` | El preset Angular trae un output por defecto incorrecto. Pon `dist/frontend/browser` en Build output directory. |
| Recargar ruta Angular da 404 | Hay un `404.html` en output; elimínalo. |
| Fotos de OT desaparecen | Disco efímero de Render. Migrar a Supabase Storage o plan con disco persistente. |
| Chat IA falla | Falta `NVIDIA_API_KEY` en Render. Ojo: `/api/health/llm` solo revisa `DEEPSEEK_API_KEY` y reportará `degraded` aunque nvidia funcione. |

## 9. Primera instalación desde cero / otra nube

Todo lo anterior describe este despliegue concreto (Supabase + Render + Pages). Si una empresa levanta BARB en otra infraestructura (AWS, Azure, GCP, VPS propio, etc.), **las migraciones se ejecutan completas desde cero**: Alembic parte de una base vacía y aplica `0001 → 0005` en orden (30 tablas, tipos enum, índices, extensión `pgvector`). No se copia nada desde Supabase; el esquema vive en `backend/migrations/` y los datos se crean aparte.

### 9.1 Requisitos de la infraestructura

| Pieza | Requisito |
|---|---|
| **PostgreSQL** | Versión 17 (la usada en desarrollo, imagen `pgvector/pgvector:pg17`) con la extensión **pgvector** disponible. |
| Permisos de la DB | El usuario de migraciones debe poder ejecutar `CREATE EXTENSION vector`. En servicios gestionados (RDS, Cloud SQL, Azure) la extensión se habilita primero desde su consola o con un rol admin. Sin ella, la migración `0003_pgvector_embeddings` falla. |
| **Backend** | Python 3.12, `uv`. Build: `uv sync --frozen --no-dev`. Start: `uvicorn barb.main:app --app-dir src --host 0.0.0.0 --port $PORT`. |
| **Disco de archivos** | Las fotos de OT se guardan en `UPLOAD_DIR`. Con disco efímero se pierden; en otra nube monta un volumen persistente y apunta `UPLOAD_DIR` ahí. |
| **Frontend** | Cualquier hosting estático con fallback SPA a `index.html`. Build con Node `^22.22.3` o `^24.15.0`. |
| **Redis** | Opcional. Sin Redis todo funciona, solo no hay caché. |
| **Proveedor LLM** | Una API key (`NVIDIA_API_KEY` u otra de `backend/.env.example`) para el chat. |

### 9.2 Orden de la primera instalación

1. **Crear la base de datos** Postgres 17 con pgvector habilitado.
2. **Obtener la `DATABASE_URL`** (formato libpq: `postgresql://usuario:password@host:5432/base`). Para migrar usa conexión directa o Session pooler, no el pooler en modo transaction. La app en runtime sí soporta pooler transaction (`prepare_threshold=None`).
3. **Aplicar el esquema** desde una máquina con acceso a la DB:
   ```powershell
   cd backend
   uv sync
   $env:DATABASE_URL = "postgresql://..."
   uv run alembic upgrade head
   uv run alembic current        # debe decir: 0005_merge_heads (head)
   ```
   Es idempotente: repetirlo cuando ya está al día no hace nada.
4. **Crear los datos iniciales** (sección 9.4). Aquí se elige entre demo y producción real.
5. **Desplegar el backend** con las variables de entorno (sección 3) y comprobar `/health` → `online`.
6. **Desplegar el frontend**: editar `frontend/src/environments/environment.prod.ts` con la URL del backend (`https://<backend>/api`), compilar con `npm run build` y publicar `dist/frontend/browser`.
7. **Configurar CORS** en el backend: `CORS_ORIGINS` = URL exacta del frontend; `CORS_ORIGIN_REGEX` solo si hay dominios de preview.
8. **Probar**: login, un listado (órdenes de trabajo), chat.

> En una instalación nueva la base está vacía, así que no hay riesgo de "migrar al revés": el orden "migrar primero, desplegar después" de la sección 2.4 se cumple por construcción.

### 9.3 Qué hace cada migración

| Migración | Contenido |
|---|---|
| `0001_initial_schema` | Tipos enum y tablas del dominio: máquinas, plantas, OT, repuestos, topología, etc. |
| `0002_runtime_tables` | `sesion`, `documento`, adjuntos de debug, feedback, preferencias de usuario. |
| `0003_work_order_indexes` | Índices de órdenes de trabajo. |
| `0003_pgvector_embeddings` | Extensión `vector` y tabla `documento_embedding` (RAG). |
| `0004_multiempresa_documentos` | Multi-empresa: `empresa_id` en documentos, `documento_chunk` con búsqueda de texto completo en español, rol `super_usuario`. |
| `0005_merge_heads` | Une las dos ramas anteriores. No cambia el esquema. |

### 9.4 Datos iniciales: demo o producción real

El esquema por sí solo deja la base **sin ningún usuario**, así que nadie puede entrar. Hay dos caminos.

**Opción A — Demo / pruebas (con datos de ejemplo)**

```powershell
uv run python scripts/seed.py
```

Crea 4 empresas ficticias, órdenes de trabajo, documentos y estos usuarios con **contraseñas conocidas, públicas en el repo**:

| Usuario | Contraseña | Rol |
|---|---|---|
| `super@barb.com` | `super123` | `super_usuario` (ve toda la plataforma) |
| `admin@barb.com` | `admin123` | `admin` (Planta Demo BARB) |
| `admin@mineranorte.cl` | `minera123` | `admin` |
| `admin@trialcorp.cl` | `trial123` | `admin` |
| `admin@constructorasur.cl` | `sur12345` | `admin` (empresa suspendida) |

El seed también crea otros usuarios de ejemplo (técnicos, operadores, etc.). Es idempotente. **Nunca lo uses en una instalación expuesta a internet sin cambiar o borrar esas cuentas.**

**Opción B — Producción real (sin datos demo)**

No corras `seed.py`. Crea solo el primer `super_usuario` y, desde la aplicación, ese usuario crea las empresas y sus administradores.

1. Genera el hash bcrypt de la contraseña (la app nunca guarda texto plano):
   ```powershell
   cd backend
   $env:PYTHONPATH = "src"
   uv run python -c "from barb.core.security import hash_password; print(hash_password('TU_CLAVE_SEGURA'))"
   ```
2. Inserta el usuario en la base (por `psql` o el SQL editor de tu proveedor). Pega el hash completo, que empieza con `$2b$`:
   ```sql
   INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
   VALUES (NULL, 'Super Usuario', 'tu-correo@empresa.com', '<HASH_AQUI>', 'super_usuario');
   ```
   `empresa_id` va en `NULL`: solo el rol `super_usuario` puede no pertenecer a una empresa (lo exige un `CHECK` de la migración `0004`).
3. Entra a la aplicación con ese usuario y crea las empresas y los administradores de cada una desde la gestión de empresas y usuarios.

**Cambiar o borrar usuarios demo en una base que ya tiene el seed**

Cambiar una contraseña:
```sql
UPDATE usuario SET password_hash = '<HASH_NUEVO>' WHERE lower(email) = 'super@barb.com';
```
Para borrar los usuarios demo conviene hacerlo desde la aplicación o revisando antes las referencias (órdenes de trabajo, documentos y sesiones apuntan a `usuario`); un `DELETE` directo puede fallar por claves foráneas.

### 9.5 Qué NO se migra

- **Datos de Supabase**: la base nueva empieza vacía. Si necesitas llevar datos, usa `pg_dump` / `pg_restore` de las tablas de datos, con el esquema ya creado por Alembic.
- **Fotos de OT**: viven en disco, no en la base. Hay que copiarlas al nuevo `UPLOAD_DIR`.
- **Variables de entorno y secretos**: se configuran de nuevo en la plataforma destino. Nunca los copies a archivos del repo.

## Referencias

- Render: <https://render.com/docs/blueprint-spec> · monorepos: <https://render.com/docs/monorepo-support>
- Cloudflare Pages Angular: <https://developers.cloudflare.com/pages/framework-guides/deploy-an-angular-site/>
- Supabase connections: <https://supabase.com/docs/guides/database/connecting-to-postgres>
