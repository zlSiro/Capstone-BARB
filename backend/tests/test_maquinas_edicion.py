"""PATCH /api/maquinas/{id}: edición de máquinas del mantenedor.

Cubre las cuatro cosas que pueden salir mal al editar un equipo: perder campos que no se
enviaron (patch parcial), duplicar el código dentro de la planta, tocar una máquina de otra
empresa, y cargar SLA/costo cuando la base todavía no tiene esas columnas.

Todo lo creado se limpia: la base es compartida con el resto de la suite.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from barb.core.db import execute, fetch_one
from barb.routers import catalog

GERENTE_ID = 2  # gerente de la empresa 1
OTRA_EMPRESA_ID = 17  # gerente de la empresa 2 (tiene permiso sobre `plantas`)


@pytest_asyncio.fixture
async def ctx(db_pool):
    marca = uuid.uuid4().hex[:8]
    tokens: dict[str, dict[str, str]] = {}
    for nombre, uid in (("gerente", GERENTE_ID), ("ajeno", OTRA_EMPRESA_ID)):
        token = f"test-maq-{nombre}-{marca}"
        await execute(
            "INSERT INTO sesion (token, usuario_id, expira_en) "
            "VALUES (%(t)s, %(u)s, NOW() + INTERVAL '10 minutes')",
            {"t": token, "u": uid},
        )
        tokens[nombre] = {"Authorization": f"Bearer {token}"}

    yield {"tokens": tokens, "marca": marca}

    await execute(
        "DELETE FROM maquina WHERE planta_id IN (SELECT planta_id FROM planta WHERE nombre LIKE %(p)s)",
        {"p": f"%{marca}%"},
    )
    await execute("DELETE FROM planta WHERE nombre LIKE %(p)s", {"p": f"%{marca}%"})
    await execute("DELETE FROM sesion WHERE token LIKE %(p)s", {"p": f"test-maq-%-{marca}"})


async def _planta_con_maquina(client, ctx, codigo: str = "M1") -> tuple[int, int]:
    r = await client.post(
        "/api/plantas/completa",
        headers=ctx["tokens"]["gerente"],
        json={
            "nombre": f"Planta maq {ctx['marca']}",
            "maquinas": [{"nombre": "Compressor", "codigo": codigo, "disciplina": "Mecánica"}],
        },
    )
    assert r.status_code == 201, r.text
    cuerpo = r.json()
    return cuerpo["planta_id"], cuerpo["maquinas"][0]["maquina_id"]


@pytest.mark.asyncio
async def test_edita_nombre_y_codigo(client, ctx):
    planta_id, maquina_id = _maquina = await _planta_con_maquina(client, ctx)

    r = await client.patch(
        f"/api/maquinas/{maquina_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Compressor A1", "codigo": "COMP-A1"},
    )

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["nombre"] == "Compressor A1"
    assert cuerpo["codigo"] == "COMP-A1"
    assert cuerpo["planta_id"] == planta_id

    fila = await fetch_one(
        "SELECT nombre, codigo FROM maquina WHERE maquina_id = %(m)s", {"m": maquina_id}
    )
    assert fila == {"nombre": "Compressor A1", "codigo": "COMP-A1"}


@pytest.mark.asyncio
async def test_el_patch_parcial_no_pisa_lo_que_no_se_envia(client, ctx):
    """Cambiar solo el nombre no puede borrar el código ni la disciplina."""
    _, maquina_id = await _planta_con_maquina(client, ctx, codigo="KEEP-1")

    r = await client.patch(
        f"/api/maquinas/{maquina_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Renombrada"},
    )

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["nombre"] == "Renombrada"
    assert cuerpo["codigo"] == "KEEP-1", "el código no se envió y no debe cambiar"
    assert cuerpo["disciplina_id"] is not None, "la disciplina no se envió y no debe perderse"


@pytest.mark.asyncio
async def test_codigo_duplicado_en_la_misma_planta_da_409(client, ctx):
    planta_id, primera = await _planta_con_maquina(client, ctx, codigo="DUP-1")
    r = await client.post(
        f"/api/plantas/{planta_id}/maquinas",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Otra", "codigo": "DUP-2"},
    )
    assert r.status_code == 201, r.text
    segunda = r.json()["maquina_id"]

    # Intentar que la segunda tome el código de la primera, sin importar mayúsculas.
    r = await client.patch(
        f"/api/maquinas/{segunda}",
        headers=ctx["tokens"]["gerente"],
        json={"codigo": "dup-1"},
    )

    assert r.status_code == 409, r.text
    assert "DUP-1" in r.json()["detail"] or "dup-1" in r.json()["detail"]


@pytest.mark.asyncio
async def test_el_mismo_codigo_no_choca_consigo_mismo(client, ctx):
    """Guardar el mismo código (sin cambiarlo) no puede dar 409."""
    _, maquina_id = await _planta_con_maquina(client, ctx, codigo="SELF-1")

    r = await client.patch(
        f"/api/maquinas/{maquina_id}",
        headers=ctx["tokens"]["gerente"],
        json={"codigo": "SELF-1", "nombre": "Mismo código"},
    )

    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_no_edita_una_maquina_de_otra_empresa(client, ctx):
    """La máquina se resuelve por su planta: si es de otra empresa, 404 (no 403)."""
    _, maquina_id = await _planta_con_maquina(client, ctx)

    r = await client.patch(
        f"/api/maquinas/{maquina_id}",
        headers=ctx["tokens"]["ajeno"],
        json={"nombre": "Intento ajeno"},
    )

    assert r.status_code == 404, r.text
    fila = await fetch_one(
        "SELECT nombre FROM maquina WHERE maquina_id = %(m)s", {"m": maquina_id}
    )
    assert fila["nombre"] == "Compressor", "no debe haberse modificado"


@pytest.mark.asyncio
async def test_maquina_inexistente_da_404(client, ctx):
    r = await client.patch(
        "/api/maquinas/999999",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Fantasma"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_sla_sin_columnas_da_503_y_no_cambia_nada(client, ctx, monkeypatch):
    """
    Si la base todavía no tiene `sla_horas`, no se ignora el valor: se avisa con el SQL.
    La caché de detección se fuerza a False para que el test no dependa del estado real.
    """
    _, maquina_id = await _planta_con_maquina(client, ctx, codigo="SLA-1")
    monkeypatch.setattr(catalog, "_sla_costo_disponibles_cache", False)

    r = await client.patch(
        f"/api/maquinas/{maquina_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Con SLA", "sla_horas": 8},
    )

    assert r.status_code == 503, r.text
    assert "ALTER TABLE maquina" in r.json()["detail"]
    fila = await fetch_one(
        "SELECT nombre FROM maquina WHERE maquina_id = %(m)s", {"m": maquina_id}
    )
    assert fila["nombre"] == "Compressor", "el nombre tampoco debe cambiar si falla"


@pytest.mark.asyncio
async def test_nombre_vacio_da_422(client, ctx):
    _, maquina_id = await _planta_con_maquina(client, ctx)

    r = await client.patch(
        f"/api/maquinas/{maquina_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "   "},
    )

    assert r.status_code == 422
