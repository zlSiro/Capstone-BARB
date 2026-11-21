# Migraciones de base de datos: guía para el equipo

## Regla principal

**Solo JP aplica migraciones en la base de producción (Supabase).** Nadie más ejecuta `alembic upgrade`, `downgrade` ni scripts SQL contra Supabase.

Esto incluye no tener la `DATABASE_URL` de Supabase en el `.env` local ni en variables de entorno de tu terminal.

| Entorno | Quién migra | Cómo |
|---|---|---|
| Supabase (prod) | Solo JP | Desde su PC con Session pooler, **antes** de mergear el PR (ver `DEPLOY.md` §2.4) |
| Postgres local (Docker) | Cada integrante | `uv run alembic upgrade head` |

Cuando un PR trae una migración nueva, JP la aplica en Supabase y luego se mergea. Después de mergear a `main`, **cada uno actualiza su base local** (abajo).

---

## Flujo normal: actualizar tu base local

Después de hacer `git pull` en `main` (o de traer una rama con una migración nueva):

```bash
# 1. Postgres local encendido (desde la raíz del repo, Docker Desktop abierto)
docker compose up -d db

# 2. Aplicar migraciones pendientes
cd backend
uv sync
uv run alembic upgrade head
```

Verifica:

```bash
uv run alembic current    # versión en tu BD
uv run alembic heads      # última versión del código
```

Si `current` y `heads` muestran lo mismo (ej. `0011_sla_costo_maquina (head)`), estás al día.

> Tu `backend/.env` debe apuntar al Postgres local (`localhost`), nunca a Supabase. Revisa `DATABASE_URL` antes de migrar.

---

## Estoy varias versiones atrás (ej. en 0006)

Alembic aplica **todas las migraciones pendientes en orden** con un solo comando. No hay que ir una por una:

```bash
cd backend
uv sync
uv run alembic current          # ej: 0006_notificacion_config
uv run alembic upgrade head     # aplica 0007, 0008, 0009, 0010, 0011
uv run alembic current          # debe mostrar la última (head)
```

Si quieres ver qué va a aplicar antes de hacerlo:

```bash
uv run alembic history --indicate-current
```

Si prefieres avanzar de a una (para depurar un error):

```bash
uv run alembic upgrade +1       # sube una versión
```

o hasta una específica:

```bash
uv run alembic upgrade 0009_transacciones_triggers
```

### Si algo falla

- **`Can't locate revision ...`**: tu BD tiene una versión que tu código no conoce. Haz `git pull` para traer las migraciones que faltan.
- **Error de columna/tabla ya existe o no existe**: tu BD local quedó en un estado raro. Lo más simple es recrearla (borra solo tu BD **local**):

  ```bash
  # desde la raíz del repo
  docker compose down -v          # borra el volumen de Postgres LOCAL
  docker compose up -d db
  cd backend
  uv run alembic upgrade head
  uv run python scripts/seed.py   # vuelve a cargar datos demo
  ```

  `down -v` destruye los datos de tu Postgres de Docker. Nunca lo corras con una `DATABASE_URL` de Supabase.
- **Varios heads** (`Multiple head revisions`): avisa a JP; hay que hacer una migración de merge. No uses `upgrade heads` por tu cuenta salvo que JP lo indique.

### Después de migrar

Si la BD ya existía, vuelve a correr el seed (es idempotente):

```bash
uv run python scripts/seed.py
```

---

## Crear una migración nueva (cuando tu PR cambia el esquema)

1. Crea el archivo en `backend/migrations/versions/` con el siguiente número (`0012_...`) y `down_revision` apuntando al head actual (`uv run alembic heads`).
2. Prueba `upgrade head` y `downgrade -1` **en tu Postgres local**.
3. Mantén **un solo head**.
4. Prefiere migraciones aditivas (columnas/tablas nuevas, nullable o con default) para que el código viejo en Render no se rompa mientras se migra.
5. En el PR avisa a JP: "este PR trae migración 00XX". JP la aplica en Supabase **antes** de mergear.

---

## Resumen

- Prod (Supabase): solo JP.
- Local: `docker compose up -d db` y `uv run alembic upgrade head`, aunque estés 4 o 5 versiones atrás.
- Verifica con `alembic current` vs `alembic heads`.
- Nunca pongas credenciales de Supabase en tu `.env`.
