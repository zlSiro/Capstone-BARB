"""
Vista de transacciones del gerente (GET /api/empresa/transacciones y /filtros).

Igual que test_transacciones.py: crea sus propias sesiones y filas (marcador único) y las elimina al terminar.
Requiere la BD migrada hasta 0009 y sembrada: usuarios 1 (admin e1), 2 (gerente e1), 4 (técnico e1),
14 (super_usuario) y 17 (gerente de la empresa 2).
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from barb.core.db import execute, fetch_one

# Los ids 1, 2 y 4 son estables (el seed inserta con ORDER BY). El super usuario y el
# gerente de la empresa 2 se resuelven por email: sus ids cambiaron con el catálogo real.
ADMIN_E1, GERENTE_E1, TECNICO_E1 = 1, 2, 4
SUPER_EMAIL = "super@barb.com"
GERENTE_E2_EMAIL = "gerente@alimentos.cl"


async def _id_por_email(email: str) -> int:
    fila = await fetch_one(
        "SELECT usuario_id FROM usuario WHERE email = %(e)s", {"e": email}
    )
    return int(fila["usuario_id"])
RUTA = "/api/empresa/transacciones"


@pytest_asyncio.fixture
async def tokens(db_pool):
    marca = uuid.uuid4().hex[:8]
    super_id = await _id_por_email(SUPER_EMAIL)
    gerente_e2_id = await _id_por_email(GERENTE_E2_EMAIL)
    out = {}
    for nombre, uid in (
        ("gerente", GERENTE_E1),
        ("gerente_e2", gerente_e2_id),
        ("admin", ADMIN_E1),
        ("tecnico", TECNICO_E1),
        ("super", super_id),
    ):
        token = f"test-trxe-{nombre}-{marca}"
        await execute(
            "INSERT INTO sesion (token, usuario_id, expira_en) VALUES (%(t)s, %(u)s, NOW() + INTERVAL '10 minutes')",
            {"t": token, "u": uid},
        )
        out[nombre] = {"Authorization": f"Bearer {token}"}
    yield out
    await execute("DELETE FROM sesion WHERE token LIKE %(p)s", {"p": f"test-trxe-%-{marca}"})


@pytest_asyncio.fixture
async def filas(db_pool):
    """Filas de prueba con una `accion` única. Devuelve {nombre: transaccion_id}."""
    marca = f"TEST {uuid.uuid4().hex[:8]}"
    super_id = await _id_por_email(SUPER_EMAIL)
    gerente_e2_id = await _id_por_email(GERENTE_E2_EMAIL)
    casos = {
        "gerente_e1": ("1 minute", GERENTE_E1, 1, "gerente"),
        "tecnico_e1": ("2 minutes", TECNICO_E1, 1, "tecnico"),
        "tecnico_e1_antiguo": ("3 days", TECNICO_E1, 1, "tecnico"),
        "gerente_e2": ("3 minutes", gerente_e2_id, 2, "gerente"),
        "super_en_e1": ("4 minutes", super_id, 1, "super_usuario"),
        "sin_usuario_e1": ("5 minutes", None, 1, "sistema"),
    }
    ids = {}
    for nombre, (antiguedad, uid, empresa_id, perfil) in casos.items():
        row = await fetch_one(
            f"""
            INSERT INTO transacciones (usuario_id, empresa_id, perfil, accion, fecha)
            VALUES (%(u)s, %(e)s, %(p)s, %(a)s, NOW() - INTERVAL '{antiguedad}')
            RETURNING transaccion_id
            """,
            {"u": uid, "e": empresa_id, "p": perfil, "a": marca},
        )
        ids[nombre] = row["transaccion_id"]
    yield ids
    await execute("DELETE FROM transacciones WHERE accion = %(a)s", {"a": marca})


async def _items(client, headers, **params) -> list[dict]:
    r = await client.get(RUTA, params={"limit": 200, **params}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["items"]


# --- Permisos ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_solo_el_gerente_accede(client, tokens):
    for ruta in (RUTA, f"{RUTA}/filtros"):
        assert (await client.get(ruta, headers=tokens["gerente"])).status_code == 200
        for otro in ("admin", "tecnico", "super"):
            assert (await client.get(ruta, headers=tokens[otro])).status_code == 403, (ruta, otro)
    assert (await client.get(RUTA)).status_code == 422  # sin Authorization


# --- Aislamiento por empresa ------------------------------------------------

@pytest.mark.asyncio
async def test_solo_ve_los_usuarios_de_su_empresa(client, tokens, filas):
    # El endpoint devuelve como máximo 200 filas y la suite genera cientos: se consulta
    # filtrando por usuario para que la ventana incluya siempre las filas del fixture.
    ids = {i["transaccion_id"] for i in await _items(client, tokens["gerente"], usuario_id=GERENTE_E1)}
    assert filas["gerente_e1"] in ids
    # El gerente ve también lo de los técnicos de su empresa.
    ids_tecnico = {
        i["transaccion_id"]
        for i in await _items(client, tokens["gerente"], usuario_id=TECNICO_E1)
    }
    assert {filas["tecnico_e1"], filas["tecnico_e1_antiguo"]} <= ids_tecnico
    assert filas["gerente_e2"] not in ids | ids_tecnico

    ids_e2 = {
        i["transaccion_id"]
        for i in await _items(client, tokens["gerente_e2"], usuario_id=await _id_por_email(GERENTE_E2_EMAIL))
    }
    assert filas["gerente_e2"] in ids_e2
    assert not ({filas["gerente_e1"], filas["tecnico_e1"]} & ids_e2)


@pytest.mark.asyncio
async def test_ignora_el_empresa_id_del_cliente(client, tokens, filas):
    """Pedir otra empresa por query no debe filtrar datos ajenos."""
    ids = {i["transaccion_id"] for i in await _items(client, tokens["gerente"], empresa_id=2)}
    assert filas["gerente_e2"] not in ids and filas["gerente_e1"] in ids


@pytest.mark.asyncio
async def test_no_incluye_sin_usuario_ni_acciones_del_super_usuario(client, tokens, filas):
    items = await _items(client, tokens["gerente"])
    ids = {i["transaccion_id"] for i in items}
    assert filas["sin_usuario_e1"] not in ids
    assert filas["super_en_e1"] not in ids
    assert all(i["usuario_id"] is not None and i["perfil"] != "super_usuario" for i in items)


# --- Filtros ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_filtra_por_rol_y_usuario(client, tokens, filas):
    h = tokens["gerente"]
    tecnicos = {i["transaccion_id"] for i in await _items(client, h, rol="tecnico")}
    assert {filas["tecnico_e1"], filas["tecnico_e1_antiguo"]} <= tecnicos and filas["gerente_e1"] not in tecnicos

    del_usuario = {i["transaccion_id"] for i in await _items(client, h, usuario_id=GERENTE_E1)}
    assert filas["gerente_e1"] in del_usuario and filas["tecnico_e1"] not in del_usuario

    # Un usuario de otra empresa nunca aparece, aunque se pida explícitamente.
    assert await _items(client, h, usuario_id=await _id_por_email(GERENTE_E2_EMAIL)) == []

    assert (await client.get(RUTA, params={"rol": "inventado"}, headers=h)).status_code == 422


@pytest.mark.asyncio
async def test_filtra_por_periodo(client, tokens, filas):
    h = tokens["gerente"]
    r24 = {i["transaccion_id"] for i in await _items(client, h, usuario_id=TECNICO_E1, rango="24h")}
    assert filas["tecnico_e1"] in r24 and filas["tecnico_e1_antiguo"] not in r24
    r7 = {i["transaccion_id"] for i in await _items(client, h, usuario_id=TECNICO_E1, rango="7d")}
    assert {filas["tecnico_e1"], filas["tecnico_e1_antiguo"]} <= r7

    hoy = (await fetch_one("SELECT CURRENT_DATE AS d"))["d"].isoformat()
    custom = {i["transaccion_id"] for i in await _items(client, h, rango="custom", desde=hoy, hasta=hoy)}
    assert filas["gerente_e1"] in custom and filas["tecnico_e1_antiguo"] not in custom

    for params in ({"rango": "custom"}, {"rango": "custom", "desde": hoy, "hasta": "2000-01-01"}, {"rango": "semana"}):
        assert (await client.get(RUTA, params=params, headers=h)).status_code == 422


@pytest.mark.asyncio
async def test_filtros_solo_trae_roles_y_usuarios_de_la_empresa(client, tokens):
    body = (await client.get(f"{RUTA}/filtros", headers=tokens["gerente"])).json()
    ids = {u["usuario_id"] for u in body["usuarios"]}
    assert {GERENTE_E1, TECNICO_E1} <= ids
    assert not ({await _id_por_email(GERENTE_E2_EMAIL), await _id_por_email(SUPER_EMAIL)} & ids)
    assert all(u["empresa_id"] == 1 for u in body["usuarios"])
    assert "super_usuario" not in body["roles"] and {"gerente", "tecnico"} <= set(body["roles"])
