# backend/tests/test_tickets.py
"""
Tests de los tickets conversacionales (HU-06, CGBIDA-283 a 288).

Contra la BD real (Postgres arriba + migraciones + seed, ver AGENTS.md):
- POST /api/tickets: herencia de título, sesión propia/ajena, duplicado 409,
  RBAC de creación (visitante/super_usuario 403).
- GET /api/tickets: dueño ve solo los suyos, history (supervisor) ve la
  empresa, engineer solo suyos, aislamiento inter-empresa, filtro por estado.
- GET /api/tickets/{id}: mensajes en vivo de la sesión + 404 no revelador.
- PATCH /{id}/estado: dueño avanza y resuelve, 409 máquina, 403 cancelar,
  supervisor cancela el ajeno.
- DELETE /api/chat/sessions/{id} con ticket → 409 (FK RESTRICT, migración 0007).

Estrategia: sesiones creadas directo vía chat_repository (sin llamar al LLM);
cada test limpia sus propios datos — tickets primero, sesiones después (D4).
"""

from __future__ import annotations

import uuid

import pytest

from barb.core.db import execute, fetch_one
from barb.services import chat_repository

# Credenciales del seed (backend/seeds/seed_data.sql + seed_multiempresa.sql).
ADMIN = {"email": "admin@barb.com", "password": "admin123"}  # admin, empresa 1
OPERADOR = {"email": "operador1@planta.com", "password": "operador123"}  # operador, empresa 1
TECNICO = {"email": "carlos@planta.com", "password": "tecnico123"}  # tecnico, empresa 1
ENGINEER = {"email": "engineer1@planta.com", "password": "engineer123"}  # engineer, empresa 1
SUPERVISOR = {"email": "supervisor1@planta.com", "password": "super123"}  # supervisor, empresa 1
VISITANTE = {"email": "visitante@planta.com", "password": "visitante123"}  # visitante, empresa 1
SUPER = {"email": "super@barb.com", "password": "super123"}  # super_usuario, sin empresa
OTRA_EMPRESA = {"email": "admin@trialcorp.cl", "password": "trial123"}  # admin, empresa 3

# Mensaje corto: chat_repository._make_titulo deja intactos los ≤60 caracteres,
# así el título heredado por el ticket es predecible para los asserts.
_MSJ = "Test HU-06 vibración anormal en prensa"


# =============================================================================
# Helpers
# =============================================================================

async def _auth(client, creds: dict) -> dict:
    resp = await client.post("/api/auth/login", json=creds)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


async def _usuario(email: str) -> dict:
    row = await fetch_one(
        "SELECT usuario_id, empresa_id FROM usuario WHERE lower(email) = lower(%(e)s)",
        {"e": email},
    )
    assert row, f"Falta el usuario del seed: {email}"
    return row


@pytest.fixture
async def cleanup():
    """Datos creados por el test; teardown borra tickets ANTES que sesiones (FK RESTRICT)."""
    creados: dict[str, list] = {"tickets": [], "sesiones": []}
    yield creados
    if creados["tickets"]:
        await execute("DELETE FROM ticket WHERE ticket_id = ANY(%(ids)s)", {"ids": creados["tickets"]})
    if creados["sesiones"]:
        await execute(
            "DELETE FROM chat_session WHERE session_id = ANY(%(ids)s)",
            {"ids": [uuid.UUID(s) for s in creados["sesiones"]]},
        )


async def _crear_sesion(email: str, creados) -> str:
    u = await _usuario(email)
    sid = await chat_repository.create_session(int(u["usuario_id"]), int(u["empresa_id"]), _MSJ)
    creados["sesiones"].append(sid)
    return sid


async def _crear_ticket(client, headers, email: str, creados, **extra) -> dict:
    """Crea una sesión propia de `email` y la promueve a ticket con esos headers."""
    sid = await _crear_sesion(email, creados)
    resp = await client.post("/api/tickets", json={"session_id": sid, **extra}, headers=headers)
    assert resp.status_code == 201, resp.text
    ticket = resp.json()
    creados["tickets"].append(ticket["ticket_id"])
    return ticket


# =============================================================================
# POST /api/tickets — crear desde una conversación propia
# =============================================================================

async def test_crear_ticket_hereda_titulo_y_estado_open(client, cleanup):
    headers = await _auth(client, OPERADOR)
    ticket = await _crear_ticket(client, headers, OPERADOR["email"], cleanup)

    assert ticket["estado"] == "open"
    assert ticket["titulo"] == _MSJ  # default: título de la conversación (D5)
    assert ticket["creado_por"] == "Operador Molino"
    assert ticket["resolved_at"] is None
    # Dueño operador (D2): puede avanzar, NO cancelar.
    assert ticket["allowed_transitions"] == ["in_progress"]


async def test_crear_ticket_con_titulo_custom(client, cleanup):
    headers = await _auth(client, TECNICO)
    ticket = await _crear_ticket(client, headers, TECNICO["email"], cleanup, titulo="Test HU-06 mi título")
    assert ticket["titulo"] == "Test HU-06 mi título"


async def test_crear_ticket_sesion_inexistente_404(client, cleanup):
    headers = await _auth(client, OPERADOR)
    resp = await client.post("/api/tickets", json={"session_id": str(uuid.uuid4())}, headers=headers)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Sesión no encontrada o no te pertenece."


async def test_crear_ticket_sesion_ajena_404(client, cleanup):
    # La sesión es de operador1; carlos (misma empresa) intenta promocionarla.
    sid = await _crear_sesion(OPERADOR["email"], cleanup)
    headers = await _auth(client, TECNICO)
    resp = await client.post("/api/tickets", json={"session_id": sid}, headers=headers)
    assert resp.status_code == 404


async def test_crear_ticket_duplicado_409_estructurado(client, cleanup):
    headers = await _auth(client, OPERADOR)
    ticket = await _crear_ticket(client, headers, OPERADOR["email"], cleanup)

    resp = await client.post("/api/tickets", json={"session_id": ticket["session_id"]}, headers=headers)
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["ticket_id"] == ticket["ticket_id"]  # el frontend navega al existente
    assert "ya tiene un ticket" in detail["message"]


async def test_visitante_no_puede_crear_403(client, cleanup):
    headers = await _auth(client, VISITANTE)
    resp = await client.post("/api/tickets", json={"session_id": str(uuid.uuid4())}, headers=headers)
    assert resp.status_code == 403


async def test_super_usuario_fuera_de_datos_operativos_403(client, cleanup):
    headers = await _auth(client, SUPER)
    resp = await client.get("/api/tickets", headers=headers)
    assert resp.status_code == 403


async def test_sin_token_y_token_invalido(client):
    # Sin header: FastAPI valida el header requerido antes que la dependencia
    # (mismo criterio que tests/test_work_orders_create.py).
    resp = await client.get("/api/tickets")
    assert resp.status_code in (401, 422)
    # Con token que no existe en `sesion`: 401 de get_sesion_actual.
    resp = await client.get("/api/tickets", headers={"Authorization": "Bearer token-falso-401"})
    assert resp.status_code == 401


# =============================================================================
# GET /api/tickets — visibilidad (D3) y filtro por estado
# =============================================================================

async def test_dueño_ve_solo_sus_tickets(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    h_tec = await _auth(client, TECNICO)
    await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    ajeno = await _crear_ticket(client, h_tec, TECNICO["email"], cleanup)

    resp = await client.get("/api/tickets", headers=h_op)
    assert resp.status_code == 200
    body = resp.json()
    ids = [t["ticket_id"] for t in body["tickets"]]
    assert ajeno["ticket_id"] not in ids
    assert body["total"] == 2


async def test_history_ve_todos_los_de_la_empresa(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    h_tec = await _auth(client, TECNICO)
    h_sup = await _auth(client, SUPERVISOR)
    t1 = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    t2 = await _crear_ticket(client, h_tec, TECNICO["email"], cleanup)

    resp = await client.get("/api/tickets", headers=h_sup)
    assert resp.status_code == 200
    body = resp.json()
    ids = {t["ticket_id"] for t in body["tickets"]}
    assert {t1["ticket_id"], t2["ticket_id"]} <= ids
    assert body["total"] == 2


async def test_engineer_ve_solo_suyos(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    h_eng = await _auth(client, ENGINEER)
    await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    propio = await _crear_ticket(client, h_eng, ENGINEER["email"], cleanup)

    resp = await client.get("/api/tickets", headers=h_eng)
    ids = [t["ticket_id"] for t in resp.json()["tickets"]]
    assert ids == [propio["ticket_id"]]
    assert resp.json()["total"] == 1


async def test_aislamiento_interempresa(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    h_otra = await _auth(client, OTRA_EMPRESA)
    propio = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    await _crear_ticket(client, h_otra, OTRA_EMPRESA["email"], cleanup)

    # El admin de la otra empresa (con history) NO ve el ticket de la empresa 1...
    resp = await client.get("/api/tickets", headers=h_otra)
    ids = [t["ticket_id"] for t in resp.json()["tickets"]]
    assert propio["ticket_id"] not in ids
    # ...ni lo consulta por ID (404 no revelador).
    resp = await client.get(f"/api/tickets/{propio['ticket_id']}", headers=h_otra)
    assert resp.status_code == 404


async def test_filtro_estado_y_validacion_de_params(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    t1 = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    resp = await client.patch(
        f"/api/tickets/{t1['ticket_id']}/estado", json={"estado": "in_progress"}, headers=h_op
    )
    assert resp.status_code == 200

    resp = await client.get("/api/tickets?estado=in_progress", headers=h_op)
    ids = [t["ticket_id"] for t in resp.json()["tickets"]]
    assert ids == [t1["ticket_id"]]

    assert (await client.get("/api/tickets?limit=200", headers=h_op)).status_code == 422
    assert (await client.get("/api/tickets?estado=pending", headers=h_op)).status_code == 422


# =============================================================================
# GET /api/tickets/{id} — detalle con la conversación en vivo (D4)
# =============================================================================

async def test_detalle_con_mensajes_y_visibilidad(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    h_sup = await _auth(client, SUPERVISOR)
    h_tec = await _auth(client, TECNICO)
    u = await _usuario(OPERADOR["email"])

    sid = await _crear_sesion(OPERADOR["email"], cleanup)
    await chat_repository.append_messages(
        sid,
        int(u["usuario_id"]),
        [
            {"role": "user", "content": "¿cómo calibro la prensa?", "timestamp": 1},
            {"role": "assistant", "content": "Según el manual, a 85 Nm.", "timestamp": 2},
        ],
    )
    resp = await client.post("/api/tickets", json={"session_id": sid}, headers=h_op)
    assert resp.status_code == 201, resp.text
    ticket = resp.json()
    cleanup["tickets"].append(ticket["ticket_id"])

    # Dueño: ticket + mensajes actuales de la sesión (vista en vivo, sin snapshot).
    resp = await client.get(f"/api/tickets/{ticket['ticket_id']}", headers=h_op)
    assert resp.status_code == 200
    body = resp.json()
    assert body["session_id"] == sid
    assert [m["role"] for m in body["messages"]] == ["user", "assistant"]
    assert body["messages"][0]["content"] == "¿cómo calibro la prensa?"

    # Supervisor (history): ve el detalle ajeno con la conversación completa.
    resp = await client.get(f"/api/tickets/{ticket['ticket_id']}", headers=h_sup)
    assert resp.status_code == 200
    assert len(resp.json()["messages"]) == 2

    # Técnico sin history: 404 no revelador (GET y PATCH).
    assert (await client.get(f"/api/tickets/{ticket['ticket_id']}", headers=h_tec)).status_code == 404
    resp = await client.patch(
        f"/api/tickets/{ticket['ticket_id']}/estado", json={"estado": "in_progress"}, headers=h_tec
    )
    assert resp.status_code == 404


# =============================================================================
# PATCH /api/tickets/{id}/estado — máquina de estados y roles (D2)
# =============================================================================

async def test_dueño_avanza_y_resuelve(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    ticket = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    tid = ticket["ticket_id"]

    resp = await client.patch(f"/api/tickets/{tid}/estado", json={"estado": "in_progress"}, headers=h_op)
    assert resp.status_code == 200
    assert resp.json()["estado"] == "in_progress"
    # Dueño operador en in_progress: puede avanzar a resolved, NO cancelar (D2).
    assert resp.json()["allowed_transitions"] == ["resolved"]

    resp = await client.patch(f"/api/tickets/{tid}/estado", json={"estado": "resolved"}, headers=h_op)
    assert resp.status_code == 200
    assert resp.json()["resolved_at"] is not None
    assert resp.json()["allowed_transitions"] == []  # estado final


async def test_transicion_invalida_409(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    ticket = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    # open no puede saltar directo a resolved (máquina de estados).
    resp = await client.patch(
        f"/api/tickets/{ticket['ticket_id']}/estado", json={"estado": "resolved"}, headers=h_op
    )
    assert resp.status_code == 409


async def test_dueño_no_puede_cancelar_403(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    ticket = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    resp = await client.patch(
        f"/api/tickets/{ticket['ticket_id']}/estado", json={"estado": "cancelled"}, headers=h_op
    )
    assert resp.status_code == 403


async def test_supervisor_cancela_ticket_ajeno(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    h_sup = await _auth(client, SUPERVISOR)
    ticket = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)

    resp = await client.patch(
        f"/api/tickets/{ticket['ticket_id']}/estado", json={"estado": "cancelled"}, headers=h_sup
    )
    assert resp.status_code == 200
    assert resp.json()["estado"] == "cancelled"
    assert resp.json()["allowed_transitions"] == []


async def test_estado_fuera_de_enum_422(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    ticket = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)
    resp = await client.patch(
        f"/api/tickets/{ticket['ticket_id']}/estado", json={"estado": "pending"}, headers=h_op
    )
    assert resp.status_code == 422


# =============================================================================
# Relación ticket-sesión: DELETE de sesión con ticket (CGBIDA-288)
# =============================================================================

async def test_borrar_sesion_con_ticket_409(client, cleanup):
    h_op = await _auth(client, OPERADOR)
    ticket = await _crear_ticket(client, h_op, OPERADOR["email"], cleanup)

    resp = await client.delete(f"/api/chat/sessions/{ticket['session_id']}", headers=h_op)
    assert resp.status_code == 409
    assert "ticket" in resp.json()["detail"]

    # Sin la fila del ticket, la sesión SÍ se puede borrar: el registro que
    # protege la trazabilidad es el ticket (v1 no expone DELETE de tickets).
    await execute("DELETE FROM ticket WHERE ticket_id = %(id)s", {"id": ticket["ticket_id"]})
    cleanup["tickets"].remove(ticket["ticket_id"])
    resp = await client.delete(f"/api/chat/sessions/{ticket['session_id']}", headers=h_op)
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    cleanup["sesiones"].remove(ticket["session_id"])
