"""
Tests del semáforo operacional simplificado (CGBIDA-520).

El rediseño del dashboard redujo el semáforo a DOS señales:
  - OTs estancadas (vencidas o demoradas), y
  - cumplimiento de SLA.

Se prueba la aritmética con la función pura y el contrato del endpoint.
La regla que se conserva: **no se pinta verde si hay trabajo atrasado**.
"""

from __future__ import annotations

from barb.routers.stats import (
    AMARILLO,
    ROJO,
    SALUD_SLA_ROJO,
    SALUD_SLA_VERDE,
    VERDE,
    _semaforo_operacional,
)

GERENTE_E1 = ("gerente1@planta.com", "gerente123")
RUTA = "/api/stats/financial-impact"


# =============================================================================
# Aritmética del semáforo
# =============================================================================

class TestSemaforo:
    def test_verde_cuando_no_hay_nada_atrasado(self):
        s = _semaforo_operacional(sla=97.0, estancadas=0, vencidas=0)
        assert s["estado"] == VERDE
        assert "Sin OTs vencidas" in s["motivo"]

    def test_amarillo_con_ot_demorada(self):
        s = _semaforo_operacional(sla=97.0, estancadas=2, vencidas=0)
        assert s["estado"] == AMARILLO
        assert "demorada" in s["motivo"].lower()

    def test_amarillo_con_sla_bajo_el_objetivo(self):
        s = _semaforo_operacional(sla=SALUD_SLA_VERDE - 1, estancadas=0, vencidas=0)
        assert s["estado"] == AMARILLO

    def test_rojo_con_una_ot_vencida(self):
        s = _semaforo_operacional(sla=99.0, estancadas=1, vencidas=1)
        assert s["estado"] == ROJO
        assert "vencida" in s["motivo"].lower()

    def test_rojo_con_sla_bajo_el_piso(self):
        s = _semaforo_operacional(sla=SALUD_SLA_ROJO - 1, estancadas=0, vencidas=0)
        assert s["estado"] == ROJO
        assert "piso" in s["motivo"].lower()

    def test_lo_vencido_pesa_mas_que_lo_demorado(self):
        """Una vencida es rojo aunque haya muchas demoradas."""
        s = _semaforo_operacional(sla=99.0, estancadas=5, vencidas=1)
        assert s["estado"] == ROJO

    def test_devuelve_los_valores_que_uso(self):
        s = _semaforo_operacional(sla=91.5, estancadas=3, vencidas=1)
        assert s["sla"] == 91.5
        assert s["estancadas"] == 3
        assert s["vencidas"] == 1
        assert s["motivo"]


# =============================================================================
# Contrato del endpoint
# =============================================================================

async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _stats(client, qs: str = "") -> dict:
    h = await _login(client, GERENTE_E1)
    r = await client.get(f"{RUTA}{qs}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_el_endpoint_devuelve_el_semaforo_simple(client):
    s = (await _stats(client))["salud_operacional"]
    assert set(s) == {"estado", "motivo", "sla", "estancadas", "vencidas"}, sorted(s)
    assert s["estado"] in {VERDE, AMARILLO, ROJO}


async def test_el_sla_del_semaforo_coincide_con_el_kpi(client):
    """El semáforo no calcula su propio SLA: reusa el del KPI."""
    d = await _stats(client)
    assert d["salud_operacional"]["sla"] == d["financials"]["efficiency"]


async def test_el_motivo_no_esta_vacio(client):
    s = (await _stats(client))["salud_operacional"]
    assert isinstance(s["motivo"], str) and s["motivo"].strip()
