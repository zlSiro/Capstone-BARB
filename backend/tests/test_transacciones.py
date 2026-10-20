"""
Vista de transacciones del super_usuario (GET /api/transacciones y /filtros).

Crea sesiones y filas de `transacciones` propias (con marcadores únicos) y las elimina al terminar;
no depende de las contraseñas del seed. Requiere la BD migrada hasta 0009 y sembrada (usuarios 2 y 14).
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio

from barb.core.db import execute, fetch_all, fetch_one

SUPER_ID = 14  # super@barb.com (sin empresa)
GERENTE_ID = 2  # gerente1@planta.com (empresa 1)


async def _usuario(usuario_id: int) -> dict:
    return await fetch_one("SELECT usuario_id, rol, empresa_id FROM usuario WHERE usuario_id = %(id)s", {"id": usuario_id})


@pytest_asyncio.fixture
async def tokens(db_pool):
    marca = uuid.uuid4().hex[:8]
    out = {}
    for nombre, uid in (("super", SUPER_ID), ("gerente", GERENTE_ID)):
        token = f"test-trx-{nombre}-{marca}"
        await execute(
            "INSERT INTO sesion (token, usuario_id, expira_en) VALUES (%(t)s, %(u)s, NOW() + INTERVAL '10 minutes')",
            {"t": token, "u": uid},
        )
        out[nombre] = {"Authorization": f"Bearer {token}"}
    yield out
    await execute("DELETE FROM sesion WHERE token LIKE %(p)s", {"p": f"test-trx-%-{marca}"})


@pytest_asyncio.fixture
async def filas(db_pool):
    """Filas de prueba con una `accion` única. Devuelve {nombre: transaccion_id}."""
    marca = f"TEST {uuid.uuid4().hex[:8]}"
    gerente = await _usuario(GERENTE_ID)
    ids = {}
    casos = {
        "ahora": ("1 minute", GERENTE_ID, gerente["empresa_id"], gerente["rol"]),
        "hace_3_dias": ("3 days", GERENTE_ID, gerente["empresa_id"], gerente["rol"]),
        "hace_40_dias": ("40 days", GERENTE_ID, gerente["empresa_id"], gerente["rol"]),
        "hace_400_dias": ("400 days", GERENTE_ID, gerente["empresa_id"], gerente["rol"]),
        "otro_perfil": ("2 minutes", GERENTE_ID, gerente["empresa_id"], "admin"),
        "otra_empresa": ("3 minutes", GERENTE_ID, 2, gerente["rol"]),
        "sin_usuario": ("4 minutes", None, gerente["empresa_id"], "sistema"),
    }
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


async def _ids(client, headers, **params) -> set[int]:
    r = await client.get("/api/transacciones", params={"limit": 200, **params}, headers=headers)
    assert r.status_code == 200, r.text
    return {i["transaccion_id"] for i in r.json()["items"]}


# --- Permisos ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_solo_el_super_usuario_accede(client, tokens):
    for ruta in ("/api/transacciones", "/api/transacciones/filtros"):
        assert (await client.get(ruta, headers=tokens["gerente"])).status_code == 403
        assert (await client.get(ruta, headers=tokens["super"])).status_code == 200
    assert (await client.get("/api/transacciones")).status_code == 422  # sin Authorization


# --- Filtros ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_nunca_incluye_transacciones_sin_usuario(client, tokens, filas):
    ids = await _ids(client, tokens["super"])
    assert filas["sin_usuario"] not in ids
    assert filas["ahora"] in ids
    r = await client.get("/api/transacciones", params={"limit": 200}, headers=tokens["super"])
    assert all(i["usuario_id"] is not None for i in r.json()["items"])


@pytest.mark.asyncio
async def test_filtra_por_empresa_rol_y_usuario(client, tokens, filas):
    h = tokens["super"]
    e1 = await _ids(client, h, empresa_id=1, usuario_id=GERENTE_ID)
    assert filas["ahora"] in e1 and filas["otra_empresa"] not in e1
    assert filas["otra_empresa"] in await _ids(client, h, empresa_id=2, usuario_id=GERENTE_ID)

    admin = await _ids(client, h, rol="admin", usuario_id=GERENTE_ID)
    assert admin >= {filas["otro_perfil"]} and filas["ahora"] not in admin

    assert (await client.get("/api/transacciones", params={"rol": "inventado"}, headers=h)).status_code == 422


@pytest.mark.asyncio
async def test_rangos_relativos(client, tokens, filas):
    h = tokens["super"]

    async def ver(rango) -> set[str]:
        ids = await _ids(client, h, usuario_id=GERENTE_ID, rango=rango)
        return {nombre for nombre, i in filas.items() if i in ids}

    recientes = {"ahora", "otro_perfil", "otra_empresa"}
    assert await ver("24h") == recientes
    assert await ver("7d") == recientes | {"hace_3_dias"}
    assert await ver("30d") == recientes | {"hace_3_dias"}
    assert await ver("1y") == recientes | {"hace_3_dias", "hace_40_dias"}


@pytest.mark.asyncio
async def test_rango_personalizado(client, tokens, filas):
    h = tokens["super"]
    hoy = date.today()
    desde, hasta = (hoy - timedelta(days=5)).isoformat(), (hoy - timedelta(days=2)).isoformat()
    ids = await _ids(client, h, usuario_id=GERENTE_ID, rango="custom", desde=desde, hasta=hasta)
    assert filas["hace_3_dias"] in ids
    assert filas["ahora"] not in ids and filas["hace_40_dias"] not in ids

    # El día "hasta" es inclusivo.
    solo_hoy = await _ids(client, h, usuario_id=GERENTE_ID, rango="custom", desde=hoy.isoformat(), hasta=hoy.isoformat())
    assert filas["ahora"] in solo_hoy

    for params in ({"rango": "custom"}, {"rango": "custom", "desde": hasta, "hasta": desde}, {"rango": "semana"}):
        assert (await client.get("/api/transacciones", params=params, headers=h)).status_code == 422


@pytest.mark.asyncio
async def test_paginacion_y_total(client, tokens, filas):
    r = await client.get("/api/transacciones", params={"usuario_id": GERENTE_ID, "limit": 2}, headers=tokens["super"])
    body = r.json()
    assert len(body["items"]) == 2 and body["limit"] == 2 and body["total"] >= 6  # 6 filas de prueba con usuario
    fechas = [i["fecha"] for i in body["items"]]
    assert fechas == sorted(fechas, reverse=True)


@pytest.mark.asyncio
async def test_filtros_devuelve_empresas_roles_y_usuarios(client, tokens):
    body = (await client.get("/api/transacciones/filtros", headers=tokens["super"])).json()
    en_bd = {r["empresa_id"] for r in await fetch_all("SELECT empresa_id FROM empresa")}
    assert {e["empresa_id"] for e in body["empresas"]} == en_bd
    assert "gerente" in body["roles"]
    assert any(u["usuario_id"] == GERENTE_ID and u["empresa_id"] == 1 for u in body["usuarios"])
