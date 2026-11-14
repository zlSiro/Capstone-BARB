"""
Tests de la serie histórica y de las métricas nuevas del rediseño (CGBIDA-515/516/517/519).

Cubre tres cosas:
  1. La aritmética de la disponibilidad y de las horas por período.
  2. El contrato de `GET /api/stats/historical` para las tres granularidades.
  3. Las dos listas de Top 5 y la disponibilidad dentro de `financial-impact`.
"""

from __future__ import annotations

from datetime import datetime

from barb.routers.stats import (
    GRANULARIDADES,
    _disponibilidad,
    _horas_del_periodo,
    _periodo_sql,
)

# El dashboard es de consulta del GERENTE desde el rediseño de roles (f32a4c3,
# HU-12/502): `admin` quedó con la ruta `dashboard` en False y recibía 403.
# Por eso estos tests entran como gerente de la empresa 1.
GERENTE_E1 = ("gerente@mineradelnorte.cl", "mineria123")
HIST = "/api/stats/historical"
FIN = "/api/stats/financial-impact"


# =============================================================================
# Disponibilidad de planta
# =============================================================================

class TestDisponibilidad:
    def test_sin_inactividad_es_100(self):
        assert _disponibilidad(720.0, 0.0) == 100.0

    def test_mitad_del_tiempo_caido_es_50(self):
        # 10 h de período, 300 min (5 h) de inactividad
        assert _disponibilidad(10.0, 300.0) == 50.0

    def test_horas_cero_no_divide_por_cero(self):
        assert _disponibilidad(0.0, 10.0) == 100.0

    def test_downtime_mayor_al_periodo_se_acota_a_cero(self):
        # dato sucio: 10 h de inactividad en un período de 1 h
        assert _disponibilidad(1.0, 600.0) == 0.0


# =============================================================================
# Horas y SQL por período
# =============================================================================

class TestPeriodos:
    def test_horas_de_un_mes(self):
        assert _horas_del_periodo(datetime(2026, 1, 1), "month") == 31 * 24

    def test_horas_de_un_mes_de_30(self):
        assert _horas_del_periodo(datetime(2026, 4, 1), "month") == 30 * 24

    def test_horas_del_primer_semestre(self):
        assert _horas_del_periodo(datetime(2026, 1, 1), "semester") == (31 + 28 + 31 + 30 + 31 + 30) * 24

    def test_horas_del_segundo_semestre(self):
        assert _horas_del_periodo(datetime(2026, 7, 1), "semester") == (31 + 31 + 30 + 31 + 30 + 31) * 24

    def test_horas_de_anio_bisiesto(self):
        assert _horas_del_periodo(datetime(2024, 1, 1), "year") == 366 * 24

    def test_horas_de_anio_normal(self):
        assert _horas_del_periodo(datetime(2026, 1, 1), "year") == 365 * 24

    def test_el_sql_de_semestre_no_inventa_una_unidad(self):
        sql = _periodo_sql("semester")
        assert "date_trunc('year'" in sql
        assert "6" in sql

    def test_el_sql_de_mes_y_anio(self):
        assert _periodo_sql("month") == "date_trunc('month', ot.fecha_creacion)"
        assert _periodo_sql("year") == "date_trunc('year', ot.fecha_creacion)"


# =============================================================================
# Contrato del endpoint histórico
# =============================================================================

async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _historico(client, qs: str = "") -> dict:
    h = await _login(client, GERENTE_E1)
    r = await client.get(f"{HIST}{qs}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_devuelve_periodos_en_las_tres_granularidades(client):
    for g in GRANULARIDADES:
        d = await _historico(client, f"?granularity={g}")
        assert d["granularity"] == g
        assert isinstance(d["periods"], list)
        assert d["periods"], f"sin períodos para {g}"


async def test_cada_periodo_trae_las_metricas_del_grafico(client):
    d = await _historico(client, "?granularity=month")
    p = d["periods"][0]
    for campo in (
        "periodo",
        "etiqueta",
        "total_ots",
        "completadas",
        "sla",
        "mttr",
        "mtbf_hours",
        "fallas",
        "horas_periodo",
        "disponibilidad",
    ):
        assert campo in p, f"falta {campo}"
    assert 0 <= p["sla"] <= 100
    assert 0 <= p["disponibilidad"] <= 100
    assert p["horas_periodo"] > 0
    assert p["etiqueta"]


async def test_los_periodos_vienen_ordenados(client):
    d = await _historico(client, "?granularity=month")
    fechas = [p["periodo"] for p in d["periods"]]
    assert fechas == sorted(fechas)


async def test_el_mtbf_del_periodo_solo_aparece_con_dos_fallas(client):
    d = await _historico(client, "?granularity=month")
    for p in d["periods"]:
        if p["fallas"] < 2:
            assert p["mtbf_hours"] is None, p
        else:
            assert p["mtbf_hours"] is not None, p


async def test_granularidad_invalida_da_422(client):
    h = await _login(client, GERENTE_E1)
    r = await client.get(f"{HIST}?granularity=week", headers=h)
    assert r.status_code == 422


# =============================================================================
# Contrato nuevo de financial-impact
# =============================================================================

async def _financial(client) -> dict:
    h = await _login(client, GERENTE_E1)
    r = await client.get(FIN, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_el_financial_impact_trae_las_dos_listas_de_top_5(client):
    d = await _financial(client)
    assert isinstance(d["top_5_peor_mttr"], list)
    assert isinstance(d["top_5_peor_mtbf"], list)
    assert len(d["top_5_peor_mttr"]) <= 5
    assert len(d["top_5_peor_mtbf"]) <= 5
    for m in d["top_5_peor_mttr"]:
        assert {"id", "name", "mttr", "completadas"} <= set(m)
    for m in d["top_5_peor_mtbf"]:
        assert {"id", "name", "mtbf_hours", "fallas"} <= set(m)


async def test_el_peor_mttr_viene_ordenado_de_mayor_a_menor(client):
    d = await _financial(client)
    valores = [m["mttr"] for m in d["top_5_peor_mttr"]]
    assert valores == sorted(valores, reverse=True)


async def test_el_peor_mtbf_viene_ordenado_de_menor_a_mayor(client):
    d = await _financial(client)
    valores = [m["mtbf_hours"] for m in d["top_5_peor_mtbf"]]
    assert valores == sorted(valores)


async def test_el_peor_mtbf_solo_incluye_maquinas_con_dos_fallas(client):
    d = await _financial(client)
    for m in d["top_5_peor_mtbf"]:
        assert m["fallas"] >= 2, m


async def test_el_financial_impact_trae_la_disponibilidad(client):
    d = await _financial(client)
    disp = d["financials"]["disponibilidad_planta"]
    assert isinstance(disp, (int, float))
    assert 0.0 <= disp <= 100.0


async def test_el_ahorro_sigue_presente_por_compatibilidad(client):
    """La UI aún no migró: el campo viejo no puede desaparecer en este paso."""
    d = await _financial(client)
    assert "ahorro_generado" in d["financials"]
