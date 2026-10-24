from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Coroutine
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any, TypeVar

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from barb.core.config import settings

logger = logging.getLogger("barb.db")

T = TypeVar("T")

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


async def _a_salvo_de_la_cancelacion(coro: Coroutine[Any, Any, T]) -> T:
    """
    Espera `coro` sin que una cancelación de la request lo interrumpa a media query.

    El problema que resuelve: cuando el cliente corta un stream SSE, Starlette cancela la
    tarea que lo estaba sirviendo. Si la cancelación llega con una query en vuelo, psycopg
    devuelve al pool una conexión en estado ACTIVE y el pool la descarta con «another
    command is already in progress»: se pierde una conexión del pool y la escritura queda
    a medias. Reproducido abortando el cliente a mitad del `finally` que persiste el chat.

    Envolver la operación en su propia tarea y esperarla con `shield` deja que termine y
    devuelva la conexión limpia; la cancelación se propaga igual al llamador, así que el
    stream se corta como corresponde. La tarea interna hereda el contexto de la request
    (incluido `actor_usuario_id`), porque `create_task` copia los contextvars.
    """
    tarea: asyncio.Task[T] = asyncio.create_task(coro)
    try:
        return await asyncio.shield(tarea)
    except asyncio.CancelledError:
        # No se cancela la tarea interna a propósito: terminará sola y liberará la
        # conexión. Solo se avisa si además falla, para no perder el error.
        def _reportar(t: asyncio.Task[T]) -> None:
            if not t.cancelled() and t.exception() is not None:
                logger.warning("Consulta interrumpida por la request: %s", t.exception())

        tarea.add_done_callback(_reportar)
        raise


async def fetch_all(sql: str, params: dict[str, Any] | None = None) -> list[dict]:
    async def _consulta() -> list[dict]:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                if _escribe(sql):
                    await _bind_actor(cur)
                await cur.execute(sql, params or {})
                rows = await cur.fetchall()
                return list(rows)

    return await _a_salvo_de_la_cancelacion(_consulta())


async def fetch_one(sql: str, params: dict[str, Any] | None = None) -> dict | None:
    rows = await fetch_all(sql, params)
    return rows[0] if rows else None


async def execute(sql: str, params: dict[str, Any] | None = None) -> None:
    async def _comando() -> None:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await _bind_actor(cur)
                await cur.execute(sql, params or {})

    await _a_salvo_de_la_cancelacion(_comando())


@asynccontextmanager
async def transaction() -> AsyncIterator[Any]:
    """Yields a psycopg async cursor inside a committed/rolled-back transaction."""
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await _bind_actor(cur)
                yield cur
