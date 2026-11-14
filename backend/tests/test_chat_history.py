# backend/tests/test_chat_history.py
"""
Tests de CGBIDA-254, 255, 256, 257:
- GET /api/chat/sessions           (listar)
- GET /api/chat/sessions/{id}      (ver historial)
- DELETE /api/chat/sessions/{id}   (eliminar)
- Validación de ownership (usuario no ve/borra sesiones ajenas)

Estrategia: mockea chat_repository. No toca la BD.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from barb.core.security import get_current_user
from barb.main import app


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def fake_user():
    return {
        "id": 1,
        "empresa_id": 1,
        "name": "Tester",
        "email": "t@barb.com",
        "role": "admin",
    }


@pytest.fixture
def override_auth(fake_user):
    app.dependency_overrides[get_current_user] = lambda: fake_user
    yield fake_user
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def mock_repo():
    with patch("barb.routers.chat.chat_repository.list_by_user") as m_list, \
         patch("barb.routers.chat.chat_repository.get_session") as m_get, \
         patch("barb.routers.chat.chat_repository.load_messages") as m_load, \
         patch("barb.routers.chat.chat_repository.delete_session") as m_del:
        m_list.return_value = []
        m_get.return_value = None
        m_load.return_value = []
        m_del.return_value = False
        yield {
            "list_by_user": m_list,
            "get_session": m_get,
            "load_messages": m_load,
            "delete_session": m_del,
        }


@pytest.fixture
def fake_session_row():
    return {
        "session_id": "11111111-1111-1111-1111-111111111111",
        "usuario_id": 1,
        "empresa_id": 1,
        "titulo": "Diagnóstico bomba",
        "saved_at": datetime(2026, 9, 29, 18, 30, tzinfo=timezone.utc),
        "messages": [],
    }


# =============================================================================
# CGBIDA-254 — Listar conversaciones
# =============================================================================

@pytest.mark.asyncio
async def test_list_sessions_sin_auth(client):
    r = await client.get("/api/chat/sessions")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_sessions_vacio(client, override_auth, mock_repo):
    mock_repo["list_by_user"].return_value = []
    r = await client.get("/api/chat/sessions")
    assert r.status_code == 200
    body = r.json()
    assert body == {"sessions": [], "total": 0}
    mock_repo["list_by_user"].assert_called_once_with(1, limit=20, offset=0)


@pytest.mark.asyncio
async def test_list_sessions_devuelve_items(client, override_auth, mock_repo):
    mock_repo["list_by_user"].return_value = [
        {
            "session_id": "11111111-1111-1111-1111-111111111111",
            "titulo": "Consulta 1",
            "saved_at": datetime(2026, 9, 29, 10, 0, tzinfo=timezone.utc),
            "message_count": 4,
        },
        {
            "session_id": "22222222-2222-2222-2222-222222222222",
            "titulo": "Consulta 2",
            "saved_at": datetime(2026, 9, 29, 11, 0, tzinfo=timezone.utc),
            "message_count": 2,
        },
    ]
    r = await client.get("/api/chat/sessions?limit=10&offset=0")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["sessions"][0]["titulo"] == "Consulta 1"
    assert body["sessions"][1]["message_count"] == 2


@pytest.mark.asyncio
async def test_list_sessions_paginacion(client, override_auth, mock_repo):
    mock_repo["list_by_user"].return_value = []
    r = await client.get("/api/chat/sessions?limit=50&offset=100")
    assert r.status_code == 200
    mock_repo["list_by_user"].assert_called_once_with(1, limit=50, offset=100)


@pytest.mark.asyncio
async def test_list_sessions_limit_invalido(client, override_auth, mock_repo):
    r = await client.get("/api/chat/sessions?limit=200")
    assert r.status_code == 422


# =============================================================================
# CGBIDA-255 + 257 — Ver historial con validación
# =============================================================================

@pytest.mark.asyncio
async def test_get_session_sin_auth(client):
    sid = str(uuid.uuid4())
    r = await client.get(f"/api/chat/sessions/{sid}")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_session_uuid_invalido(client, override_auth, mock_repo):
    r = await client.get("/api/chat/sessions/no-es-uuid")
    assert r.status_code == 422
    assert "UUID" in r.json()["detail"]


@pytest.mark.asyncio
async def test_get_session_404_si_no_pertenece(
    client, override_auth, mock_repo
):
    """CGBIDA-257: si get_session devuelve None, es 404."""
    mock_repo["get_session"].return_value = None
    sid = str(uuid.uuid4())
    r = await client.get(f"/api/chat/sessions/{sid}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_session_ok_con_mensajes(
    client, override_auth, mock_repo, fake_session_row
):
    mock_repo["get_session"].return_value = fake_session_row
    mock_repo["load_messages"].return_value = [
        {"role": "user", "content": "hola", "timestamp": 1},
        {"role": "assistant", "content": "qué tal", "timestamp": 2},
    ]

    r = await client.get(f"/api/chat/sessions/{fake_session_row['session_id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == fake_session_row["session_id"]
    assert body["titulo"] == "Diagnóstico bomba"
    assert len(body["messages"]) == 2
    assert body["messages"][0]["role"] == "user"
    assert body["messages"][1]["content"] == "qué tal"


# =============================================================================
# CGBIDA-256 + 257 — Eliminar con validación
# =============================================================================

@pytest.mark.asyncio
async def test_delete_session_sin_auth(client):
    sid = str(uuid.uuid4())
    r = await client.delete(f"/api/chat/sessions/{sid}")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_delete_session_uuid_invalido(client, override_auth, mock_repo):
    r = await client.delete("/api/chat/sessions/no-es-uuid")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_delete_session_404_si_no_existe(
    client, override_auth, mock_repo
):
    mock_repo["delete_session"].return_value = False
    sid = str(uuid.uuid4())
    r = await client.delete(f"/api/chat/sessions/{sid}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_session_ok(client, override_auth, mock_repo):
    mock_repo["delete_session"].return_value = True
    sid = str(uuid.uuid4())
    r = await client.delete(f"/api/chat/sessions/{sid}")
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] is True
    assert body["session_id"] == sid
    mock_repo["delete_session"].assert_called_once_with(sid, 1)

# =============================================================================
# HU-23 — maquina_id / machine_name y has_image en el detalle
# =============================================================================

@pytest.mark.asyncio
async def test_get_session_devuelve_maquina_y_has_image(
    client, override_auth, mock_repo, fake_session_row
):
    mock_repo["get_session"].return_value = {
        **fake_session_row, "maquina_id": 5, "machine_name": "Compressor A1",
    }
    mock_repo["load_messages"].return_value = [
        {"role": "user", "content": "¿qué le pasa?", "timestamp": 1, "has_image": True},
        {"role": "assistant", "content": "parece una fuga", "timestamp": 2},
    ]

    r = await client.get(f"/api/chat/sessions/{fake_session_row['session_id']}")

    assert r.status_code == 200
    body = r.json()
    assert body["maquina_id"] == 5
    assert body["machine_name"] == "Compressor A1"
    assert body["messages"][0]["has_image"] is True
    assert body["messages"][1]["has_image"] is False  # sin marca = False


@pytest.mark.asyncio
async def test_get_session_sin_maquina_devuelve_null(
    client, override_auth, mock_repo, fake_session_row
):
    mock_repo["get_session"].return_value = fake_session_row  # sin las claves nuevas
    mock_repo["load_messages"].return_value = [{"role": "user", "content": "hola", "timestamp": 1}]

    r = await client.get(f"/api/chat/sessions/{fake_session_row['session_id']}")

    body = r.json()
    assert r.status_code == 200
    assert body["maquina_id"] is None and body["machine_name"] is None
    assert body["messages"][0]["has_image"] is False


@pytest.mark.asyncio
async def test_get_session_restaura_la_maquina_desde_la_base(client, override_auth, db_pool):
    """Integración: sesión real con máquina y un turno con imagen -> el detalle los devuelve."""
    from barb.core.db import execute, fetch_one
    from barb.services import chat_repository

    maquina = await fetch_one(
        "SELECT m.maquina_id, m.nombre, m.codigo, p.nombre AS planta, d.nombre AS disciplina"
        "  FROM maquina m JOIN planta p ON p.planta_id = m.planta_id"
        "  LEFT JOIN disciplina d ON d.disciplina_id = m.disciplina_id"
        " WHERE p.empresa_id = 1 ORDER BY m.maquina_id LIMIT 1"
    )
    sid = await chat_repository.create_session(
        usuario_id=1, empresa_id=1, primer_mensaje="foto del equipo", maquina=maquina
    )
    try:
        await chat_repository.append_messages(sid, 1, [
            {"role": "user", "content": "foto del equipo", "timestamp": 1, "has_image": True},
            {"role": "assistant", "content": "ok", "timestamp": 2},
        ])
        r = await client.get(f"/api/chat/sessions/{sid}")
        body = r.json()
        assert r.status_code == 200
        assert body["maquina_id"] == maquina["maquina_id"]
        assert body["machine_name"] == maquina["nombre"]
        assert [m["has_image"] for m in body["messages"]] == [True, False]
    finally:
        await execute("DELETE FROM chat_session WHERE session_id = %(s)s", {"s": sid})
