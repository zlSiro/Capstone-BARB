"""Tests de integración del cambio de estado de OT: PATCH /api/work-orders/{numero_ot}/status."""
from __future__ import annotations

import pytest

from barb.core.db import execute, fetch_all, fetch_one

ADMIN = {"email": "admin@mineradelnorte.cl", "password": "mineria123"}
SUPERVISOR = {"email": "supervisor@mineradelnorte.cl", "password": "mineria123"}
ENGINEER = {"email": "engineer@mineradelnorte.cl", "password": "mineria123"}
TECNICO = {"email": "tecnico1@mineradelnorte.cl", "password": "mineria123"}
OPERADOR = {"email": "operador@mineradelnorte.cl", "password": "mineria123"}
GERENTE = {"email": "gerente@mineradelnorte.cl", "password": "mineria123"}
TECNICO_AJENO = {"email": "tecnico2@mineradelnorte.cl", "password": "mineria123"}
OTRA_EMPRESA = {"email": "supervisor@alimentos.cl", "password": "alimentos123"}

MARCA = "Test HU-09"


async def _auth(client, creds: dict) -> dict:
    resp = await client.post("/api/auth/login", json=creds)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture
async def ot(client):
    """Crea una OT pendiente (como supervisor, el único rol que crea OT directas) y la elimina al terminar."""
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


async def _patch(client, creds, numero_ot, status, **extra):
    headers = await _auth(client, creds)
    return await client.patch(f"/api/work-orders/{numero_ot}/status", json={"status": status, **extra}, headers=headers)


async def test_flujo_completo_con_doble_validacion(client, ot):
    """pendiente -> en curso (supervisor) -> por validar (técnico asignado) -> cerrada (supervisor)."""
    resp = await _patch(client, SUPERVISOR, ot, "in_progress")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["estado"] == "in_progress"
    assert data["fecha_inicio"] is not None
    assert data["fecha_cierre"] is None
    assert data["allowed_transitions"] == ["por_validar", "cancelled"]

    resp = await _patch(client, TECNICO, ot, "por_validar", comment="Trabajo terminado, listo para revisar")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["estado"] == "por_validar"
    assert data["status"] == "Pending Validation"
    assert data["fecha_cierre"] is None, "por validar todavía no es un cierre"
    assert data["allowed_transitions"] == []  # el técnico no valida

    resp = await _patch(client, SUPERVISOR, ot, "completed", comment="Revisado y conforme")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["estado"] == "completed"
    assert data["status"] == "Closed"
    assert data["fecha_cierre"] is not None
    assert data["allowed_transitions"] == []


async def test_cambio_queda_auditado_con_usuario_y_timestamp(client, ot):
    await _patch(client, SUPERVISOR, ot, "in_progress", comment="Se inicia el trabajo")
    resp = await _patch(client, SUPERVISOR, ot, "por_validar")

    history = resp.json()["status_history"]
    assert [h["to_status"] for h in history] == ["por_validar", "in_progress"]  # más reciente primero
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
    # El técnico de la fixture es el asignado a la OT: puede iniciarla, nada más.
    assert pick(tec)["allowed_transitions"] == ["in_progress"]


async def test_cancelar_desde_pendiente(client, ot):
    resp = await _patch(client, SUPERVISOR, ot, "cancelled", comment="Duplicada")
    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "cancelled"


@pytest.mark.parametrize("creds", [TECNICO_AJENO, OPERADOR])
async def test_tecnico_ajeno_y_operador_no_cambian_estado(client, ot, creds):
    resp = await _patch(client, creds, ot, "in_progress")
    assert resp.status_code == 403
    estado = await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot})
    assert estado["estado"] == "pending"


async def test_el_tecnico_asignado_puede_iniciar_su_ot(client, ot):
    resp = await _patch(client, TECNICO, ot, "in_progress", comment="Llegué a la máquina")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["estado"] == "in_progress" and data["fecha_inicio"] is not None
    assert data["allowed_transitions"] == ["por_validar"]  # cerrar o cancelar es de supervisión
    assert data["status_history"][0]["user_role"] == "tecnico"


async def test_el_tecnico_asignado_no_puede_cerrar_ni_cancelar(client, ot):
    assert (await _patch(client, TECNICO, ot, "in_progress")).status_code == 200
    assert (await _patch(client, TECNICO, ot, "completed")).status_code == 409  # no existe en_curso -> cerrada
    assert (await _patch(client, TECNICO, ot, "cancelled", comment="No quiero")).status_code == 403
    estado = await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot})
    assert estado["estado"] == "in_progress"


async def test_el_tecnico_no_valida_ni_devuelve_lo_que_envio(client, ot):
    assert (await _patch(client, TECNICO, ot, "in_progress")).status_code == 200
    assert (await _patch(client, TECNICO, ot, "por_validar")).status_code == 200
    assert (await _patch(client, TECNICO, ot, "completed", comment="ok")).status_code == 403
    assert (await _patch(client, TECNICO, ot, "in_progress", comment="vuelvo")).status_code == 403
    assert (await _patch(client, TECNICO, ot, "cancelled", comment="no")).status_code == 403
    estado = await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot})
    assert estado["estado"] == "por_validar"


async def test_un_tecnico_ajeno_no_envia_a_validacion(client, ot):
    assert (await _patch(client, SUPERVISOR, ot, "in_progress")).status_code == 200
    resp = await _patch(client, TECNICO_AJENO, ot, "por_validar")
    assert resp.status_code == 403
    assert "técnico asignado" in resp.json()["detail"]


async def test_el_supervisor_tambien_puede_enviar_a_validacion(client, ot):
    assert (await _patch(client, SUPERVISOR, ot, "in_progress")).status_code == 200
    assert (await _patch(client, SUPERVISOR, ot, "por_validar")).status_code == 200


async def test_el_supervisor_que_envio_a_validacion_tambien_puede_validarla(client, ot):
    """Una empresa con un solo supervisor debe poder cerrar lo que ese supervisor envió: no hay bloqueo de autovalidación."""
    assert (await _patch(client, SUPERVISOR, ot, "in_progress")).status_code == 200
    resp = await _patch(client, SUPERVISOR, ot, "por_validar")
    assert resp.status_code == 200, resp.text
    assert resp.json()["allowed_transitions"] == ["completed", "in_progress", "cancelled"]

    resp = await _patch(client, SUPERVISOR, ot, "completed", comment="Revisado y conforme")
    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "completed" and resp.json()["fecha_cierre"] is not None


async def test_devolver_exige_comentario_y_vuelve_a_en_curso(client, ot):
    assert (await _patch(client, TECNICO, ot, "in_progress")).status_code == 200
    assert (await _patch(client, TECNICO, ot, "por_validar")).status_code == 200
    for comentario in ({}, {"comment": ""}, {"comment": "   "}):
        resp = await _patch(client, SUPERVISOR, ot, "in_progress", **comentario)
        assert resp.status_code == 422, comentario
    assert (await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot}))["estado"] == "por_validar"

    resp = await _patch(client, SUPERVISOR, ot, "in_progress", comment="Falta apretar los pernos")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["estado"] == "in_progress"
    assert data["status_history"][0]["comment"] == "Falta apretar los pernos"
    assert data["allowed_transitions"] == ["por_validar", "cancelled"]


@pytest.mark.parametrize("desde", ["pending", "in_progress", "por_validar"])
async def test_cancelar_exige_motivo_en_cualquier_estado_activo(client, ot, desde):
    if desde != "pending":
        assert (await _patch(client, TECNICO, ot, "in_progress")).status_code == 200
    if desde == "por_validar":
        assert (await _patch(client, TECNICO, ot, "por_validar")).status_code == 200
    for comentario in ({}, {"comment": "  "}):
        assert (await _patch(client, SUPERVISOR, ot, "cancelled", **comentario)).status_code == 422, comentario
    assert (await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot}))["estado"] == desde

    resp = await _patch(client, SUPERVISOR, ot, "cancelled", comment="Equipo dado de baja")
    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "cancelled"
    assert resp.json()["status_history"][0]["comment"] == "Equipo dado de baja"


async def test_el_motivo_obligatorio_no_tapa_un_403(client, ot):
    """Sin permiso se responde 403 aunque falte el comentario: primero se valida quién puede."""
    assert (await _patch(client, OPERADOR, ot, "cancelled")).status_code == 403
    assert (await _patch(client, GERENTE, ot, "cancelled")).status_code == 403


async def test_en_curso_no_se_cierra_directo(client, ot):
    assert (await _patch(client, SUPERVISOR, ot, "in_progress")).status_code == 200
    resp = await _patch(client, SUPERVISOR, ot, "completed", comment="directo")
    assert resp.status_code == 409
    assert "en curso" in resp.json()["detail"].lower()


@pytest.mark.parametrize("creds", [ENGINEER, GERENTE, ADMIN, OPERADOR])
async def test_otros_roles_no_envian_ni_validan_ni_devuelven(client, ot, creds):
    assert (await _patch(client, SUPERVISOR, ot, "in_progress")).status_code == 200
    assert (await _patch(client, creds, ot, "por_validar")).status_code == 403
    assert (await _patch(client, TECNICO, ot, "por_validar")).status_code == 200
    assert (await _patch(client, creds, ot, "completed", comment="ok")).status_code == 403
    assert (await _patch(client, creds, ot, "in_progress", comment="vuelve")).status_code == 403
    assert (await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot}))["estado"] == "por_validar"


async def test_por_validar_cuenta_como_ot_abierta(client, ot):
    """Sigue siendo trabajo abierto para el tablero: no es un estado final y aparece en el listado."""
    from barb.core.work_order_states import ESTADOS_FINALES

    assert "por_validar" not in ESTADOS_FINALES
    assert (await _patch(client, TECNICO, ot, "in_progress")).status_code == 200
    assert (await _patch(client, TECNICO, ot, "por_validar")).status_code == 200
    ots = (await client.get("/api/work-orders", headers=await _auth(client, SUPERVISOR))).json()
    assert next(o for o in ots if o["numero_ot"] == ot)["estado"] == "por_validar"


async def test_un_tecnico_que_no_es_el_asignado_no_puede_iniciarla(client, ot):
    resp = await _patch(client, TECNICO_AJENO, ot, "in_progress")
    assert resp.status_code == 403
    assert "técnico asignado" in resp.json()["detail"]


async def test_operador_y_tecnico_solo_ven_sus_ot(client, ot):
    # El técnico asignado la ve; otro técnico y un operador (que no la reportó) no la ven ni por detalle.
    assert ot in [o["numero_ot"] for o in (await client.get("/api/work-orders", headers=await _auth(client, TECNICO))).json()]
    for creds in (TECNICO_AJENO, OPERADOR):
        h = await _auth(client, creds)
        assert ot not in [o["numero_ot"] for o in (await client.get("/api/work-orders", headers=h)).json()]
        assert (await client.get(f"/api/work-orders/{ot}", headers=h)).status_code == 404
    # Supervisión sigue viendo todas.
    h = await _auth(client, SUPERVISOR)
    assert ot in [o["numero_ot"] for o in (await client.get("/api/work-orders", headers=h)).json()]


async def test_el_admin_ya_no_cambia_estados(client, ot):
    assert (await _patch(client, ADMIN, ot, "in_progress")).status_code == 403


async def test_engineer_y_gerente_consultan_pero_no_cambian_estados(client, ot):
    for creds in (ENGINEER, GERENTE):
        assert (await _patch(client, creds, ot, "in_progress")).status_code == 403
        assert (await _patch(client, creds, ot, "cancelled", comment="no")).status_code == 403
    assert (await fetch_one("SELECT estado FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot}))["estado"] == "pending"


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
        await _patch(client, TECNICO, ot, "in_progress")
        await _patch(client, TECNICO, ot, "por_validar")
        assert (await _patch(client, SUPERVISOR, ot, "completed", comment="Conforme")).status_code == 200
    else:
        assert (await _patch(client, SUPERVISOR, ot, "cancelled", comment="Duplicada")).status_code == 200
    assert (await _patch(client, SUPERVISOR, ot, "in_progress", comment="reabrir")).status_code == 409


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
    """Un supervisor de otra empresa (con permiso para cambiar estados en la suya) no ve la OT: 404."""
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
    resp = await client.patch(f"/api/work_orders/{ot}/status", json={"status": "por_validar"}, headers=headers)
    assert resp.status_code == 200
