"""Tests de autenticación. Cubre criterios de HU-02."""
from __future__ import annotations

import pytest
import pytest_asyncio

from barb.core.db import execute


@pytest.mark.asyncio
async def test_login_exitoso(client, usuario_admin):
    """Login con credenciales válidas debe devolver 200 + token."""
    response = await client.post("/api/auth/login", json=usuario_admin)

    assert response.status_code == 200, f"Esperaba 200, recibió {response.status_code}: {response.text}"
    data = response.json()
    assert "token" in data
    assert "user" in data
    assert data["user"]["role"] in ("admin", "gerente")


@pytest.mark.asyncio
async def test_login_password_incorrecta(client, usuario_admin):
    """Login con password incorrecta debe devolver 401."""
    payload = {**usuario_admin, "password": "wrong_password_12345"}
    response = await client.post("/api/auth/login", json=payload)

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_email_inexistente(client):
    """Login con email inexistente debe devolver 401."""
    response = await client.post(
        "/api/auth/login",
        json={"email": "noexiste@test.local", "password": "cualquiera"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_payload_invalido(client):
    """Login sin email ni password debe devolver 400 o 422."""
    response = await client.post("/api/auth/login", json={})

    assert response.status_code in (400, 422)

# =============================================================================
# Usuario desactivado (activo = FALSE)
# =============================================================================

_MSG_DESACTIVADO = "desactivado"


@pytest_asyncio.fixture
async def tecnico_desactivable(db_pool, usuario_tecnico):
    """Entrega las credenciales de tecnico1 y garantiza activo=TRUE al terminar."""
    email = usuario_tecnico["email"]
    try:
        yield usuario_tecnico
    finally:
        await execute("UPDATE usuario SET activo = TRUE WHERE lower(email) = %(e)s", {"e": email})


async def _set_activo(email: str, activo: bool) -> None:
    await execute("UPDATE usuario SET activo = %(a)s WHERE lower(email) = %(e)s", {"a": activo, "e": email})


@pytest.mark.asyncio
async def test_login_exitoso_incluye_activo(client, usuario_admin):
    """El 200 expone user.activo = True."""
    response = await client.post("/api/auth/login", json=usuario_admin)

    assert response.status_code == 200
    assert response.json()["user"]["activo"] is True


@pytest.mark.asyncio
async def test_login_usuario_desactivado_403(client, tecnico_desactivable):
    """Password correcta + usuario inactivo -> 403 con mensaje y activo=false."""
    await _set_activo(tecnico_desactivable["email"], False)

    response = await client.post("/api/auth/login", json=tecnico_desactivable)

    assert response.status_code == 403, response.text
    body = response.json()
    assert body["activo"] is False
    assert _MSG_DESACTIVADO in body["detail"].lower()
    assert "token" not in body


@pytest.mark.asyncio
async def test_login_desactivado_password_incorrecta_no_revela_estado(client, tecnico_desactivable):
    """Password mala en usuario inactivo -> 401 genérico (no filtra el estado)."""
    await _set_activo(tecnico_desactivable["email"], False)

    response = await client.post(
        "/api/auth/login",
        json={**tecnico_desactivable, "password": "wrong_password_12345"},
    )

    assert response.status_code == 401
    assert "activo" not in response.json()


@pytest.mark.asyncio
async def test_sesion_existente_rechazada_al_desactivar_usuario(client, tecnico_desactivable):
    """Token emitido antes de desactivar deja de funcionar (401) y vuelve al reactivar."""
    login = await client.post("/api/auth/login", json=tecnico_desactivable)
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['token']}"}

    ok = await client.get("/api/chat/sessions", headers=headers)
    assert ok.status_code != 401, ok.text

    await _set_activo(tecnico_desactivable["email"], False)
    bloqueado = await client.get("/api/chat/sessions", headers=headers)
    assert bloqueado.status_code == 401

    await _set_activo(tecnico_desactivable["email"], True)
    reactivado = await client.get("/api/chat/sessions", headers=headers)
    assert reactivado.status_code != 401
