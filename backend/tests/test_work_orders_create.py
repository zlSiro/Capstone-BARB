"""Tests de creación de OT (HU-07): caso feliz + rechazos."""
from __future__ import annotations

import pytest

from barb.core.db import execute, fetch_one

ADMIN = {"email": "admin@barb.com", "password": "admin123"}
GERENTE = {"email": "gerente1@planta.com", "password": "gerente123"}
TECNICO = {"email": "carlos@planta.com", "password": "tecnico123"}
OPERADOR = {"email": "operador1@planta.com", "password": "operador123"}


async def _auth(client, creds: dict) -> dict:
    resp = await client.post("/api/auth/login", json=creds)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


async def _ids() -> tuple[int, int]:
    maquina = await fetch_one("SELECT maquina_id FROM maquina ORDER BY maquina_id LIMIT 1")
    tecnico = await fetch_one("SELECT usuario_id FROM usuario WHERE rol = 'tecnico' AND activo ORDER BY usuario_id LIMIT 1")
    return int(maquina["maquina_id"]), int(tecnico["usuario_id"])


@pytest.fixture
async def payload():
    maquina_id, tecnico_id = await _ids()
    return {
        "maquina_id": maquina_id,
        "tecnico_id": tecnico_id,
        "descripcion_problema": "Test HU-07: vibración anormal",
        "priority": "high",
    }


@pytest.fixture
async def cleanup():
    yield
    await execute("DELETE FROM orden_trabajo WHERE descripcion_problema LIKE %(p)s", {"p": "Test HU-07%"})


async def test_crear_ot_caso_feliz(client, payload, cleanup):
    headers = await _auth(client, ADMIN)
    resp = await client.post("/api/work-orders", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["numero_ot"].startswith("OT-")
    assert data["priority"] == "high"
    assert data["estado"] == "pending"

    # Aparece en el listado
    listado = await client.get("/api/work-orders", headers=headers)
    assert data["numero_ot"] in [o["numero_ot"] for o in listado.json()]


async def test_gerente_puede_crear_ot(client, payload, cleanup):
    headers = await _auth(client, GERENTE)
    resp = await client.post("/api/work_orders", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text


async def test_creado_por_es_usuario_de_sesion(client, payload, cleanup):
    headers = await _auth(client, ADMIN)
    resp = await client.post("/api/work-orders", json={**payload, "creado_por": 999999}, headers=headers)
    assert resp.status_code == 200, resp.text
    row = await fetch_one(
        "SELECT u.email FROM orden_trabajo ot JOIN usuario u ON u.usuario_id = ot.creado_por WHERE ot.numero_ot = %(n)s",
        {"n": resp.json()["numero_ot"]},
    )
    assert row["email"] == ADMIN["email"]


@pytest.mark.parametrize("creds", [TECNICO, OPERADOR])
async def test_roles_sin_permiso_reciben_403(client, payload, creds):
    headers = await _auth(client, creds)
    resp = await client.post("/api/work-orders", json=payload, headers=headers)
    assert resp.status_code == 403


async def test_sin_token_rechaza(client, payload):
    resp = await client.post("/api/work-orders", json=payload)
    assert resp.status_code in (401, 422)


@pytest.mark.parametrize("campo", ["maquina_id", "tecnico_id", "descripcion_problema"])
async def test_campos_obligatorios_vacios_400(client, payload, campo):
    headers = await _auth(client, ADMIN)
    resp = await client.post("/api/work-orders", json={**payload, campo: ""}, headers=headers)
    assert resp.status_code == 400
    assert campo in resp.json()["detail"]


async def test_maquina_inexistente_422(client, payload):
    headers = await _auth(client, ADMIN)
    resp = await client.post("/api/work-orders", json={**payload, "maquina_id": 999999}, headers=headers)
    assert resp.status_code == 422
    assert "máquina" in resp.json()["detail"]


async def test_tecnico_inexistente_422(client, payload):
    headers = await _auth(client, ADMIN)
    resp = await client.post("/api/work-orders", json={**payload, "tecnico_id": 999999}, headers=headers)
    assert resp.status_code == 422


async def test_tecnico_sin_rol_tecnico_422(client, payload):
    admin_id = (await fetch_one("SELECT usuario_id FROM usuario WHERE email = 'admin@barb.com'"))["usuario_id"]
    headers = await _auth(client, ADMIN)
    resp = await client.post("/api/work-orders", json={**payload, "tecnico_id": admin_id}, headers=headers)
    assert resp.status_code == 422


@pytest.mark.parametrize(
    "campo,valor",
    [("priority", "extrema"), ("tipo", "invalido"), ("severity", "grave")],
)
async def test_enum_invalido_422(client, payload, campo, valor):
    headers = await _auth(client, ADMIN)
    resp = await client.post("/api/work-orders", json={**payload, campo: valor}, headers=headers)
    assert resp.status_code == 422
    assert campo in resp.json()["detail"]


async def test_content_type_no_soportado_415(client, payload):
    headers = await _auth(client, ADMIN)
    resp = await client.post("/api/work-orders", content="x", headers={**headers, "Content-Type": "text/plain"})
    assert resp.status_code == 415


async def test_json_invalido_400(client):
    headers = await _auth(client, ADMIN)
    resp = await client.post(
        "/api/work-orders", content="{no json", headers={**headers, "Content-Type": "application/json"}
    )
    assert resp.status_code == 400
