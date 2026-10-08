"""Tests de integración del cambio de estado de OT: PATCH /api/work-orders/{numero_ot}/status."""
from __future__ import annotations

import pytest

from barb.core.db import execute, fetch_all, fetch_one

ADMIN = {"email": "admin@barb.com", "password": "admin123"}
SUPERVISOR = {"email": "supervisor1@planta.com", "password": "super123"}
ENGINEER = {"email": "engineer1@planta.com", "password": "engineer123"}
TECNICO = {"email": "carlos@planta.com", "password": "tecnico123"}
OPERADOR = {"email": "operador1@planta.com", "password": "operador123"}
VISITANTE = {"email": "visitante@planta.com", "password": "visitante123"}
OTRA_EMPRESA = {"email": "admin@mineranorte.cl", "password": "minera123"}

MARCA = "Test HU-09"


async def _auth(client, creds: dict) -> dict:
    resp = await client.post("/api/auth/login", json=creds)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture
async def ot(client):
    """Crea una OT pendiente (como admin) y la elimina al terminar."""
    maquina = await fetch_one("SELECT maquina_id FROM maquina ORDER BY maquina_id LIMIT 1")
    tecnico = await fetch_one("SELECT usuario_id FROM usuario WHERE rol = 'tecnico' AND activo ORDER BY usuario_id LIMIT 1")
    headers = await _auth(client, ADMIN)
    resp = await client.post(
        "/api/work-orders",
        json={
            "maquina_id": maquina["maquina_id"],
            "tecnico_id": tecnico["usuario_id"],
            "descripcion_problema": f"{MARCA}: cambio de estado",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    yield resp.json()["numero_ot"]
    await execute("DELETE FROM orden_trabajo WHERE descripcion_problema LIKE %(p)s", {"p": f"{MARCA}%"})


async def _patch(client, creds, numero_ot, status, **extra):
    headers = await _auth(client, creds)
    return await client.patch(f"/api/work-orders/{numero_ot}/status", json={"status": status, **extra}, headers=headers)


async def test_flujo_completo_pendiente_en_curso_cerrada(client, ot):
    resp = await _patch(client, SUPERVISOR, ot, "in_progress")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["estado"] == "in_progress"
    assert data["fecha_inicio"] is not None
    assert data["fecha_cierre"] is None
    assert data["allowed_transitions"] == ["completed", "cancelled"]

    resp = await _patch(client, SUPERVISOR, ot, "completed", comment="Reparación terminada")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["estado"] == "completed"
    assert data["status"] == "Closed"
    assert data["fecha_cierre"] is not None
    assert data["allowed_transitions"] == []


async def test_cambio_queda_auditado_con_usuario_y_timestamp(client, ot):
    await _patch(client, SUPERVISOR, ot, "in_progress", comment="Se inicia el trabajo")
    resp = await _patch(client, SUPERVISOR, ot, "completed")

    history = resp.json()["status_history"]
    assert [h["to_status"] for h in history] == ["completed", "in_progress"]  # más reciente primero
    primero = history[1]
    assert primero["from_status"] == "pending"
    assert primero["comment"] == "Se inicia el trabajo"
    assert primero["user_name"] == "Supervisor Turno A"
    assert primero["user_role"] == "supervisor"
    assert primero["changed_at"].endswith("Z")

    filas = await fetch_all(
        """
        SELECT a.usuario_id, a.estado_nuevo FROM ot_audit_log a
        JOIN orden_trabajo o ON o.ot_id = a.ot_id WHERE o.numero_ot = %(n)s
        """,
        {"n": ot},
    )
    assert len(filas) == 2
    supervisor = await fetch_one("SELECT usuario_id FROM usuario WHERE email = %(e)s", {"e": SUPERVISOR["email"]})
    supervisor_id = supervisor["usuario_id"]
    assert {f["usuario_id"] for f in filas} == {supervisor_id}


async def test_detalle_incluye_historial(client, ot):
    await _patch(client, SUPERVISOR, ot, "in_progress")
    headers = await _auth(client, SUPERVISOR)
    resp = await client.get(f"/api/work-orders/{ot}", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()["status_history"]) == 1


async def test_listado_expone_transiciones_segun_rol(client, ot):
    sup = await client.get("/api/work-orders", headers=await _auth(client, SUPERVISOR))
    tec = await client.get("/api/work-orders", headers=await _auth(client, TECNICO))
    pick = lambda r: next(o for o in r.json() if o["numero_ot"] == ot)  # noqa: E731
    assert pick(sup)["allowed_transitions"] == ["in_progress", "cancelled"]
    assert pick(tec)["allowed_transitions"] == []


async def test_cancelar_desde_pendiente(client, ot):
    resp = await _patch(client, SUPERVISOR, ot, "cancelled", comment="Duplicada")
    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "cancelled"


@pytest.mark.parametrize("creds", [TECNICO, OPERADOR, VISITANTE])
async def test_tecnico_operador_y_visitante_no_cambian_estado(client, ot, creds):
    resp = await _patch(client, creds, ot, "in_progress")
    assert resp.status_code == 403
    estado = await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot})
    assert estado["estado"] == "pending"


async def test_engineer_puede_iniciar_pero_no_cancelar(client, ot):
    assert (await _patch(client, ENGINEER, ot, "in_progress")).status_code == 200
    resp = await _patch(client, ENGINEER, ot, "cancelled")
    assert resp.status_code == 403
    assert "cancelada" in resp.json()["detail"].lower()


@pytest.mark.parametrize("destino", ["completed", "pending"])
async def test_transicion_invalida_desde_pendiente_409(client, ot, destino):
    resp = await _patch(client, SUPERVISOR, ot, destino)
    assert resp.status_code == 409
    assert "pendiente" in resp.json()["detail"].lower()


async def test_mismo_estado_409(client, ot):
    await _patch(client, SUPERVISOR, ot, "in_progress")
    assert (await _patch(client, SUPERVISOR, ot, "in_progress")).status_code == 409


@pytest.mark.parametrize("final", ["completed", "cancelled"])
async def test_estados_finales_no_admiten_cambios(client, ot, final):
    if final == "completed":
        await _patch(client, SUPERVISOR, ot, "in_progress")
    assert (await _patch(client, SUPERVISOR, ot, final)).status_code == 200
    assert (await _patch(client, SUPERVISOR, ot, "in_progress")).status_code == 409


async def test_transicion_rechazada_no_deja_auditoria(client, ot):
    await _patch(client, SUPERVISOR, ot, "completed")
    filas = await fetch_all(
        "SELECT 1 FROM ot_audit_log a JOIN orden_trabajo o ON o.ot_id = a.ot_id WHERE o.numero_ot = %(n)s", {"n": ot}
    )
    assert filas == []


async def test_estado_invalido_400(client, ot):
    assert (await _patch(client, SUPERVISOR, ot, "inventado")).status_code == 400


async def test_comentario_demasiado_largo_422(client, ot):
    assert (await _patch(client, SUPERVISOR, ot, "in_progress", comment="x" * 501)).status_code == 422


async def test_ot_inexistente_404(client):
    assert (await _patch(client, SUPERVISOR, "OT-0000-9999", "in_progress")).status_code == 404


async def test_otra_empresa_no_puede_tocar_la_ot_404(client, ot):
    resp = await _patch(client, OTRA_EMPRESA, ot, "in_progress")
    assert resp.status_code == 404
    estado = await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot})
    assert estado["estado"] == "pending"


async def test_sin_token_rechaza(client, ot):
    resp = await client.patch(f"/api/work-orders/{ot}/status", json={"status": "in_progress"})
    assert resp.status_code in (401, 422)


async def test_ruta_con_guion_bajo_y_put_legado_siguen_funcionando(client, ot):
    headers = await _auth(client, SUPERVISOR)
    resp = await client.put(f"/api/work_orders/{ot}/status", json={"status": "in_progress"}, headers=headers)
    assert resp.status_code == 200
    resp = await client.patch(f"/api/work_orders/{ot}/status", json={"status": "completed"}, headers=headers)
    assert resp.status_code == 200
