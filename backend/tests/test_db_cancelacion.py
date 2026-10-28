"""Regresión: una cancelación no puede dejar una conexión sucia en el pool.

Bug original (reporte del usuario): al abortar un stream SSE, la cancelación llegaba con
una query en vuelo y psycopg devolvía al pool una conexión en estado ACTIVE:

    WARNING:psycopg:error ignored in rollback ...: another command is already in progress
    WARNING:psycopg.pool:closing returned connection: <AsyncConnection [ACTIVE]>
    WARNING:psycopg.pool:discarding closed connection: <AsyncConnection [BAD]>

Efecto: se perdía una conexión del pool en cada desconexión y la escritura del turno
quedaba a medias.

Reproducción: se lanza una consulta lenta (`pg_sleep`), se cancela la tarea a mitad y se
comprueba que (a) no aparece el aviso de psycopg y (b) el pool sigue sirviendo.
"""

from __future__ import annotations

import asyncio
import logging

import pytest

from barb.core import db


@pytest.mark.asyncio
async def test_cancelar_una_consulta_no_deja_la_conexion_sucia(db_pool, caplog):
    """
    La cancelación del llamador no debe interrumpir la query a media ejecución.

    Con el código anterior este test fallaba: la conexión volvía ACTIVE y el pool la
    descartaba (los tres WARNING de arriba aparecían en el log).
    """
    caplog.set_level(logging.WARNING)

    tarea = asyncio.create_task(db.fetch_all("SELECT pg_sleep(0.4) AS espera"))
    await asyncio.sleep(0.05)  # la query ya está en vuelo
    tarea.cancel()

    with pytest.raises(asyncio.CancelledError):
        await tarea

    # La consulta interna sigue su curso y libera la conexión; hay que darle tiempo.
    await asyncio.sleep(0.8)

    avisos = [r.message for r in caplog.records if "psycopg" in r.name or "psycopg" in str(r.msg)]
    assert not any("another command is already in progress" in str(a) for a in avisos), (
        f"la conexión quedó sucia: {avisos}"
    )
    assert not any("[ACTIVE]" in str(a) or "[BAD]" in str(a) for a in avisos), (
        f"el pool devolvió/descartó una conexión sucia: {avisos}"
    )

    # El pool tiene que seguir funcionando después del corte.
    fila = await db.fetch_one("SELECT 1 AS uno")
    assert fila == {"uno": 1}


@pytest.mark.asyncio
async def test_cancelar_no_pierde_la_escritura_en_vuelo(db_pool):
    """
    La escritura que se estaba ejecutando se completa igual: es el turno del usuario.

    Sin esto, cerrar la pestaña a mitad de la respuesta perdía el mensaje.
    """
    creada = await db.fetch_one(
        """
        INSERT INTO chat_session (usuario_id, empresa_id, titulo, messages)
        VALUES (1, 1, 'prueba de cancelacion', '[]'::jsonb)
        RETURNING session_id
        """
    )
    sid = str(creada["session_id"])

    async def escribir() -> None:
        await db.fetch_one(
            """
            UPDATE chat_session
               SET messages = %(m)s::jsonb
             WHERE session_id = %(sid)s
            RETURNING session_id
            """,
            {"m": '[{"role": "user", "content": "me fui"}]', "sid": sid},
        )

    tarea = asyncio.create_task(escribir())
    await asyncio.sleep(0)  # deja que arranque
    tarea.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tarea

    await asyncio.sleep(0.3)

    guardado = await db.fetch_one(
        "SELECT messages FROM chat_session WHERE session_id = %(sid)s", {"sid": sid}
    )
    assert guardado is not None
    assert "me fui" in str(guardado["messages"])

    await db.execute("DELETE FROM chat_session WHERE session_id = %(sid)s", {"sid": sid})
