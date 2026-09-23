
## Stack

- Python 3.12, gestionado con `uv` (`.python-version`, `uv.lock`)
- FastAPI + Uvicorn
- psycopg3 async + `psycopg_pool.AsyncConnectionPool` (sin SQLAlchemy en runtime)
- Alembic (usa SQLAlchemy solo como dependencia de desarrollo, para migraciones)
- redis.asyncio (cache opcional, tolerante a fallos)
- pydantic-settings para configuración

## Instalar uv

`uv` maneja la versión de Python (3.12) y el venv — no hace falta instalar
Python manualmente ni crear el venv a mano.

**Windows** (PowerShell):
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**Linux / macOS**:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Alternativa multiplataforma si ya tenés `pipx` o `pip`:
```bash
pipx install uv
# o
pip install uv
```

Cerrá y reabrí la terminal (o `source $HOME/.local/bin/env` en Linux/macOS)
y verificá con `uv --version`.

## Setup

```bash
git clone <url-del-repo>
cd backend

uv python install 3.12   # descarga Python 3.12 si no está (uv lo gestiona, no el sistema)
uv sync                  # crea .venv/ e instala todas las deps con las versiones exactas de uv.lock

cp .env.example .env     # ajustar DATABASE_URL / REDIS_URL si aplica
```

No hace falta activar el venv a mano ni correr `python -m venv`: cualquier
comando se ejecuta con `uv run <comando>` y uv resuelve automáticamente el
`.venv/` del proyecto (creándolo si no existe).

## Base de datos

Postgres vía Docker (`postgres:17-alpine`, última versión estable):

```bash
docker compose up -d db
```

Credenciales por defecto (coinciden con `.env.example`): `barb_admin` /
`barb_password123` / DB `barb_database`, puerto `5432`. Override vía
variables `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` (`.env` en
esta carpeta) si se necesita otra config.

```bash
uv run alembic upgrade head  # crea schema (enums + tablas + índices)
uv run python scripts/seed.py  # datos demo + admin (admin@barb.com / admin123)
```

Idempotente: si `usuario` ya tiene filas, el seed no reinserta nada (solo
verifica el admin y hashea contraseñas pendientes).

## Correr el servidor

```bash
uv run fastapi dev src/barb/main.py --port 9000
# o
uv run uvicorn barb.main:app --app-dir src --port 9000 --reload
```

## Tests / lint

```bash
uv run pytest
uv run ruff check
```

## Diferencias vs. `backend/` (bugs corregidos)

- Conexiones del pool se liberan siempre (`putconn`), nunca se cierran a mano
  (el backend viejo hacía `conn.close()` en `users.py`/`work_orders.py`, lo
  que agotaba el pool tras ~10 escrituras).
- Sin `@lru_cache` en endpoints de catálogo (congelaba disciplinas/técnicos
  hasta el próximo reinicio del proceso).
- Dependencias de permisos son `async` de verdad (no bloquean el event loop
  con I/O de DB síncrono).
- `create_user` ahora setea `empresa_id` (el original no lo hacía y violaba
  el `NOT NULL` de la columna).
- `datetime.now(UTC)` en vez de `datetime.utcnow()` (deprecado en 3.12).
- Sin `CREATE TABLE IF NOT EXISTS` disperso en handlers — todo el schema
  vive en migraciones de Alembic.

## Quickstart (resumen, de cero a servidor corriendo)

```bash
# 1. uv (una vez por máquina) — ver "Instalar uv" arriba
curl -LsSf https://astral.sh/uv/install.sh | sh        # Linux/macOS
# powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"   # Windows

# 2. clonar y entrar
git clone <url-del-repo>
cd backend

# 3. Python 3.12 + deps
uv python install 3.12
uv sync

# 4. config
cp .env.example .env

# 5. Postgres (requiere Docker Desktop corriendo)
docker compose up -d db

# 6. schema + datos demo
uv run alembic upgrade head
uv run python scripts/seed.py

# 7. levantar API
uv run fastapi dev src/barb/main.py --port 9000
```

Login demo: `admin@barb.com` / `admin123`.

## Compatibilidad con el frontend actual

Mismas rutas, mismos alias (`/api/work-orders` + `/api/work_orders`,
`/auth/login` + `/api/auth/login`, etc.) y mismos shapes de respuesta JSON
que `backend/`. El frontend (`npm run dev`, proxy `/api` → `localhost:9000`)
no requiere cambios para apuntar a este backend.
