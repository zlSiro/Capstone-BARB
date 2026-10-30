"""Asignar y reasignar una OT: PATCH /api/work-orders/{numero_ot}/assignment (supervisor y gerente)."""

from __future__ import annotations

import pytest

from barb.core.db import execute, fetch_one

MARCA = "Test asignacion"

SUPERVISOR = {"email": "supervisor1@planta.com", "password": "super123"}
GERENTE = {"email": "gerente1@planta.com", "password": "gerente123"}
ENGINEER = {"email": "engineer1@planta.com", "password": "engineer123"}
ADMIN = {"email": "admin@barb.com", "password": "admin123"}
TECNICO = {"email": "carlos@planta.com", "password": "tecnico123"}
TECNICO_2 = {"email": "ana@planta.com", "password": "tecnico123"}
OPERADOR = {"email": "operador1@planta.com", "password": "operador123"}
GERENTE_E2 = {"email": "gerente@mineranorte.cl", "password": "minera123"}


async def _login(client, creds) -> dict:
    resp = await client.post("/api/auth/login", json=creds)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


async def _usuario_id(email: str) -> int:
    return int((await fetch_one("SELECT usuario_id FROM usuario WHERE email = %(e)s", {"e": email}))["usuario_id"])


@pytest.fixture
async def ot(client):
    """OT pendiente de carlos, creada por el gerente."""
    maquina = await fetch_one("SELECT maquina_id FROM maquina ORDER BY maquina_id LIMIT 1")
    resp = await client.post(
        "/api/work-orders",
        json={
            "maquina_id": maquina["maquina_id"],
            "tecnico_id": await _usuario_id(TECNICO["email"]),
            "descripcion_problema": f"{MARCA}: reasignación",
            "priority": "low",
        },
        headers=await _login(client, GERENTE),
    )
    assert resp.status_code == 200, resp.text
    yield resp.json()["numero_ot"]
    await execute("DELETE FROM orden_trabajo WHERE descripcion_problema LIKE %(p)s", {"p": f"{MARCA}%"})


def _url(numero: str) -> str:
    return f"/api/work-orders/{numero}/assignment"


@pytest.mark.parametrize("creds", [SUPERVISOR, GERENTE])
async def test_supervisor_y_gerente_reasignan_el_tecnico_y_la_prioridad(client, ot, creds):
    nuevo = await _usuario_id(TECNICO_2["email"])
    resp = await client.patch(_url(ot), json={"tecnico_id": nuevo, "priority": "urgent"}, headers=await _login(client, creds))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["tecnico_id"] == nuevo and data["tecnico_nombre"] == "Ana Silva" and data["priority"] == "urgent"
    assert data["estado"] == "pending"  # reasignar no cambia el estado


async def test_se_puede_cambiar_solo_el_vencimiento(client, ot):
    resp = await client.patch(
        _url(ot), json={"fecha_vencimiento": "2030-01-15T12:00:00Z"}, headers=await _login(client, SUPERVISOR)
    )
    assert resp.status_code == 200, resp.text
    fila = await fetch_one("SELECT fecha_vencimiento FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot})
    assert fila["fecha_vencimiento"].year == 2030


async def test_la_reasignacion_se_refleja_en_lo_que_ve_cada_tecnico(client, ot):
    nuevo = await _usuario_id(TECNICO_2["email"])
    await client.patch(_url(ot), json={"tecnico_id": nuevo}, headers=await _login(client, SUPERVISOR))
    mia = lambda creds: client.get("/api/work-orders", headers=creds)  # noqa: E731
    ana = [o["numero_ot"] for o in (await mia(await _login(client, TECNICO_2))).json()]
    carlos = [o["numero_ot"] for o in (await mia(await _login(client, TECNICO))).json()]
    assert ot in ana and ot not in carlos


@pytest.mark.parametrize("creds", [TECNICO, OPERADOR, ENGINEER, ADMIN])
async def test_los_demas_roles_no_asignan(client, ot, creds):
    resp = await client.patch(_url(ot), json={"priority": "high"}, headers=await _login(client, creds))
    assert resp.status_code == 403


async def test_validaciones(client, ot):
    h = await _login(client, SUPERVISOR)
    assert (await client.patch(_url(ot), json={}, headers=h)).status_code == 422
    assert (await client.patch(_url(ot), json={"priority": "extrema"}, headers=h)).status_code == 422
    assert (await client.patch(_url(ot), json={"tecnico_id": 999999}, headers=h)).status_code == 422
    # Un usuario que no es técnico no puede quedar como responsable.
    assert (await client.patch(_url(ot), json={"tecnico_id": await _usuario_id(ENGINEER["email"])}, headers=h)).status_code == 422
    assert (await client.patch(_url("OT-0000-9999"), json={"priority": "high"}, headers=h)).status_code == 404


async def test_una_ot_cerrada_no_se_reasigna(client, ot):
    h = await _login(client, SUPERVISOR)
    await client.patch(f"/api/work-orders/{ot}/status", json={"status": "cancelled"}, headers=h)
    resp = await client.patch(_url(ot), json={"priority": "high"}, headers=h)
    assert resp.status_code == 409


async def test_otra_empresa_no_puede_reasignar(client, ot):
    resp = await client.patch(_url(ot), json={"priority": "high"}, headers=await _login(client, GERENTE_E2))
    assert resp.status_code == 404
