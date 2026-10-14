"""
Integración del canal SSE de OTs (HU-10): auth del stream y publicación de eventos al
cambiar OTs. httpx `ASGITransport` no entrega respuestas SSE en streaming, así que el
fan-out se verifica suscribiéndose al broker (el mismo que consume el endpoint).
"""
from __future__ import annotations

import pytest

from barb.core.db import execute, fetch_one
from barb.services.realtime import EVENT_OT_CREATED, EVENT_OT_DELETED, EVENT_OT_STATUS_CHANGED, broker

ADMIN = {"email": "admin@barb.com", "password": "admin123"}
SUPERVISOR = {"email": "supervisor1@planta.com", "password": "super123"}
OTRA_EMPRESA = {"email": "admin@mineranorte.cl", "password": "minera123"}

MARCA = "Test HU-10 realtime"


async def _auth(client, creds: dict) -> dict:
    resp = await client.post("/api/auth/login", json=creds)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


async def _empresa_de(client, creds: dict) -> int:
    row = await fetch_one("SELECT empresa_id FROM usuario WHERE email = %(e)s", {"e": creds["email"]})
    return int(row["empresa_id"])


@pytest.fixture
async def ot(client):
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


# --- autenticación del canal (CGBIDA-340) ---------------------------------------

@pytest.mark.parametrize("path", ["/api/work-orders/stream", "/api/work_orders/stream"])
async def test_stream_sin_credenciales_responde_401(client, path):
    resp = await client.get(path)
    assert resp.status_code == 401


async def test_stream_con_token_invalido_responde_401(client):
    resp = await client.get("/api/work-orders/stream", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


async def test_stream_con_ticket_invalido_responde_401(client):
    resp = await client.get("/api/work-orders/stream", params={"ticket": "inventado"})
    assert resp.status_code == 401


async def test_ticket_requiere_sesion(client):
    resp = await client.post("/api/work-orders/stream/ticket", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


async def test_ticket_emitido_y_consumido_una_sola_vez(client):
    headers = await _auth(client, SUPERVISOR)
    resp = await client.post("/api/work-orders/stream/ticket", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["expires_in"] == 60

    from barb.services.realtime import consume_ticket

    sesion = consume_ticket(body["ticket"])
    assert sesion is not None and sesion["rol"] == "supervisor"
    assert consume_ticket(body["ticket"]) is None


async def test_stream_no_se_confunde_con_numero_ot(client):
    """`/stream` debe resolverse al canal SSE, no a GET /api/work-orders/{numero_ot} (404)."""
    resp = await client.get("/api/work-orders/stream")
    assert resp.status_code == 401  # un 404 delataría el choque con /{numero_ot}


# --- publicación al cambiar OTs (CGBIDA-339 / 350) ------------------------------

async def test_cambio_de_estado_llega_a_todos_los_clientes_de_la_empresa(client, ot):
    empresa = await _empresa_de(client, ADMIN)
    otra = await _empresa_de(client, OTRA_EMPRESA)
    assert empresa != otra

    with broker.subscribe(empresa) as a, broker.subscribe(empresa) as b, broker.subscribe(otra) as ajeno:
        headers = await _auth(client, SUPERVISOR)
        resp = await client.patch(f"/api/work-orders/{ot}/status", json={"status": "in_progress"}, headers=headers)
        assert resp.status_code == 200, resp.text

        for sub in (a, b):
            event = sub.queue.get_nowait()
            assert event.type == EVENT_OT_STATUS_CHANGED
            assert event.data["numero_ot"] == ot
            assert event.data["estado_anterior"] == "pending"
            assert event.data["estado_nuevo"] == "in_progress"
            assert event.data["empresa_id"] == empresa
        assert ajeno.queue.empty(), "otra empresa no debe ver eventos ajenos"


async def test_transicion_rechazada_no_publica_evento(client, ot):
    empresa = await _empresa_de(client, ADMIN)
    with broker.subscribe(empresa) as sub:
        headers = await _auth(client, SUPERVISOR)
        resp = await client.patch(f"/api/work-orders/{ot}/status", json={"status": "completed"}, headers=headers)
        assert resp.status_code == 409
        assert sub.queue.empty()


async def test_crear_y_eliminar_ot_publican_eventos(client):
    empresa = await _empresa_de(client, ADMIN)
    maquina = await fetch_one("SELECT maquina_id FROM maquina ORDER BY maquina_id LIMIT 1")
    tecnico = await fetch_one("SELECT usuario_id FROM usuario WHERE rol = 'tecnico' AND activo ORDER BY usuario_id LIMIT 1")
    headers = await _auth(client, ADMIN)

    with broker.subscribe(empresa) as sub:
        resp = await client.post(
            "/api/work-orders",
            json={
                "maquina_id": maquina["maquina_id"],
                "tecnico_id": tecnico["usuario_id"],
                "descripcion_problema": f"{MARCA}: crear/eliminar",
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        numero_ot = resp.json()["numero_ot"]

        creado = sub.queue.get_nowait()
        assert (creado.type, creado.data["numero_ot"]) == (EVENT_OT_CREATED, numero_ot)

        resp = await client.delete(f"/api/work-orders/{numero_ot}", headers=headers)
        assert resp.status_code == 204, resp.text
        eliminado = sub.queue.get_nowait()
        assert (eliminado.type, eliminado.data["numero_ot"]) == (EVENT_OT_DELETED, numero_ot)


# --- reconexión (CGBIDA-351) ------------------------------------------------------

async def test_reconexion_recupera_el_evento_perdido_con_last_event_id(client, ot):
    empresa = await _empresa_de(client, ADMIN)
    headers = await _auth(client, SUPERVISOR)

    with broker.subscribe(empresa) as primera:
        resp = await client.patch(f"/api/work-orders/{ot}/status", json={"status": "in_progress"}, headers=headers)
        assert resp.status_code == 200, resp.text
        visto = primera.queue.get_nowait()

    # Cliente desconectado: este cambio ocurre mientras no hay conexión.
    resp = await client.patch(f"/api/work-orders/{ot}/status", json={"status": "completed"}, headers=headers)
    assert resp.status_code == 200, resp.text

    with broker.subscribe(empresa, visto.id) as segunda:
        assert [e.type for e in segunda.initial] == [EVENT_OT_STATUS_CHANGED]
        assert segunda.initial[0].data["estado_nuevo"] == "completed"
