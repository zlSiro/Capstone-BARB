"""
Alta masiva de plantas con sus disciplinas y máquinas — HU-25 (CGBIDA-461), subtarea CGBIDA-467.

`POST /api/plantas/completa` tiene que ser atómico: si una máquina falla, la planta no puede
quedar creada "a medias". Estos tests comprueban eso contra la base real, no con mocks.

Cada test usa nombres y códigos con un sufijo único y limpia lo que creó, así no ensucia el
seed ni choca con ejecuciones anteriores.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from barb.core.db import execute, fetch_all, fetch_one

GERENTE_ID = 2  # gerente de la empresa 1
TECNICO_ID = 4  # técnico de la empresa 1: sin permiso sobre la ruta `plantas`


def _marca() -> str:
    return uuid.uuid4().hex[:8]


@pytest_asyncio.fixture
async def marcas(db_pool):
    """Tokens de sesión para gerente y técnico, y limpieza de todo lo creado."""
    marca = _marca()
    tokens: dict[str, dict[str, str]] = {}
    for nombre, uid in (("gerente", GERENTE_ID), ("tecnico", TECNICO_ID)):
        token = f"test-plt-{nombre}-{marca}"
        await execute(
            "INSERT INTO sesion (token, usuario_id, expira_en) "
            "VALUES (%(t)s, %(u)s, NOW() + INTERVAL '10 minutes')",
            {"t": token, "u": uid},
        )
        tokens[nombre] = {"Authorization": f"Bearer {token}"}

    yield {"tokens": tokens, "sufijo": marca}

    # Orden inverso a las FK: máquinas -> planta -> disciplinas creadas por el test.
    await execute(
        """
        DELETE FROM maquina
        WHERE planta_id IN (SELECT planta_id FROM planta WHERE nombre LIKE %(p)s)
        """,
        {"p": f"%{marca}%"},
    )
    await execute("DELETE FROM planta WHERE nombre LIKE %(p)s", {"p": f"%{marca}%"})
    await execute("DELETE FROM disciplina WHERE nombre LIKE %(p)s", {"p": f"%TEST-{marca}%"})
    await execute("DELETE FROM sesion WHERE token LIKE %(p)s", {"p": f"test-plt-%-{marca}"})


async def _planta(nombre: str) -> dict | None:
    return await fetch_one(
        "SELECT planta_id, empresa_id, nombre, ubicacion FROM planta WHERE nombre = %(n)s",
        {"n": nombre},
    )


async def _maquinas(planta_id: int) -> list[dict]:
    return await fetch_all(
        "SELECT maquina_id, nombre, codigo, disciplina_id FROM maquina "
        "WHERE planta_id = %(p)s ORDER BY codigo",
        {"p": planta_id},
    )


# =============================================================================
# Camino feliz
# =============================================================================


async def test_crea_planta_disciplinas_y_maquinas_en_una_llamada(client, marcas):
    sufijo = marcas["sufijo"]
    nombre = f"Planta Test {sufijo}"
    disc = f"TEST-{sufijo}-Mecánica"

    r = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={
            "nombre": nombre,
            "ubicacion": "Quilicura",
            "disciplinas": [disc],
            "maquinas": [
                {"nombre": "Compressor T1", "codigo": f"T1-{sufijo}", "disciplina": disc},
                {"nombre": "Pump T2", "codigo": f"T2-{sufijo}", "disciplina": disc},
            ],
        },
    )
    assert r.status_code == 201, r.text
    datos = r.json()

    assert datos["nombre"] == nombre
    assert datos["ubicacion"] == "Quilicura"
    assert datos["planta_id"] > 0

    # La respuesta dice qué se creó y qué se reutilizó.
    assert len(datos["disciplinas"]) == 1
    assert datos["disciplinas"][0]["nombre"] == disc
    assert datos["disciplinas"][0]["creada"] is True
    assert len(datos["maquinas"]) == 2
    assert all(m["disciplina_id"] == datos["disciplinas"][0]["disciplina_id"] for m in datos["maquinas"])

    # Y la base quedó consistente.
    planta = await _planta(nombre)
    assert planta is not None
    assert planta["empresa_id"] == 1

    maquinas = await _maquinas(datos["planta_id"])
    assert [m["codigo"] for m in maquinas] == sorted([f"T1-{sufijo}", f"T2-{sufijo}"])


async def test_reutiliza_una_disciplina_que_ya_existe(client, marcas):
    sufijo = marcas["sufijo"]
    disc = f"TEST-{sufijo}-Eléctrica"
    # Primera alta: crea la disciplina.
    r1 = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={"nombre": f"Planta A {sufijo}", "disciplinas": [disc], "maquinas": []},
    )
    assert r1.status_code == 201, r1.text
    id_primera = r1.json()["disciplinas"][0]["disciplina_id"]
    assert r1.json()["disciplinas"][0]["creada"] is True

    # Segunda alta: la reutiliza, no la duplica.
    r2 = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={"nombre": f"Planta B {sufijo}", "disciplinas": [disc], "maquinas": []},
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["disciplinas"][0]["disciplina_id"] == id_primera
    assert r2.json()["disciplinas"][0]["creada"] is False

    total = await fetch_one(
        "SELECT COUNT(*) AS n FROM disciplina WHERE lower(nombre) = lower(%(n)s) AND empresa_id = 1",
        {"n": disc},
    )
    assert total["n"] == 1


async def test_resuelve_la_disciplina_de_una_maquina_aunque_no_venga_en_la_lista(client, marcas):
    sufijo = marcas["sufijo"]
    disc = f"TEST-{sufijo}-Neumática"

    r = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={
            "nombre": f"Planta C {sufijo}",
            "disciplinas": [],
            # La máquina nombra una disciplina que no está en `disciplinas`.
            "maquinas": [{"nombre": "Valv T3", "codigo": f"T3-{sufijo}", "disciplina": disc}],
        },
    )
    assert r.status_code == 201, r.text
    datos = r.json()
    assert datos["maquinas"][0]["disciplina_id"] is not None
    assert len(datos["disciplinas"]) == 1
    assert datos["disciplinas"][0]["nombre"] == disc


async def test_permite_crear_una_planta_sin_maquinas(client, marcas):
    sufijo = marcas["sufijo"]
    r = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={"nombre": f"Planta Vacía {sufijo}"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["maquinas"] == []
    assert r.json()["disciplinas"] == []


async def test_una_maquina_sin_disciplina_queda_en_null(client, marcas):
    sufijo = marcas["sufijo"]
    r = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={
            "nombre": f"Planta D {sufijo}",
            "maquinas": [{"nombre": "Gen T4", "codigo": f"T4-{sufijo}"}],
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["maquinas"][0]["disciplina_id"] is None


# =============================================================================
# Atomicidad y errores
# =============================================================================


async def test_si_falla_una_maquina_no_queda_la_planta_creada(client, marcas):
    """El corazón de la HU: todo o nada."""
    sufijo = marcas["sufijo"]
    nombre = f"Planta Rollback {sufijo}"
    codigo = f"R-{sufijo}"

    r = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={
            "nombre": nombre,
            "disciplinas": [f"TEST-{sufijo}-Hidráulica"],
            "maquinas": [
                {"nombre": "Buena", "codigo": codigo},
                # Mismo código: viola UNIQUE(planta_id, codigo).
                {"nombre": "Repetida", "codigo": codigo},
            ],
        },
    )
    assert r.status_code == 409, r.text
    assert "código" in r.json()["detail"].lower()

    # Ni la planta ni la disciplina sobrevivieron.
    assert await _planta(nombre) is None
    disc = await fetch_one(
        "SELECT COUNT(*) AS n FROM disciplina WHERE nombre = %(n)s",
        {"n": f"TEST-{sufijo}-Hidráulica"},
    )
    assert disc["n"] == 0


async def test_no_permite_dos_plantas_con_el_mismo_nombre(client, marcas):
    sufijo = marcas["sufijo"]
    nombre = f"Planta Dup {sufijo}"
    cuerpo = {"nombre": nombre}

    primera = await client.post("/api/plantas/completa", headers=marcas["tokens"]["gerente"], json=cuerpo)
    assert primera.status_code == 201, primera.text

    segunda = await client.post("/api/plantas/completa", headers=marcas["tokens"]["gerente"], json=cuerpo)
    assert segunda.status_code == 409, segunda.text
    assert "planta" in segunda.json()["detail"].lower()

    total = await fetch_one("SELECT COUNT(*) AS n FROM planta WHERE nombre = %(n)s", {"n": nombre})
    assert total["n"] == 1


async def test_rechaza_codigos_repetidos_en_el_payload_antes_de_tocar_la_base(client, marcas):
    sufijo = marcas["sufijo"]
    nombre = f"Planta Previa {sufijo}"
    codigo = f"P-{sufijo}"

    r = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={
            "nombre": nombre,
            "maquinas": [
                {"nombre": "A", "codigo": codigo},
                {"nombre": "B", "codigo": codigo.upper()},
            ],
        },
    )
    assert r.status_code == 409, r.text
    assert await _planta(nombre) is None


async def test_un_tecnico_no_puede_crear_plantas(client, marcas):
    r = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["tecnico"],
        json={"nombre": f"Planta Prohibida {marcas['sufijo']}"},
    )
    assert r.status_code == 403, r.text
    assert await _planta(f"Planta Prohibida {marcas['sufijo']}") is None


async def test_sin_sesion_no_puede_crear(client, marcas):
    # Sin cabecera Authorization, FastAPI rechaza en la validación del dependency (422);
    # lo que importa es que no cree nada.
    r = await client.post(
        "/api/plantas/completa",
        json={"nombre": f"Planta Anónima {marcas['sufijo']}"},
    )
    assert r.status_code in (401, 403, 422), r.text
    assert await _planta(f"Planta Anónima {marcas['sufijo']}") is None



@pytest.mark.parametrize("campo", ["nombre"])
async def test_valida_el_nombre_minimo(client, marcas, campo):
    r = await client.post(
        "/api/plantas/completa",
        headers=marcas["tokens"]["gerente"],
        json={campo: "x"},
    )
    assert r.status_code == 422, r.text

