"""
Edición de plantas y alta de una máquina suelta (HU-25 / CGBIDA-466).

`PATCH /api/plantas/{id}` y `POST /api/plantas/{id}/maquinas`.

La unicidad del nombre se valida en Python, no con la restricción de la base: el esquema
del repo no tiene `UNIQUE(empresa_id, nombre)` en `planta` (la migración que la creaba se
eliminó por decisión del equipo). Estos tests cubren justamente ese caso, incluido el de
dos plantas que difieren solo en mayúsculas.

Cada test crea sus propias plantas con un sufijo único y las borra al terminar.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from barb.core.db import execute, fetch_all, fetch_one

GERENTE_ID = 2  # gerente de la empresa 1
TECNICO_ID = 4  # técnico de la empresa 1: sin permiso sobre la ruta `plantas`


@pytest_asyncio.fixture
async def ctx(db_pool):
    """Tokens de sesión y limpieza de todo lo creado por el test."""
    marca = uuid.uuid4().hex[:8]
    tokens: dict[str, dict[str, str]] = {}
    for nombre, uid in (("gerente", GERENTE_ID), ("tecnico", TECNICO_ID)):
        token = f"test-edp-{nombre}-{marca}"
        await execute(
            "INSERT INTO sesion (token, usuario_id, expira_en) "
            "VALUES (%(t)s, %(u)s, NOW() + INTERVAL '10 minutes')",
            {"t": token, "u": uid},
        )
        tokens[nombre] = {"Authorization": f"Bearer {token}"}

    yield {"tokens": tokens, "sufijo": marca}

    await execute(
        "DELETE FROM maquina WHERE planta_id IN (SELECT planta_id FROM planta WHERE nombre LIKE %(p)s)",
        {"p": f"%{marca}%"},
    )
    await execute("DELETE FROM planta WHERE nombre LIKE %(p)s", {"p": f"%{marca}%"})
    await execute("DELETE FROM disciplina WHERE nombre LIKE %(p)s", {"p": f"%TEST-EDP-{marca}%"})
    await execute("DELETE FROM sesion WHERE token LIKE %(p)s", {"p": f"test-edp-%-{marca}"})


async def _crear_planta(client, ctx, nombre: str, **extra) -> int:
    r = await client.post(
        "/api/plantas/completa",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": nombre, **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()["planta_id"]


async def _planta(planta_id: int) -> dict | None:
    return await fetch_one(
        "SELECT planta_id, nombre, ubicacion FROM planta WHERE planta_id = %(p)s",
        {"p": planta_id},
    )


# =============================================================================
# PATCH /api/plantas/{id}
# =============================================================================


async def test_edita_el_nombre_y_la_ubicacion(client, ctx):
    sufijo = ctx["sufijo"]
    original = f"Planta Edit {sufijo}"
    planta_id = await _crear_planta(client, ctx, original, ubicacion="Quilicura")

    r = await client.patch(
        f"/api/plantas/{planta_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": f"Planta Editada {sufijo}", "ubicacion": "Maipú"},
    )
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["planta_id"] == planta_id
    assert datos["nombre"] == f"Planta Editada {sufijo}"
    assert datos["ubicacion"] == "Maipú"

    en_base = await _planta(planta_id)
    assert en_base["nombre"] == f"Planta Editada {sufijo}"
    assert en_base["ubicacion"] == "Maipú"


async def test_permite_editar_solo_la_ubicacion(client, ctx):
    sufijo = ctx["sufijo"]
    nombre = f"Planta Solo Ubi {sufijo}"
    planta_id = await _crear_planta(client, ctx, nombre)

    r = await client.patch(
        f"/api/plantas/{planta_id}",
        headers=ctx["tokens"]["gerente"],
        json={"ubicacion": "Antofagasta"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == nombre
    assert r.json()["ubicacion"] == "Antofagasta"


async def test_permite_limpiar_la_ubicacion(client, ctx):
    sufijo = ctx["sufijo"]
    planta_id = await _crear_planta(client, ctx, f"Planta Limpia {sufijo}", ubicacion="Iquique")

    r = await client.patch(
        f"/api/plantas/{planta_id}",
        headers=ctx["tokens"]["gerente"],
        json={"ubicacion": "   "},
    )
    assert r.status_code == 200, r.text
    assert r.json()["ubicacion"] is None


async def test_sin_cambios_devuelve_el_estado_actual(client, ctx):
    sufijo = ctx["sufijo"]
    nombre = f"Planta Sin Cambios {sufijo}"
    planta_id = await _crear_planta(client, ctx, nombre)

    r = await client.patch(f"/api/plantas/{planta_id}", headers=ctx["tokens"]["gerente"], json={})
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == nombre


async def test_no_permite_un_nombre_duplicado_en_la_empresa(client, ctx):
    sufijo = ctx["sufijo"]
    await _crear_planta(client, ctx, f"Planta Ocupada {sufijo}")
    planta_id = await _crear_planta(client, ctx, f"Planta Libre {sufijo}")

    r = await client.patch(
        f"/api/plantas/{planta_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": f"Planta Ocupada {sufijo}"},
    )
    assert r.status_code == 409, r.text
    assert "Ya existe una planta" in r.json()["detail"]

    # La planta quedó como estaba.
    assert (await _planta(planta_id))["nombre"] == f"Planta Libre {sufijo}"


async def test_el_duplicado_se_detecta_sin_importar_mayusculas(client, ctx):
    """La unicidad se valida con lower() en Python, no con una restricción de la base."""
    sufijo = ctx["sufijo"]
    await _crear_planta(client, ctx, f"Planta MAYUS {sufijo}")
    planta_id = await _crear_planta(client, ctx, f"Planta Otra {sufijo}")

    r = await client.patch(
        f"/api/plantas/{planta_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": f"planta mayus {sufijo}"},
    )
    assert r.status_code == 409, r.text


async def test_guardar_el_mismo_nombre_no_choca_consigo_mismo(client, ctx):
    sufijo = ctx["sufijo"]
    nombre = f"Planta Consigo {sufijo}"
    planta_id = await _crear_planta(client, ctx, nombre)

    r = await client.patch(
        f"/api/plantas/{planta_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": nombre, "ubicacion": "Los Andes"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["ubicacion"] == "Los Andes"


async def test_rechaza_un_nombre_demasiado_corto(client, ctx):
    sufijo = ctx["sufijo"]
    planta_id = await _crear_planta(client, ctx, f"Planta Corta {sufijo}")

    r = await client.patch(
        f"/api/plantas/{planta_id}",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "X"},
    )
    assert r.status_code in (409, 422), r.text


async def test_planta_inexistente_da_404(client, ctx):
    r = await client.patch(
        "/api/plantas/999999",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Planta Fantasma"},
    )
    assert r.status_code == 404, r.text


async def test_un_tecnico_no_puede_editar(client, ctx):
    sufijo = ctx["sufijo"]
    planta_id = await _crear_planta(client, ctx, f"Planta Tecnico {sufijo}")

    r = await client.patch(
        f"/api/plantas/{planta_id}",
        headers=ctx["tokens"]["tecnico"],
        json={"nombre": f"Planta Hackeada {sufijo}"},
    )
    assert r.status_code == 403, r.text
    assert (await _planta(planta_id))["nombre"] == f"Planta Tecnico {sufijo}"


# =============================================================================
# POST /api/plantas/{id}/maquinas
# =============================================================================


async def test_agrega_una_maquina_a_una_planta_existente(client, ctx):
    sufijo = ctx["sufijo"]
    planta_id = await _crear_planta(client, ctx, f"Planta Maquinas {sufijo}")
    disc = f"TEST-EDP-{sufijo}-Mecánica"

    r = await client.post(
        f"/api/plantas/{planta_id}/maquinas",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Compressor N1", "codigo": f"N1-{sufijo}", "disciplina": disc},
    )
    assert r.status_code == 201, r.text
    datos = r.json()
    assert datos["codigo"] == f"N1-{sufijo}"
    assert datos["disciplina_id"] is not None

    en_base = await fetch_all(
        "SELECT maquina_id, nombre, codigo FROM maquina WHERE planta_id = %(p)s",
        {"p": planta_id},
    )
    assert len(en_base) == 1
    assert en_base[0]["codigo"] == f"N1-{sufijo}"


async def test_la_maquina_puede_quedar_sin_disciplina(client, ctx):
    sufijo = ctx["sufijo"]
    planta_id = await _crear_planta(client, ctx, f"Planta Sin Disc {sufijo}")

    r = await client.post(
        f"/api/plantas/{planta_id}/maquinas",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Generador", "codigo": f"G-{sufijo}"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["disciplina_id"] is None


async def test_reutiliza_una_disciplina_existente(client, ctx):
    sufijo = ctx["sufijo"]
    disc = f"TEST-EDP-{sufijo}-Eléctrica"
    planta_id = await _crear_planta(client, ctx, f"Planta Reuso {sufijo}", disciplinas=[disc])
    primera = await fetch_one(
        "SELECT disciplina_id FROM disciplina WHERE nombre = %(n)s", {"n": disc}
    )

    r = await client.post(
        f"/api/plantas/{planta_id}/maquinas",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Tablero", "codigo": f"T-{sufijo}", "disciplina": disc},
    )
    assert r.status_code == 201, r.text
    assert r.json()["disciplina_id"] == primera["disciplina_id"]

    total = await fetch_one(
        "SELECT COUNT(*) AS n FROM disciplina WHERE lower(nombre) = lower(%(n)s)", {"n": disc}
    )
    assert total["n"] == 1


async def test_no_permite_dos_maquinas_con_el_mismo_codigo_en_la_planta(client, ctx):
    sufijo = ctx["sufijo"]
    planta_id = await _crear_planta(client, ctx, f"Planta Dup Cod {sufijo}")
    codigo = f"D-{sufijo}"

    primera = await client.post(
        f"/api/plantas/{planta_id}/maquinas",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Uno", "codigo": codigo},
    )
    assert primera.status_code == 201, primera.text

    segunda = await client.post(
        f"/api/plantas/{planta_id}/maquinas",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Dos", "codigo": codigo.upper()},
    )
    assert segunda.status_code == 409, segunda.text
    assert "código" in segunda.json()["detail"]

    total = await fetch_one(
        "SELECT COUNT(*) AS n FROM maquina WHERE planta_id = %(p)s", {"p": planta_id}
    )
    assert total["n"] == 1


async def test_el_mismo_codigo_si_se_permite_en_otra_planta(client, ctx):
    sufijo = ctx["sufijo"]
    planta_a = await _crear_planta(client, ctx, f"Planta A {sufijo}")
    planta_b = await _crear_planta(client, ctx, f"Planta B {sufijo}")
    codigo = f"C-{sufijo}"

    for planta in (planta_a, planta_b):
        r = await client.post(
            f"/api/plantas/{planta}/maquinas",
            headers=ctx["tokens"]["gerente"],
            json={"nombre": "Misma", "codigo": codigo},
        )
        assert r.status_code == 201, r.text


async def test_no_agrega_maquinas_a_una_planta_inexistente(client, ctx):
    r = await client.post(
        "/api/plantas/999999/maquinas",
        headers=ctx["tokens"]["gerente"],
        json={"nombre": "Fantasma", "codigo": "F-1"},
    )
    assert r.status_code == 404, r.text


async def test_un_tecnico_no_puede_agregar_maquinas(client, ctx):
    sufijo = ctx["sufijo"]
    planta_id = await _crear_planta(client, ctx, f"Planta No Tec {sufijo}")

    r = await client.post(
        f"/api/plantas/{planta_id}/maquinas",
        headers=ctx["tokens"]["tecnico"],
        json={"nombre": "Intrusa", "codigo": f"X-{sufijo}"},
    )
    assert r.status_code == 403, r.text
