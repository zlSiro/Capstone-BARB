"""KPIs financieros del dashboard (acción `ver_kpis_financieros`): solo el gerente los recibe.

Supervisor e ingeniero ven el dashboard con los KPIs operativos intactos, pero el backend omite (no pone en cero) todo
lo que entrega costos o impacto económico. El admin ya no entra al dashboard.
"""
from __future__ import annotations

import pytest

from barb.core.permissions import ACCIONES, ROLES

RUTA = "/api/stats/financial-impact"
GERENTE = ("gerente@mineradelnorte.cl", "mineria123")
SUPERVISOR = ("supervisor@mineradelnorte.cl", "mineria123")
ENGINEER = ("engineer@mineradelnorte.cl", "mineria123")
ADMIN = ("admin@mineradelnorte.cl", "mineria123")
OPERADOR = ("operador@mineradelnorte.cl", "mineria123")

CAMPOS_FINANCIEROS_EN_FINANCIALS = {"ahorro_generado", "costo_total_acumulado"}
CAMPOS_FINANCIEROS_POR_MAQUINA = {"ahorroGenerado", "costo_total"}
CLAVES_OPERATIVAS = {"financials", "trend14Days", "machines", "por_tipo", "estancadas", "salud_operacional"}
OPERATIVOS_EN_FINANCIALS = {"mttr", "efficiency", "mtbfHours", "mtbf_visible"}
OPERATIVOS_POR_MAQUINA = {"id", "name", "total", "mttr", "slaCompliance"}


async def _get(client, creds, qs: str = ""):
    login = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert login.status_code == 200, login.text
    return await client.get(f"{RUTA}{qs}", headers={"Authorization": f"Bearer {login.json()['token']}"})


def test_solo_el_gerente_tiene_la_accion():
    assert [r for r in ROLES if ACCIONES["ver_kpis_financieros"][r]] == ["gerente"]


async def test_el_gerente_recibe_los_campos_financieros(client):
    d = (await _get(client, GERENTE)).json()
    assert d["financieros_visibles"] is True
    assert CAMPOS_FINANCIEROS_EN_FINANCIALS <= set(d["financials"])
    assert {"impacto_anual", "machines_por_costo"} <= set(d)
    assert d["machines"] and all(CAMPOS_FINANCIEROS_POR_MAQUINA <= set(m) for m in d["machines"])


@pytest.mark.parametrize("creds", [SUPERVISOR, ENGINEER])
async def test_supervisor_e_ingeniero_reciben_los_kpis_operativos_sin_ningun_campo_de_costo(client, creds):
    resp = await _get(client, creds)
    assert resp.status_code == 200, resp.text
    d = resp.json()
    assert d["financieros_visibles"] is False
    assert CLAVES_OPERATIVAS <= set(d)
    assert not ({"impacto_anual", "machines_por_costo"} & set(d)), "el impacto y el top por costo se omiten"
    assert OPERATIVOS_EN_FINANCIALS <= set(d["financials"])
    assert not (CAMPOS_FINANCIEROS_EN_FINANCIALS & set(d["financials"]))
    assert d["machines"], "debe seguir habiendo ranking operativo"
    for m in d["machines"]:
        assert OPERATIVOS_POR_MAQUINA <= set(m)
        assert not (CAMPOS_FINANCIEROS_POR_MAQUINA & set(m)), m
    # Ninguna cifra de costo se cuela con otro nombre, a ningún nivel.
    assert "costo" not in str(sorted(d["financials"])).lower() and "ahorro" not in str(sorted(d["financials"])).lower()


async def test_los_kpis_operativos_son_los_mismos_para_todos(client):
    """Quitar lo financiero no altera ni un número operativo."""
    g = (await _get(client, GERENTE)).json()
    s = (await _get(client, SUPERVISOR)).json()
    for clave in ("trend14Days", "por_tipo", "estancadas", "salud_operacional"):
        assert g[clave] == s[clave], clave
    for campo in OPERATIVOS_EN_FINANCIALS:
        assert g["financials"][campo] == s["financials"][campo], campo
    assert [{k: m[k] for k in OPERATIVOS_POR_MAQUINA} for m in g["machines"]] == s["machines"]


async def test_el_filtro_de_dias_sigue_funcionando_para_el_supervisor(client):
    resp = await _get(client, SUPERVISOR, "?days=30")
    assert resp.status_code == 200 and resp.json()["financieros_visibles"] is False


@pytest.mark.parametrize("creds", [ADMIN, OPERADOR])
async def test_admin_y_operador_no_entran_al_dashboard(client, creds):
    assert (await _get(client, creds)).status_code == 403
