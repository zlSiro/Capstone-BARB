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
- **Sin pre-deploy command en free.** Las migraciones Alembic se corren desde tu PC (sección 2).
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
uv run alembic upgrade head
uv run python scripts/seed.py      # admin@barb.com / admin123 + datos demo (idempotente)
```

(En Git Bash: `export DATABASE_URL="..."`.) La variable de entorno tiene prioridad sobre `.env`, así no tocas tu config local.

> Cambia la password del admin `admin123` después de sembrar si la URL será pública.

### 2.3 Verificar

Supabase → **Table Editor**: deben aparecer tablas (`sesion`, usuarios, OT, etc.).

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
| `CORS_ORIGINS` | `https://<tu-proyecto>.pages.dev` (URL exacta del front, sin `/` final) |
| `CORS_ORIGIN_REGEX` | `https://([a-z0-9-]+\.)?barb[a-z0-9-]*\.pages\.dev` (cubre previews; ajusta si tu proyecto Pages no empieza con `barb`) |
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

3. **Environment variables** (Production y Preview): `NODE_VERSION` = `22`. (También existe `frontend/.node-version`.)
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

## 7. Checklist final

- [ ] Password Supabase rotado
- [ ] Migraciones + seed aplicados en Supabase
- [ ] `/health` en Render = `online`
- [ ] `environment.prod.ts` con URL real de Render
- [ ] `CORS_ORIGINS`/`CORS_ORIGIN_REGEX` con dominio `pages.dev`
- [ ] Login en la URL `pages.dev` funciona
- [ ] Chat IA responde (streaming)
- [ ] Cambiada password admin demo

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
| Build Pages falla por versión de Node | `NODE_VERSION=22` en variables de entorno. |
| Recargar ruta Angular da 404 | Hay un `404.html` en output; elimínalo. |
| Fotos de OT desaparecen | Disco efímero de Render. Migrar a Supabase Storage o plan con disco persistente. |
| Chat IA falla | Falta `NVIDIA_API_KEY` en Render. Ojo: `/api/health/llm` solo revisa `DEEPSEEK_API_KEY` y reportará `degraded` aunque nvidia funcione. |

## Referencias

- Render: <https://render.com/docs/blueprint-spec> · monorepos: <https://render.com/docs/monorepo-support>
- Cloudflare Pages Angular: <https://developers.cloudflare.com/pages/framework-guides/deploy-an-angular-site/>
- Supabase connections: <https://supabase.com/docs/guides/database/connecting-to-postgres>
