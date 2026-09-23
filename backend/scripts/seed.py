"""Seed inicial de la base de datos BARB.

Idempotente: si la tabla `usuario` ya tiene filas, no hace nada. Pensado
para correr después de `alembic upgrade head`:

    uv run python scripts/seed.py

Reemplaza la seed que el backend anterior hacía en el startup de
FastAPI (`backend/main.py`) ejecutando `initScripts/01_tablas.sql` completo
cada vez que faltaba la tabla `usuario`.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from barb.core.db import close_pool, open_pool, pool  # noqa: E402
from barb.core.security import hash_password  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("barb.seed")

SEED_SQL_PATH = Path(__file__).resolve().parent.parent / "seeds" / "seed_data.sql"

DEFAULT_ADMIN_EMAIL = "admin@barb.com"
DEFAULT_ADMIN_PASSWORD = "admin123"
DEFAULT_ADMIN_NOMBRE = "Admin BARB"


async def _usuario_count(conn) -> int:
    async with conn.cursor() as cur:
        await cur.execute("SELECT COUNT(*) AS total FROM usuario")
        row = await cur.fetchone()
        return int(row["total"])


async def _run_seed_sql(conn) -> None:
    sql_script = SEED_SQL_PATH.read_text(encoding="utf-8")
    async with conn.cursor() as cur:
        await cur.execute(sql_script)
    logger.info("Datos semilla insertados desde %s", SEED_SQL_PATH.name)


async def _ensure_default_admin(conn) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT usuario_id FROM usuario WHERE lower(email) = lower(%(email)s) LIMIT 1",
            {"email": DEFAULT_ADMIN_EMAIL},
        )
        existing = await cur.fetchone()
        if existing:
            return

        await cur.execute("SELECT empresa_id FROM empresa ORDER BY empresa_id LIMIT 1")
        empresa = await cur.fetchone()
        empresa_id = empresa["empresa_id"] if empresa else None
        if empresa_id is None:
            await cur.execute(
                "INSERT INTO empresa (nombre) VALUES (%(nombre)s) RETURNING empresa_id",
                {"nombre": "Planta Demo BARB"},
            )
            empresa_id = (await cur.fetchone())["empresa_id"]

        await cur.execute(
            """
            INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
            VALUES (%(empresa_id)s, %(nombre)s, %(email)s, %(password_hash)s, 'admin')
            """,
            {
                "empresa_id": empresa_id,
                "nombre": DEFAULT_ADMIN_NOMBRE,
                "email": DEFAULT_ADMIN_EMAIL,
                "password_hash": hash_password(DEFAULT_ADMIN_PASSWORD),
            },
        )
    logger.info("Usuario administrador por defecto creado (%s).", DEFAULT_ADMIN_EMAIL)


async def _ensure_passwords_hashed(conn) -> int:
    async with conn.cursor() as cur:
        await cur.execute("SELECT usuario_id, password_hash FROM usuario")
        usuarios = await cur.fetchall()
        actualizados = 0
        for u in usuarios:
            stored = (u.get("password_hash") or "")
            if not stored.strip().startswith("$2"):
                hashed = hash_password(stored)
                await cur.execute(
                    "UPDATE usuario SET password_hash = %(hashed)s WHERE usuario_id = %(uid)s",
                    {"hashed": hashed, "uid": u["usuario_id"]},
                )
                actualizados += 1
    return actualizados


async def main() -> None:
    await open_pool()
    try:
        async with pool.connection() as conn:
            count = await _usuario_count(conn)
            if count == 0:
                if not SEED_SQL_PATH.exists():
                    logger.warning("No se encontró %s; solo se creará el admin por defecto.", SEED_SQL_PATH)
                else:
                    async with conn.transaction():
                        await _run_seed_sql(conn)

            async with conn.transaction():
                await _ensure_default_admin(conn)

            async with conn.transaction():
                actualizados = await _ensure_passwords_hashed(conn)
                if actualizados:
                    logger.info("%s contraseña(s) hasheadas.", actualizados)

        logger.info("Seed completo.")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
