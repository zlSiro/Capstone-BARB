from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from barb.core.config import settings

logger = logging.getLogger("barb.db")

pool = AsyncConnectionPool(
    conninfo=settings.database_url,
    min_size=1,
    max_size=10,
    # prepare_threshold=None: el pooler de Supabase (modo transaction, :6543) no soporta prepared statements.
    kwargs={"row_factory": dict_row, "prepare_threshold": None},
    open=False,
)


# Usuario autenticado de la request en curso. Los triggers de `transacciones` lo leen de la
# variable de sesión `app.usuario_id` para saber quién ejecutó cada INSERT/UPDATE/DELETE.
actor_usuario_id: ContextVar[int | None] = ContextVar("actor_usuario_id", default=None)


async def _bind_actor(cur: Any) -> None:
    uid = actor_usuario_id.get()
    if uid is not None:
        # is_local=true: vale solo para la transacción actual, así no se filtra a otra request vía el pool.
        await cur.execute("SELECT set_config('app.usuario_id', %(uid)s, true)", {"uid": str(uid)})


def _escribe(sql: str) -> bool:
    return not sql.lstrip().upper().startswith("SELECT")


async def open_pool() -> None:
    await pool.open(wait=True)


async def close_pool() -> None:
    await pool.close()


async def fetch_all(sql: str, params: dict[str, Any] | None = None) -> list[dict]:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if _escribe(sql):
                await _bind_actor(cur)
            await cur.execute(sql, params or {})
            rows = await cur.fetchall()
            return list(rows)


async def fetch_one(sql: str, params: dict[str, Any] | None = None) -> dict | None:
    rows = await fetch_all(sql, params)
    return rows[0] if rows else None


async def execute(sql: str, params: dict[str, Any] | None = None) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await _bind_actor(cur)
            await cur.execute(sql, params or {})


@asynccontextmanager
async def transaction() -> AsyncIterator[Any]:
    """Yields a psycopg async cursor inside a committed/rolled-back transaction."""
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await _bind_actor(cur)
                yield cur
