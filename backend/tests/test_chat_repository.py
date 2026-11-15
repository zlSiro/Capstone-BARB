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
            "Necesito saber por qué la bomba BOM-001 está vibrando demasiado "
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
    assert row["titulo"] == "BOM-001 — vibrando demasiado"
    assert row["machine_name"] == "Bomba de pulpa KSB"
    assert row["plant_name"] == "Molienda SAG"
    assert row["discipline"] == "Mecánica"


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
    maquina = {"nombre": "Bomba de pulpa KSB", "codigo": "BOM-001"}
    titulo = chat_repository._make_titulo(
        "Necesito saber por qué la bomba BOM-001 está vibrando demasiado "
        "y qué debo revisar primero",
        maquina,
    )
    assert titulo == "BOM-001 — vibrando demasiado"


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

# =============================================================================
# HU-23: máquina vinculada a la sesión
# =============================================================================

async def _maquina_dict(empresa_id: int, codigo: str | None = None, excluir: int | None = None) -> dict:
    row = await fetch_one(
        """
        SELECT m.maquina_id, m.nombre, m.codigo, p.nombre AS planta, d.nombre AS disciplina
          FROM maquina m
          JOIN planta p ON p.planta_id = m.planta_id
          LEFT JOIN disciplina d ON d.disciplina_id = m.disciplina_id
         WHERE p.empresa_id = %(e)s
           AND (%(codigo)s::text IS NULL OR m.codigo = %(codigo)s)
           AND (%(excluir)s::int IS NULL OR m.maquina_id <> %(excluir)s)
         ORDER BY m.maquina_id LIMIT 1
        """,
        {"e": empresa_id, "codigo": codigo, "excluir": excluir},
    )
    assert row is not None
    return row


async def _fila_sesion(sid: str) -> dict:
    return await fetch_one(
        "SELECT maquina_id, machine_name, plant_name, discipline FROM chat_session WHERE session_id = %(sid)s",
        {"sid": sid},
    )


@pytest.mark.asyncio
async def test_create_session_con_maquina_explicita_fija_maquina_id_y_snapshot(cleanup_sessions, seeded_ids):
    maquina = await _maquina_dict(seeded_ids["empresa_id"])
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="¿cuál es el torque?",
        maquina=maquina,
    )
    cleanup_sessions.append(sid)

    row = await _fila_sesion(sid)
    assert row["maquina_id"] == maquina["maquina_id"]
    assert row["machine_name"] == maquina["nombre"]
    assert row["plant_name"] == maquina["planta"]
    assert row["discipline"] == maquina["disciplina"]


@pytest.mark.asyncio
async def test_maquina_explicita_tiene_prioridad_sobre_identificar_maquina(cleanup_sessions, seeded_ids):
    # El mensaje nombra BOM-001, pero el usuario eligió otra máquina.
    elegida = await _maquina_dict(seeded_ids["empresa_id"], excluir=(await _maquina_dict(1, "BOM-001"))["maquina_id"])
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="la bomba BOM-001 está vibrando",
        maquina=elegida,
    )
    cleanup_sessions.append(sid)

    row = await _fila_sesion(sid)
    assert row["maquina_id"] == elegida["maquina_id"]
    assert row["machine_name"] == elegida["nombre"]


@pytest.mark.asyncio
async def test_maquina_detectada_por_texto_no_vincula_la_sesion(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"],
        empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="la bomba BOM-001 está vibrando demasiado",
    )
    cleanup_sessions.append(sid)

    row = await _fila_sesion(sid)
    assert row["machine_name"] == "Bomba de pulpa KSB"  # snapshot del historial
    assert row["maquina_id"] is None  # sin vínculo explícito


@pytest.mark.asyncio
async def test_set_maquina_cambia_y_desvincula(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"], empresa_id=seeded_ids["empresa_id"], primer_mensaje="hola"
    )
    cleanup_sessions.append(sid)
    m1 = await _maquina_dict(seeded_ids["empresa_id"])
    m2 = await _maquina_dict(seeded_ids["empresa_id"], excluir=m1["maquina_id"])

    assert await chat_repository.set_maquina(sid, seeded_ids["usuario_id"], m1) is True
    assert (await _fila_sesion(sid))["maquina_id"] == m1["maquina_id"]

    assert await chat_repository.set_maquina(sid, seeded_ids["usuario_id"], m2) is True
    row = await _fila_sesion(sid)
    assert row["maquina_id"] == m2["maquina_id"] and row["machine_name"] == m2["nombre"]
    assert row["plant_name"] == m2["planta"] and row["discipline"] == m2["disciplina"]

    assert await chat_repository.set_maquina(sid, seeded_ids["usuario_id"], None) is True
    row = await _fila_sesion(sid)
    assert row == {"maquina_id": None, "machine_name": None, "plant_name": None, "discipline": None}


@pytest.mark.asyncio
async def test_set_maquina_respeta_aislamiento_por_usuario(cleanup_sessions, seeded_ids):
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"], empresa_id=seeded_ids["empresa_id"], primer_mensaje="privada"
    )
    cleanup_sessions.append(sid)
    maquina = await _maquina_dict(seeded_ids["empresa_id"])

    assert await chat_repository.set_maquina(sid, seeded_ids["otro_usuario_id"], maquina) is False
    assert (await _fila_sesion(sid))["maquina_id"] is None


@pytest.mark.asyncio
async def test_get_session_devuelve_maquina_id_y_machine_name(cleanup_sessions, seeded_ids):
    maquina = await _maquina_dict(seeded_ids["empresa_id"])
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"], empresa_id=seeded_ids["empresa_id"],
        primer_mensaje="hola", maquina=maquina,
    )
    cleanup_sessions.append(sid)

    s = await chat_repository.get_session(sid, seeded_ids["usuario_id"])
    assert s["maquina_id"] == maquina["maquina_id"]
    assert s["machine_name"] == maquina["nombre"]


@pytest.mark.asyncio
async def test_borrar_maquina_deja_la_sesion_con_snapshot_y_sin_vinculo(cleanup_sessions, seeded_ids):
    """ON DELETE SET NULL: `machine_name` conserva el nombre en el Historial."""
    from barb.core.db import transaction

    empresa = seeded_ids["empresa_id"]
    planta = await fetch_one("SELECT planta_id FROM planta WHERE empresa_id = %(e)s LIMIT 1", {"e": empresa})
    async with transaction() as cur:
        await cur.execute(
            "INSERT INTO maquina (planta_id, nombre, codigo) VALUES (%(p)s, 'Temporal HU23', 'TMP-HU23') RETURNING maquina_id",
            {"p": planta["planta_id"]},
        )
        mid = (await cur.fetchone())["maquina_id"]
    sid = await chat_repository.create_session(
        usuario_id=seeded_ids["usuario_id"], empresa_id=empresa, primer_mensaje="hola",
        maquina={"maquina_id": mid, "nombre": "Temporal HU23", "codigo": "TMP-HU23", "planta": "P", "disciplina": None},
    )
    cleanup_sessions.append(sid)

    await execute("DELETE FROM maquina WHERE maquina_id = %(m)s", {"m": mid})

    row = await _fila_sesion(sid)
    assert row["maquina_id"] is None
    assert row["machine_name"] == "Temporal HU23"


@pytest.mark.asyncio
async def test_get_maquina_de_empresa_solo_devuelve_maquinas_de_la_empresa(seeded_ids):
    propia = await _maquina_dict(1)
    ajena = await _maquina_dict(2)

    ficha = await chat_repository.get_maquina_de_empresa(propia["maquina_id"], 1)
    assert ficha["nombre"] == propia["nombre"] and ficha["planta"] == propia["planta"]
    assert set(ficha) == {"maquina_id", "nombre", "codigo", "planta", "disciplina"}

    assert await chat_repository.get_maquina_de_empresa(ajena["maquina_id"], 1) is None
    assert await chat_repository.get_maquina_de_empresa(2_000_000_000, 1) is None
