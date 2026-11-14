"""Correo de OTs atrasadas: lógica de frecuencia/render (unit) y endpoints (integración, BD real)."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from barb.core.config import settings
from barb.core.db import execute, fetch_all, fetch_one
from barb.services import overdue_report
from barb.services.overdue_report import (
    combinar_destinatarios,
    debe_enviar,
    destinatarios_escalamiento,
    render_reporte,
)

TZ = ZoneInfo("America/Santiago")
ADMIN = {"email": "admin@mineradelnorte.cl", "password": "mineria123"}
GERENTE = {"email": "gerente@mineradelnorte.cl", "password": "mineria123"}
SUPERVISOR = {"email": "supervisor@mineradelnorte.cl", "password": "mineria123"}
TECNICO = {"email": "tecnico1@mineradelnorte.cl", "password": "mineria123"}
OTRA_EMPRESA = {"email": "admin@alimentos.cl", "password": "alimentos123"}
MARCA = "Test OT atrasada"
TOKEN = "token-de-prueba"


# =============================================================================
# Unit: frecuencia
# =============================================================================

def _cfg(**kw) -> dict:
    base = {"activo": True, "frecuencia": "diaria", "hora": 8, "dia_semana": None,
            "destinatarios": ["a@x.cl"], "ultimo_envio": None}
    return base | kw


def test_diaria_nunca_enviada_pasada_la_hora():
    assert debe_enviar(_cfg(), datetime(2026, 10, 7, 9, 0, tzinfo=TZ))


def test_diaria_hora_no_alcanzada_usa_slot_de_ayer():
    ahora = datetime(2026, 10, 7, 7, 0, tzinfo=TZ)
    assert debe_enviar(_cfg(ultimo_envio=datetime(2026, 10, 5, 8, 1, tzinfo=TZ)), ahora)
    assert not debe_enviar(_cfg(ultimo_envio=datetime(2026, 10, 6, 8, 1, tzinfo=TZ)), ahora)


def test_diaria_ya_enviada_hoy():
    ahora = datetime(2026, 10, 7, 15, 0, tzinfo=TZ)
    assert not debe_enviar(_cfg(ultimo_envio=datetime(2026, 10, 7, 8, 5, tzinfo=TZ)), ahora)


def test_semanal_solo_una_vez_por_semana():
    # 2026-10-07 es miércoles (weekday 2); programado los lunes (0) a las 8.
    cfg = _cfg(frecuencia="semanal", dia_semana=0)
    ahora = datetime(2026, 10, 7, 12, 0, tzinfo=TZ)
    assert debe_enviar(cfg, ahora)
    assert not debe_enviar(cfg | {"ultimo_envio": datetime(2026, 10, 5, 8, 2, tzinfo=TZ)}, ahora)
    assert debe_enviar(cfg | {"ultimo_envio": datetime(2026, 9, 28, 8, 2, tzinfo=TZ)}, ahora)


def test_inactiva_no_envia():
    assert not debe_enviar(_cfg(activo=False), datetime(2026, 10, 7, 9, 0, tzinfo=TZ))


def test_sin_destinatarios_configurados_igual_toca_enviar_porque_escalan_gerente_y_supervisor():
    assert debe_enviar(_cfg(destinatarios=[]), datetime(2026, 10, 7, 9, 0, tzinfo=TZ))


# =============================================================================
# Unit: escalamiento (destinatarios)
# =============================================================================

def test_combinar_destinatarios_normaliza_y_quita_duplicados_conservando_el_orden():
    assert combinar_destinatarios(["Jefe@Planta.cl", " otro@x.cl "], ["jefe@planta.cl", "", None, "G@x.cl"], None) == [
        "jefe@planta.cl",
        "otro@x.cl",
        "g@x.cl",
    ]
    assert combinar_destinatarios([], None) == []


# =============================================================================
# Unit: render
# =============================================================================

def test_render_incluye_id_maquina_tecnico_y_dias():
    ots = [{"numero_ot": "OT-9", "maquina": "Compresor <1>", "tecnico": "Carlos", "estado": "pending",
            "dias_atraso": 4, "priority": "high", "fecha_vencimiento": None}]
    asunto, html, texto = render_reporte("Acme", ots)
    assert "1 OT atrasada" in asunto and "Acme" in asunto
    for dato in ("OT-9", "Carlos", ">4<"):
        assert dato in html
    assert "Compresor &lt;1&gt;" in html  # escapado
    assert "OT-9 | Compresor <1> | Carlos | 4 día(s) de atraso" in texto


# =============================================================================
# Integración
# =============================================================================

async def _auth(client, creds: dict) -> dict:
    resp = await client.post("/api/auth/login", json=creds)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture
def smtp_falso(monkeypatch):
    """SMTP 'configurado' + send_email capturado (no sale ningún correo real)."""
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_from", "barb@test")
    monkeypatch.setattr(settings, "job_token", TOKEN)
    enviados: list[dict] = []

    async def _fake(to, subject, html, text):
        enviados.append({"to": to, "subject": subject, "html": html, "text": text})

    monkeypatch.setattr(overdue_report, "send_email", _fake)
    return enviados


@pytest.fixture
async def empresa_id(db_pool):
    u = await fetch_one("SELECT empresa_id FROM usuario WHERE email = %(e)s", {"e": SUPERVISOR["email"]})
    yield u["empresa_id"]
    await execute("DELETE FROM notificacion_config WHERE empresa_id = %(e)s", {"e": u["empresa_id"]})
    await execute("DELETE FROM orden_trabajo WHERE descripcion_problema LIKE %(p)s", {"p": f"{MARCA}%"})


async def _crear_ot_atrasada(client, dias: int, estado: str = "pending") -> str:
    maquina = await fetch_one("SELECT maquina_id FROM maquina ORDER BY maquina_id LIMIT 1")
    tecnico = await fetch_one("SELECT usuario_id FROM usuario WHERE rol = 'tecnico' AND activo ORDER BY usuario_id LIMIT 1")
    resp = await client.post(
        "/api/work-orders",
        json={"maquina_id": maquina["maquina_id"], "tecnico_id": tecnico["usuario_id"],
              "descripcion_problema": f"{MARCA} {dias}d {estado}"},
        headers=await _auth(client, SUPERVISOR),
    )
    assert resp.status_code == 200, resp.text
    numero = resp.json()["numero_ot"]
    await execute(
        "UPDATE orden_trabajo SET fecha_vencimiento = NOW() - make_interval(days => %(d)s), estado = %(s)s "
        "WHERE numero_ot = %(n)s",
        {"d": dias, "s": estado, "n": numero},
    )
    return numero


async def test_job_sin_token_o_token_malo(client, smtp_falso):
    assert (await client.post("/api/jobs/ot-atrasadas")).status_code == 401
    assert (await client.post("/api/jobs/ot-atrasadas", headers={"X-Job-Token": "mal"})).status_code == 401


async def test_job_deshabilitado_sin_job_token(client, monkeypatch):
    monkeypatch.setattr(settings, "job_token", "")
    resp = await client.post("/api/jobs/ot-atrasadas", headers={"X-Job-Token": "x"})
    assert resp.status_code == 503


async def test_config_permisos_y_validacion(client, empresa_id):
    tec = await _auth(client, TECNICO)
    assert (await client.get("/api/notificaciones/config", headers=tec)).status_code == 403

    sup = await _auth(client, SUPERVISOR)
    base = {"activo": True, "frecuencia": "diaria", "hora": 8, "destinatarios": ["jefe@planta.cl"]}
    url = "/api/notificaciones/config"
    for malo in ({"destinatarios": ["no-es-email"]}, {"destinatarios": []}, {"frecuencia": "semanal"}):
        assert (await client.put(url, json=base | malo, headers=sup)).status_code == 422

    dup = base | {"destinatarios": ["Jefe@Planta.cl", "jefe@planta.cl"]}
    resp = await client.put(url, json=dup, headers=sup)
    assert resp.status_code == 200, resp.text
    assert resp.json()["destinatarios"] == ["jefe@planta.cl"]
    assert (await client.get("/api/notificaciones/config", headers=sup)).json()["activo"] is True


async def test_config_aislada_por_empresa(client, empresa_id):
    sup = await _auth(client, SUPERVISOR)
    await client.put("/api/notificaciones/config",
                     json={"activo": True, "frecuencia": "diaria", "hora": 8, "destinatarios": ["jefe@planta.cl"]}, headers=sup)
    otra = await _auth(client, OTRA_EMPRESA)
    # Aunque pida la empresa ajena, se ignora y se usa la suya.
    resp = await client.get(f"/api/notificaciones/config?empresa_id={empresa_id}", headers=otra)
    assert resp.status_code == 200
    assert resp.json()["empresa_id"] != empresa_id
    assert resp.json()["destinatarios"] == []


async def test_job_envia_solo_abiertas_con_vencimiento_y_es_idempotente(client, empresa_id, smtp_falso):
    ot_5 = await _crear_ot_atrasada(client, 5, "pending")
    ot_9 = await _crear_ot_atrasada(client, 9, "in_progress")
    ot_20 = await _crear_ot_atrasada(client, 20, "completed")  # final: no cuenta
    ot_7 = await _crear_ot_atrasada(client, 7, "por_validar")  # sigue abierta: vencida y esperando validación
    sup = await _auth(client, SUPERVISOR)
    await client.put("/api/notificaciones/config",
                     json={"activo": True, "frecuencia": "diaria", "hora": 0, "destinatarios": ["jefe@planta.cl"]}, headers=sup)

    h = {"X-Job-Token": TOKEN}
    resp = await client.post(f"/api/jobs/ot-atrasadas?empresa_id={empresa_id}", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["enviados"] == 1
    assert len(smtp_falso) == 1
    correo = smtp_falso[0]
    # Los configurados primero; después se suman, sin repetir, los gerentes y supervisores activos de la empresa.
    escalamiento = await destinatarios_escalamiento(empresa_id)
    assert {GERENTE["email"], SUPERVISOR["email"]} <= set(escalamiento)
    assert correo["to"][0] == "jefe@planta.cl"
    assert correo["to"] == combinar_destinatarios(["jefe@planta.cl"], escalamiento)
    assert len(correo["to"]) == len(set(correo["to"])) and all(c == c.lower() for c in correo["to"])

    # El reporte incluye las OTs abiertas y vencidas de la empresa. Se comprueba por
    # identificador y no por los días de atraso: con el historial sintético (CGBIDA-408)
    # la empresa ya tiene otras OTs atrasadas, así que el número de días dejó de ser
    # único y una aserción por texto daría un falso positivo.
    assert ot_5 in correo["text"] and ot_9 in correo["text"]
    assert ot_7 in correo["text"], "una OT por validar y vencida sigue contando como atrasada"
    assert ot_20 not in correo["text"], "una OT final no debe aparecer en el reporte"

    # Y se contrasta contra lo que el propio job considera atrasado para esa empresa.
    from barb.services.overdue_report import fetch_ots_atrasadas

    atrasadas = {o["numero_ot"] for o in await fetch_ots_atrasadas(empresa_id)}
    assert ot_5 in atrasadas and ot_9 in atrasadas and ot_7 in atrasadas
    assert ot_20 not in atrasadas

    # Segunda corrida en el mismo período: no reenvía.
    resp = await client.post(f"/api/jobs/ot-atrasadas?empresa_id={empresa_id}", headers=h)
    assert resp.json()["enviados"] == 0
    assert len(smtp_falso) == 1

    # force ignora la frecuencia.
    resp = await client.post(f"/api/jobs/ot-atrasadas?empresa_id={empresa_id}&force=true", headers=h)
    assert resp.json()["enviados"] == 1


async def test_el_escalamiento_incluye_solo_gerentes_y_supervisores_activos_de_la_empresa(client, empresa_id):
    escalamiento = await destinatarios_escalamiento(empresa_id)
    roles = {
        f["rol"]
        for f in await fetch_all("SELECT rol FROM usuario WHERE email = ANY(%(e)s)", {"e": escalamiento})
    }
    assert roles == {"gerente", "supervisor"}
    assert OTRA_EMPRESA["email"] not in escalamiento, "el admin y las otras empresas no reciben el escalamiento"
    assert TECNICO["email"] not in escalamiento and ADMIN["email"] not in escalamiento

    # Un supervisor desactivado no recibe nada.
    h = await _auth(client, ADMIN)
    resp = await client.post(
        "/api/usuarios",
        json={"nombre": "Sup Inactivo Test", "email": "sup.inactivo.test@planta.cl", "password": "secreto123",
              "rol": "supervisor", "activo": False},
        headers=h,
    )
    assert resp.status_code == 201, resp.text
    try:
        assert "sup.inactivo.test@planta.cl" not in await destinatarios_escalamiento(empresa_id)
    finally:
        await client.delete(f"/api/usuarios/{resp.json()['usuario_id']}", headers=h)


async def test_el_job_escala_aunque_la_lista_configurada_este_vacia(client, empresa_id, smtp_falso):
    """Sin destinatarios cargados la empresa igual avisa a su gerente y a su supervisor."""
    await _crear_ot_atrasada(client, 4, "pending")
    await execute(
        """
        INSERT INTO notificacion_config (empresa_id, activo, frecuencia, hora, destinatarios)
        VALUES (%(e)s, TRUE, 'diaria', 0, ARRAY[]::text[])
        ON CONFLICT (empresa_id) DO UPDATE SET activo = TRUE, destinatarios = ARRAY[]::text[], ultimo_envio = NULL
        """,
        {"e": empresa_id},
    )
    resp = await client.post(f"/api/jobs/ot-atrasadas?empresa_id={empresa_id}", headers={"X-Job-Token": TOKEN})
    assert resp.status_code == 200, resp.text
    assert resp.json()["enviados"] == 1
    assert set(smtp_falso[0]["to"]) == set(await destinatarios_escalamiento(empresa_id))


async def test_empresa_con_la_notificacion_inactiva_no_recibe_escalamiento(client, empresa_id, smtp_falso):
    await _crear_ot_atrasada(client, 4, "pending")
    sup = await _auth(client, SUPERVISOR)
    await client.put("/api/notificaciones/config",
                     json={"activo": False, "frecuencia": "diaria", "hora": 0, "destinatarios": ["jefe@planta.cl"]}, headers=sup)
    resp = await client.post(f"/api/jobs/ot-atrasadas?empresa_id={empresa_id}", headers={"X-Job-Token": TOKEN})
    assert resp.status_code == 200 and resp.json()["enviados"] == 0
    assert smtp_falso == []


async def test_prueba_envia_aunque_no_haya_ots(client, empresa_id, smtp_falso):
    sup = await _auth(client, SUPERVISOR)
    assert (await client.post("/api/notificaciones/prueba", headers=sup)).status_code == 422  # sin destinatarios
    await client.put("/api/notificaciones/config",
                     json={"activo": False, "frecuencia": "diaria", "hora": 8, "destinatarios": ["jefe@planta.cl"]}, headers=sup)
    resp = await client.post("/api/notificaciones/prueba", headers=sup)
    assert resp.status_code == 200, resp.text
    assert resp.json()["enviado"] is True
    assert len(smtp_falso) == 1


async def test_preview_excluye_finales(client, empresa_id):
    sup = await _auth(client, SUPERVISOR)
    antes = (await client.get("/api/notificaciones/preview", headers=sup)).json()["total"]
    await _crear_ot_atrasada(client, 3, "pending")
    await _crear_ot_atrasada(client, 3, "cancelled")  # final: no suma
    data = (await client.get("/api/notificaciones/preview", headers=sup)).json()
    assert data["total"] == antes + 1
    assert all(o["dias_atraso"] >= 1 for o in data["ots"])
    assert all(o["estado"] not in ("completed", "cancelled") for o in data["ots"])
