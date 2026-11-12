"""Filtros de topología en los endpoints de stats (CGBIDA-550).

Los dos endpoints del Dashboard aceptan `planta_id`, `disciplina_id` y `maquina_id`.
Estos tests fijan tres cosas:

1. el filtro **acota de verdad** los KPIs (se comparan contra un COUNT hecho aparte, no
   contra la propia consulta del endpoint, para que la prueba no sea tautológica);
2. las listas por máquina (Top 5 por volumen, por costo y los "peores" por MTTR/MTBF)
   respetan el filtro — si no, el panel mostraría equipos fuera de la planta elegida;
3. un id de **otra empresa** no devuelve datos: 404, no un cero silencioso.
"""

from __future__ import annotations

import pytest

from barb.core.db import fetch_one

GERENTE_E1 = ("gerente1@planta.com", "gerente123")
GERENTE_E2 = ("gerente@mineranorte.cl", "minera123")

EMPRESA_E2 = 2


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _ots(where: str, params: dict) -> int:
    """Cuenta OTs con el mismo camino de siempre: OT -> máquina -> planta."""
    fila = await fetch_one(
        f"""
        SELECT COUNT(*) AS n
          FROM orden_trabajo ot
          JOIN maquina m ON m.maquina_id = ot.maquina_id
          JOIN planta p ON p.planta_id = m.planta_id
         WHERE {where}
        """,
        params,
    )
    return int(fila["n"])


async def _ids_de_maquinas_de_la_planta(planta_id: int) -> set[int]:
    filas = await fetch_one(
        "SELECT array_agg(maquina_id) AS ids FROM maquina WHERE planta_id = %(p)s",
        {"p": planta_id},
    )
    return set(filas["ids"] or [])


def _suma_por_tipo(datos: dict) -> int:
    """La dona por tipo suma exactamente las OTs del alcance consultado."""
    return sum(int(t["total"]) for t in datos["por_tipo"])


# =============================================================================
# El filtro acota los KPIs
# =============================================================================


@pytest.mark.asyncio
async def test_filtro_por_planta_acota_los_kpis(client, db_pool):
    h = await _login(client, GERENTE_E2)

    sin_filtro = (await client.get("/api/stats/financial-impact", headers=h)).json()
    planta = 4  # Faena Chancado Norte (empresa 2)
    con_filtro = (
        await client.get(f"/api/stats/financial-impact?planta_id={planta}", headers=h)
    ).json()

    total_empresa = await _ots("p.empresa_id = %(e)s", {"e": EMPRESA_E2})
    total_planta = await _ots("m.planta_id = %(p)s", {"p": planta})

    assert _suma_por_tipo(sin_filtro) == total_empresa
    assert _suma_por_tipo(con_filtro) == total_planta
    assert total_planta < total_empresa, "el seed debería tener más OTs que las de una planta"


@pytest.mark.asyncio
async def test_filtro_por_maquina_acota_los_kpis(client, db_pool):
    h = await _login(client, GERENTE_E2)
    fila = await fetch_one(
        "SELECT maquina_id FROM maquina WHERE planta_id = 4 ORDER BY maquina_id LIMIT 1"
    )
    maquina = int(fila["maquina_id"])

    datos = (
        await client.get(f"/api/stats/financial-impact?maquina_id={maquina}", headers=h)
    ).json()

    esperado = await _ots("m.maquina_id = %(m)s", {"m": maquina})
    assert _suma_por_tipo(datos) == esperado


@pytest.mark.asyncio
async def test_filtro_por_disciplina_acota_los_kpis(client, db_pool):
    h = await _login(client, GERENTE_E2)
    fila = await fetch_one(
        """
        SELECT m.disciplina_id AS d
          FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = %(e)s AND m.disciplina_id IS NOT NULL
         LIMIT 1
        """,
        {"e": EMPRESA_E2},
    )
    disciplina = int(fila["d"])

    datos = (
        await client.get(f"/api/stats/financial-impact?disciplina_id={disciplina}", headers=h)
    ).json()

    esperado = await _ots("m.disciplina_id = %(d)s AND p.empresa_id = %(e)s",
                          {"d": disciplina, "e": EMPRESA_E2})
    assert _suma_por_tipo(datos) == esperado


@pytest.mark.asyncio
async def test_sin_filtros_la_respuesta_mantiene_su_forma(client, db_pool):
    """Los filtros son opcionales: sin ellos la respuesta trae las mismas claves."""
    h = await _login(client, GERENTE_E2)
    datos = (await client.get("/api/stats/financial-impact", headers=h)).json()
    for clave in (
        "financials",
        "impacto_anual",
        "salud_operacional",
        "por_tipo",
        "machines",
        "machines_por_costo",
        "top_5_peor_mttr",
        "top_5_peor_mtbf",
        "trend14Days",
        "estancadas",
    ):
        assert clave in datos, f"falta {clave} en la respuesta"


# =============================================================================
# Las listas por máquina respetan el filtro
# =============================================================================


@pytest.mark.asyncio
async def test_las_listas_por_maquina_respetan_el_filtro(client, db_pool):
    """Top 5 por volumen, por costo y los peores por MTTR/MTBF: todos de la planta."""
    h = await _login(client, GERENTE_E2)
    planta = 4
    esperadas = await _ids_de_maquinas_de_la_planta(planta)
    assert esperadas, "la planta de prueba debería tener máquinas"

    datos = (
        await client.get(f"/api/stats/financial-impact?planta_id={planta}", headers=h)
    ).json()

    for lista in ("machines", "machines_por_costo", "top_5_peor_mttr", "top_5_peor_mtbf"):
        ids = {int(m["id"]) for m in datos[lista]}
        assert ids <= esperadas, f"{lista} trajo máquinas de otra planta: {ids - esperadas}"


# =============================================================================
# Un filtro de otra empresa no devuelve datos: 404
# =============================================================================


@pytest.mark.asyncio
async def test_planta_de_otra_empresa_da_404(client, db_pool):
    h = await _login(client, GERENTE_E2)
    # La planta 1 es de la empresa 1 (Planta Central San Bernardo).
    r = await client.get("/api/stats/financial-impact?planta_id=1", headers=h)
    assert r.status_code == 404, r.text
    assert "no existe en tu empresa" in r.json()["detail"]


@pytest.mark.asyncio
async def test_maquina_de_otra_empresa_da_404(client, db_pool):
    h = await _login(client, GERENTE_E2)
    fila = await fetch_one(
        """
        SELECT m.maquina_id AS id FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = 1 ORDER BY m.maquina_id LIMIT 1
        """
    )
    r = await client.get(f"/api/stats/financial-impact?maquina_id={int(fila['id'])}", headers=h)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_disciplina_de_otra_empresa_da_404(client, db_pool):
    h = await _login(client, GERENTE_E2)
    fila = await fetch_one(
        "SELECT disciplina_id AS id FROM disciplina WHERE empresa_id = 1"
        " AND disciplina_id NOT IN (SELECT COALESCE(disciplina_id, 0) FROM disciplina WHERE empresa_id = %(e)s)"
        " LIMIT 1",
        {"e": EMPRESA_E2},
    )
    if fila is None:  # las disciplinas podrían estar compartidas; se salta sin ruido
        pytest.skip("no hay una disciplina exclusiva de la empresa 1")
    r = await client.get(f"/api/stats/financial-impact?disciplina_id={int(fila['id'])}", headers=h)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_la_empresa_1_ve_sus_propias_plantas(client, db_pool):
    """Contraprueba: el filtro no bloquea lo legítimo."""
    h = await _login(client, GERENTE_E1)
    fila = await fetch_one(
        "SELECT p.planta_id AS id FROM planta p WHERE p.empresa_id = 1 ORDER BY p.planta_id LIMIT 1"
    )
    r = await client.get(f"/api/stats/financial-impact?planta_id={int(fila['id'])}", headers=h)
    assert r.status_code == 200, r.text


# =============================================================================
# El endpoint histórico también
# =============================================================================


@pytest.mark.asyncio
async def test_historico_respeta_el_filtro_por_planta(client, db_pool):
    h = await _login(client, GERENTE_E2)
    planta = 4

    datos = (
        await client.get(
            f"/api/stats/historical?planta_id={planta}&granularity=month", headers=h
        )
    ).json()

    esperado = await _ots("m.planta_id = %(p)s", {"p": planta})
    assert sum(int(p["total_ots"]) for p in datos["periods"]) == esperado


@pytest.mark.asyncio
async def test_historico_planta_ajena_da_404(client, db_pool):
    h = await _login(client, GERENTE_E2)
    r = await client.get("/api/stats/historical?planta_id=1", headers=h)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_los_tres_filtros_juntos(client, db_pool):
    """Combinación completa: planta + disciplina + máquina de esa planta."""
    h = await _login(client, GERENTE_E2)
    fila = await fetch_one(
        """
        SELECT m.maquina_id AS m, m.planta_id AS p, m.disciplina_id AS d
          FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = %(e)s AND m.disciplina_id IS NOT NULL
         ORDER BY m.maquina_id LIMIT 1
        """,
        {"e": EMPRESA_E2},
    )
    datos = (
        await client.get(
            "/api/stats/financial-impact"
            f"?planta_id={int(fila['p'])}&disciplina_id={int(fila['d'])}"
            f"&maquina_id={int(fila['m'])}",
            headers=h,
        )
    ).json()
    esperado = await _ots("m.maquina_id = %(m)s", {"m": int(fila["m"])})
    assert _suma_por_tipo(datos) == esperado
