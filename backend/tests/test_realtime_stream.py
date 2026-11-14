"""
Integración del canal SSE de OTs (HU-10): auth del stream y publicación de eventos al
cambiar OTs. httpx `ASGITransport` no entrega respuestas SSE en streaming, así que el
fan-out se verifica suscribiéndose al broker (el mismo que consume el endpoint).
"""
from __future__ import annotations

import pytest

from barb.core.db import execute, fetch_one
from barb.services.realtime import EVENT_OT_CREATED, EVENT_OT_STATUS_CHANGED, broker

ADMIN = {"email": "admin@mineradelnorte.cl", "password": "mineria123"}
GERENTE = {"email": "gerente@mineradelnorte.cl", "password": "mineria123"}
SUPERVISOR = {"email": "supervisor@mineradelnorte.cl", "password": "mineria123"}
OTRA_EMPRESA = {"email": "admin@alimentos.cl", "password": "alimentos123"}

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
    headers = await _auth(client, SUPERVISOR)
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


async def test_crear_ot_publica_evento_y_eliminarla_esta_prohibido(client):
    empresa = await _empresa_de(client, ADMIN)
    maquina = await fetch_one("SELECT maquina_id FROM maquina ORDER BY maquina_id LIMIT 1")
    tecnico = await fetch_one("SELECT usuario_id FROM usuario WHERE rol = 'tecnico' AND activo ORDER BY usuario_id LIMIT 1")
    headers = await _auth(client, SUPERVISOR)

    with broker.subscribe(empresa) as sub:
        resp = await client.post(
            "/api/work-orders",
            json={
                "maquina_id": maquina["maquina_id"],
                "tecnico_id": tecnico["usuario_id"],
                "descripcion_problema": f"{MARCA}: crear/no eliminar",
            },
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        numero_ot = resp.json()["numero_ot"]

        creado = sub.queue.get_nowait()
        assert (creado.type, creado.data["numero_ot"]) == (EVENT_OT_CREATED, numero_ot)

        # Ningún perfil elimina OT (D1): el DELETE responde 403 y no publica nada. La OT de prueba se limpia por SQL.
        try:
            for creds in (GERENTE, SUPERVISOR):
                resp = await client.delete(f"/api/work-orders/{numero_ot}", headers=await _auth(client, creds))
                assert resp.status_code == 403, resp.text
            assert sub.queue.empty()
        finally:
            await execute("DELETE FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": numero_ot})


# --- reconexión (CGBIDA-351) ------------------------------------------------------

async def test_reconexion_recupera_el_evento_perdido_con_last_event_id(client, ot):
    empresa = await _empresa_de(client, ADMIN)
    headers = await _auth(client, SUPERVISOR)

    with broker.subscribe(empresa) as primera:
        resp = await client.patch(f"/api/work-orders/{ot}/status", json={"status": "in_progress"}, headers=headers)
        assert resp.status_code == 200, resp.text
        visto = primera.queue.get_nowait()

    # Cliente desconectado: este cambio ocurre mientras no hay conexión.
    resp = await client.patch(f"/api/work-orders/{ot}/status", json={"status": "por_validar"}, headers=headers)
    assert resp.status_code == 200, resp.text

    with broker.subscribe(empresa, visto.id) as segunda:
        assert [e.type for e in segunda.initial] == [EVENT_OT_STATUS_CHANGED]
        assert segunda.initial[0].data["estado_nuevo"] == "por_validar"


async def test_el_tecnico_solo_recibe_eventos_de_sus_ot_y_el_payload_no_expone_la_lista_interna(client, ot):
    """`ot` está asignada a carlos (id 4). Otro técnico, suscrito a la misma empresa, no debe enterarse."""
    empresa = await _empresa_de(client, ADMIN)
    carlos = await fetch_one("SELECT usuario_id FROM usuario WHERE email = 'tecnico1@mineradelnorte.cl'")
    ana = await fetch_one("SELECT usuario_id FROM usuario WHERE email = 'tecnico2@mineradelnorte.cl'")

    with (
        broker.subscribe(empresa, solo_usuario_id=carlos["usuario_id"]) as de_carlos,
        broker.subscribe(empresa, solo_usuario_id=ana["usuario_id"]) as de_ana,
        broker.subscribe(empresa) as supervision,
    ):
        resp = await client.patch(
            f"/api/work-orders/{ot}/status", json={"status": "in_progress"}, headers=await _auth(client, SUPERVISOR)
        )
        assert resp.status_code == 200, resp.text
        assert de_carlos.queue.qsize() == 1 and supervision.queue.qsize() == 1
        assert de_ana.queue.empty(), "un técnico no debe recibir eventos de OT ajenas"

    # Lo que sale por el canal HTTP no incluye la clave interna (el router la quita al armar el frame).
    from barb.routers.realtime import _frame

    evento = de_carlos.queue.get_nowait()
    assert evento.data["visible_a"], "internamente el evento sí lleva a quién concierne"
    assert "visible_a" not in _frame(evento)["data"]
