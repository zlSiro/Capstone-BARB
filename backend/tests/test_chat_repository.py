from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from barb.core.db import execute, fetch_one
from barb.services import chat_repository


# =============================================================================
# Fixtures
# =============================================================================

@pytest_asyncio.fixture
async def cleanup_sessions(db_pool):
    
    created: list[str] = []
    yield created
    for sid in created:
        try:
            await execute(
                "DELETE FROM chat_session WHERE session_id = %(sid)s",
                {"sid": sid},
            )
        except Exception:
            pass


@pytest_asyncio.fixture
async def seeded_ids(db_pool):
    return {"usuario_id": 1, "empresa_id": 1, "otro_usuario_id": 4}


# =============================================================================
# create_session
# =============================================================================

@pytest.mark.asyncio
async def test_create_session_devuelve_uuid_valido(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Prueba de creación",
    )
    cleanup_sessions.append(sid)

    parsed = uuid.UUID(sid)
    assert str(parsed) == sid

    row = await fetch_one(
        "SELECT titulo FROM chat_session WHERE session_id = %(sid)s",
        {"sid": sid},
    )
    assert row is not None


@pytest.mark.asyncio
async def test_create_session_autogenera_titulo(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Este es un mensaje de prueba muy largo que debería truncarse a 60 caracteres o menos para el título",
    )
    cleanup_sessions.append(sid)

    row = await fetch_one(
        "SELECT titulo FROM chat_session WHERE session_id = %(sid)s",
        {"sid": sid},
    )
    assert row is not None
    titulo = row["titulo"]
    assert len(titulo) <= 61  # 60 + "…"
    assert "Este es un mensaje" in titulo
    assert titulo.endswith("…")


@pytest.mark.asyncio
async def test_create_session_titulo_fallback(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="   ",
    )
    cleanup_sessions.append(sid)

    row = await fetch_one(
        "SELECT titulo FROM chat_session WHERE session_id = %(sid)s",
        {"sid": sid},
    )
    assert row["titulo"] == "Conversación sin título"


# =============================================================================
# get_session / aislamiento
# =============================================================================

@pytest.mark.asyncio
async def test_get_session_respeta_aislamiento(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Privada del admin",
    )
    cleanup_sessions.append(sid)

    ok = await chat_repository.get_session(sid, seeded_ids["usuario_id"])
    assert ok is not None

    otro = await chat_repository.get_session(sid, seeded_ids["otro_usuario_id"])
    assert otro is None


# =============================================================================
# load_messages
# =============================================================================

@pytest.mark.asyncio
async def test_load_messages_vacio(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Vacía",
    )
    cleanup_sessions.append(sid)

    msgs = await chat_repository.load_messages(sid, seeded_ids["usuario_id"])
    assert msgs == []


@pytest.mark.asyncio
async def test_load_messages_devuelve_orden(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Con mensajes",
    )
    cleanup_sessions.append(sid)

    await chat_repository.append_messages(
        sid,
        seeded_ids["usuario_id"],
        [
            {"role": "user", "content": "primero", "timestamp": 1},
            {"role": "assistant", "content": "segundo", "timestamp": 2},
        ],
    )

    msgs = await chat_repository.load_messages(sid, seeded_ids["usuario_id"])
    assert len(msgs) == 2
    assert msgs[0]["content"] == "primero"
    assert msgs[1]["content"] == "segundo"


# =============================================================================
# append_messages
# =============================================================================

@pytest.mark.asyncio
async def test_append_messages_acumula(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Chat",
    )
    cleanup_sessions.append(sid)

    await chat_repository.append_messages(
        sid,
        seeded_ids["usuario_id"],
        [
            {"role": "user", "content": "hola", "timestamp": 1},
            {"role": "assistant", "content": "qué tal", "timestamp": 2},
        ],
    )
    await chat_repository.append_messages(
        sid,
        seeded_ids["usuario_id"],
        [
            {"role": "user", "content": "bien", "timestamp": 3},
            {"role": "assistant", "content": "me alegro", "timestamp": 4},
        ],
    )

    msgs = await chat_repository.load_messages(sid, seeded_ids["usuario_id"])
    assert len(msgs) == 4
    assert [m["content"] for m in msgs] == ["hola", "qué tal", "bien", "me alegro"]


@pytest.mark.asyncio
async def test_append_messages_usuario_incorrecto_no_op(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Chat",
    )
    cleanup_sessions.append(sid)

    ok = await chat_repository.append_messages(
        sid,
        seeded_ids["otro_usuario_id"],
        [{"role": "user", "content": "intruso", "timestamp": 1}],
    )
    assert ok is False

    msgs = await chat_repository.load_messages(sid, seeded_ids["usuario_id"])
    assert msgs == []


# =============================================================================
# list_by_user
# =============================================================================

@pytest.mark.asyncio
async def test_list_by_user_ordena_y_filtra(cleanup_sessions, seeded_ids):

    sids = []
    for i in range(3):
        sid = await chat_repository.create_session(
            usuario_id=seeded_ids["usuario_id"],
            empresa_id=seeded_ids["empresa_id"],
            primer_mensaje=f"Sesión {i}",
        )
        cleanup_sessions.append(sid)
        sids.append(sid)

    sesiones = await chat_repository.list_by_user(
        usuario_id=seeded_ids["usuario_id"],
        limit=50,
    )

    ids_devueltos = {str(s["session_id"]) for s in sesiones}
    for sid in sids:
        assert sid in ids_devueltos

    nuestras = [s for s in sesiones if str(s["session_id"]) in sids]
    assert len(nuestras) == 3


@pytest.mark.asyncio
async def test_list_by_user_no_devuelve_otras_sesiones(cleanup_sessions, seeded_ids):
  
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Del admin",
    )
    cleanup_sessions.append(sid)

    sesiones = await chat_repository.list_by_user(
        usuario_id=seeded_ids["otro_usuario_id"],
        limit=50,
    )
    ids = {str(s["session_id"]) for s in sesiones}
    assert sid not in ids


# =============================================================================
# delete_session
# =============================================================================

@pytest.mark.asyncio
async def test_delete_session_borra_y_reporta(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="Para borrar",
    )
    cleanup_sessions.append(sid)  

    ok = await chat_repository.delete_session(sid, seeded_ids["usuario_id"])
    assert ok is True

    ok = await chat_repository.delete_session(sid, seeded_ids["usuario_id"])
    assert ok is False


@pytest.mark.asyncio
async def test_delete_session_respeta_aislamiento(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="No borrable por otros",
    )
    cleanup_sessions.append(sid)

    ok = await chat_repository.delete_session(sid, seeded_ids["otro_usuario_id"])
    assert ok is False

    row = await fetch_one(
        "SELECT session_id FROM chat_session WHERE session_id = %(sid)s",
        {"sid": sid},
    )
    assert row is not None