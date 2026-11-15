"""Granularidades finas del histórico (CGBIDA-550).

El filtro global de rango del Dashboard ofrece 7 y 30 días. Con las granularidades que
había (`month` para arriba) un rango de 30 días caía entero en un único punto del gráfico,
así que se agregaron `day` y `week`. Son aditivas: no tocan ninguna tabla.
"""

from __future__ import annotations

import pytest

from barb.core.db import fetch_one

GERENTE_E2 = ("gerente@mineranorte.cl", "minera123")


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _periodos(client, headers, **params) -> list[dict]:
    query = "&".join(f"{k}={v}" for k, v in params.items())
    r = await client.get(f"/api/stats/historical?{query}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["periods"]


@pytest.mark.asyncio
async def test_granularidad_dia_devuelve_periodos_diarios(client, db_pool):
    """7 días con granularidad `day` debería dar varios puntos, no uno."""
    h = await _login(client, GERENTE_E2)

    # Se usa un año porque el seed no tiene OTs en la última semana: lo que se prueba es
    # que la granularidad diaria produzca varios puntos, no que haya datos recientes.
    periodos = await _periodos(client, h, granularity="day", days=365)

    assert len(periodos) > 1, "un año con granularidad diaria no puede dar un solo punto"
    for p in periodos:
        # La etiqueta de día es ISO: 2026-11-05.
        assert len(p["etiqueta"]) == 10, p["etiqueta"]
        assert "horas_periodo" in p


@pytest.mark.asyncio
async def test_granularidad_semana_agrupa_en_siete_dias(client, db_pool):
    h = await _login(client, GERENTE_E2)

    periodos = await _periodos(client, h, granularity="week", days=90)

    assert periodos, "el seed tiene OTs en los últimos 90 días"
    for p in periodos:
        # Cada balde semanal representa 7 días completos.
        assert p["horas_periodo"] == pytest.approx(7 * 24, rel=1e-6)


@pytest.mark.asyncio
async def test_las_granularidades_nuevas_respetan_el_filtro_de_planta(client, db_pool):
    """El rango no puede romper el filtro de topología: se piden juntos."""
    h = await _login(client, GERENTE_E2)
    planta = 4

    periodos = await _periodos(client, h, granularity="day", days=365, planta_id=planta)
    total = sum(int(p["total_ots"]) for p in periodos)

    esperado = await fetch_one(
        """
        SELECT COUNT(*) AS n FROM orden_trabajo ot
          JOIN maquina m ON m.maquina_id = ot.maquina_id
         WHERE m.planta_id = %(p)s
           AND ot.fecha_creacion >= NOW() - INTERVAL '365 days'
        """,
        {"p": planta},
    )
    assert total == int(esperado["n"])


@pytest.mark.asyncio
async def test_granularidad_invalida_sigue_dando_422(client, db_pool):
    h = await _login(client, GERENTE_E2)
    r = await client.get("/api/stats/historical?granularity=decada", headers=h)
    assert r.status_code == 422, r.text


# =============================================================================
# Bloques de 5 años (CGBIDA-550)
# =============================================================================


@pytest.mark.asyncio
async def test_granularidad_5year_agrupa_en_bloques_de_cinco(client, db_pool):
    """Cada período abarca 5 años y la etiqueta es el rango cerrado."""
    h = await _login(client, GERENTE_E2)

    periodos = await _periodos(client, h, granularity="5year")

    assert periodos, "el seed tiene OTs"
    for p in periodos:
        anio_inicio, anio_fin = p["etiqueta"].split("-")
        assert int(anio_fin) - int(anio_inicio) == 4, p["etiqueta"]
        # Bloques alineados a múltiplos de 5: 2020-2024, 2025-2029, ...
        assert int(anio_inicio) % 5 == 0, p["etiqueta"]
        # El período son 5 años calendario (con bisiestos incluidos).
        assert p["horas_periodo"] in (
            pytest.approx((365 * 5 + 1) * 24),
            pytest.approx((365 * 5 + 2) * 24),
        ), p["horas_periodo"]


@pytest.mark.asyncio
async def test_los_bloques_5year_cubren_todas_las_ots(client, db_pool):
    """Sin ventana, la suma de los bloques es el total de OTs del alcance."""
    h = await _login(client, GERENTE_E2)

    periodos = await _periodos(client, h, granularity="5year")
    total = sum(int(p["total_ots"]) for p in periodos)

    esperado = await fetch_one(
        """
        SELECT COUNT(*) AS n FROM orden_trabajo ot
          JOIN maquina m ON m.maquina_id = ot.maquina_id
          JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = %(e)s
        """,
        {"e": 2},
    )
    assert total == int(esperado["n"])


@pytest.mark.asyncio
async def test_5year_no_repite_un_anio_en_dos_bloques(client, db_pool):
    """Cada OT cae en un solo bloque: no puede haber años solapados."""
    h = await _login(client, GERENTE_E2)

    periodos = await _periodos(client, h, granularity="5year")
    rangos = []
    for p in periodos:
        ini, fin = (int(x) for x in p["etiqueta"].split("-"))
        rangos.append((ini, fin))

    for (ini_a, fin_a), (ini_b, _) in zip(rangos, rangos[1:]):
        assert ini_b > fin_a, f"los bloques {ini_a}-{fin_a} y {ini_b} se solapan"
