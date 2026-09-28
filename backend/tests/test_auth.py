"""Tests de autenticación. Cubre criterios de HU-02."""
from __future__ import annotations

import pytest


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