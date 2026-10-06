from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
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


async def open_pool() -> None:
    await pool.open(wait=True)


async def close_pool() -> None:
    await pool.close()


async def fetch_all(sql: str, params: dict[str, Any] | None = None) -> list[dict]:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params or {})
            rows = await cur.fetchall()
            return list(rows)


async def fetch_one(sql: str, params: dict[str, Any] | None = None) -> dict | None:
    rows = await fetch_all(sql, params)
    return rows[0] if rows else None


async def execute(sql: str, params: dict[str, Any] | None = None) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params or {})


@asynccontextmanager
async def transaction() -> AsyncIterator[Any]:
    """Yields a psycopg async cursor inside a committed/rolled-back transaction."""
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                yield cur
