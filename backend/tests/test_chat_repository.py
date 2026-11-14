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
        primer_mensaje="Este es un mensaje de prueba muy largo que debería truncarse a 48 caracteres o menos para el título",
    )
    cleanup_sessions.append(sid)

    row = await fetch_one(
        "SELECT titulo FROM chat_session WHERE session_id = %(sid)s",
        {"sid": sid},
    )
    assert row is not None
    titulo = row["titulo"]
    assert len(titulo) <= 48
    assert "Este es un mensaje" in titulo
    assert not titulo.endswith("…")
    # Se corta en palabra completa, no a mitad de una.
    assert not titulo.endswith(" ")
    palabras = "Este es un mensaje de prueba muy largo que debería truncarse a 48 caracteres o menos para el título"
    assert titulo.split()[-1] in palabras.split()


@pytest.mark.asyncio
async def test_create_session_guarda_equipo_y_titulo_segmentado(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje=(
            "Necesito saber por qué la bomba PUMP-E4 está vibrando demasiado "
            "y qué debo revisar primero"
        ),
    )
    cleanup_sessions.append(sid)

    row = await fetch_one(
        """
        SELECT titulo, machine_name, plant_name, discipline
        FROM chat_session WHERE session_id = %(sid)s
        """,
        {"sid": sid},
    )
    assert row is not None
    assert row["titulo"] == "PUMP-E4 — vibrando demasiado"
    assert row["machine_name"] == "Bomba de pulpa KSB"
    assert row["plant_name"] == "Planta de Vapor"
    assert row["discipline"] == "Hidráulica"


@pytest.mark.asyncio
async def test_create_session_sin_maquina_no_guarda_equipo(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="¿Cuál es el torque recomendado para los pernos del chancador?",
    )
    cleanup_sessions.append(sid)

    row = await fetch_one(
        """
        SELECT titulo, machine_name, plant_name, discipline
        FROM chat_session WHERE session_id = %(sid)s
        """,
        {"sid": sid},
    )
    assert row is not None
    assert row["machine_name"] is None
    assert row["plant_name"] is None
    assert row["discipline"] is None
    assert not row["titulo"].endswith("…")


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
# _make_titulo (sin BD)
# =============================================================================

def test_make_titulo_usa_codigo_y_problema():
    maquina = {"nombre": "Bomba de pulpa KSB", "codigo": "PUMP-E4"}
    titulo = chat_repository._make_titulo(
        "Necesito saber por qué la bomba PUMP-E4 está vibrando demasiado "
        "y qué debo revisar primero",
        maquina,
    )
    assert titulo == "PUMP-E4 — vibrando demasiado"


def test_make_titulo_sin_maquina_corta_en_palabra_y_sin_elipsis():
    titulo = chat_repository._make_titulo(
        "Este es un mensaje de prueba muy largo que debería truncarse a 48 "
        "caracteres o menos para el título"
    )
    assert len(titulo) <= 48
    assert not titulo.endswith("…")
    assert titulo.startswith("Este es un mensaje")


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