"""
Pruebas de la respuesta de /api/stats/financial-impact ante error.

CGBIDA-403 (HU B / CGBIDA-51). Antes: cualquier excepción se capturaba y se devolvía
la estructura completa con ceros, así que un fallo de base de datos se veía como
"la planta no tiene costos". Ahora se distinguen los fallos y se devuelve un error
explícito, con el mismo patrón que CGBIDA-357 aplicó en la topología.

Solo lectura: estas pruebas no crean ni modifican filas.
"""

from __future__ import annotations

import psycopg
from psycopg_pool import PoolTimeout

from barb.routers import stats

ADMIN_E1 = ("admin@barb.com", "admin123")


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _pool_que_falla(exc: BaseException):
    """Sustituye el pool por uno cuyo `connection()` lanza `exc` al entrar.

    `pool.connection()` se usa como context manager asíncrono, así que el fallo debe
    ocurrir en el `__aenter__` para que lo capture el `except` del handler. Sirve tanto
    para errores de dependencia (`OperationalError`, `PoolTimeout`) como para errores
    inesperados: lo que distingue el código 503 del 500 es el tipo de excepción, no
    el punto donde se lanza.
    """

    class _ConexionRota:
        async def __aenter__(self):
            raise exc

        async def __aexit__(self, *args):
            return False

    class _PoolRoto:
        def connection(self):
            return _ConexionRota()

    return _PoolRoto()


# =============================================================================
# Camino feliz: sigue devolviendo datos
# =============================================================================

async def test_camino_feliz_devuelve_datos(client):
    """El cambio no puede romper la respuesta correcta."""
    h = await _login(client, ADMIN_E1)
    r = await client.get("/api/stats/financial-impact", headers=h)

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert {"financials", "trend14Days", "machines"} <= set(cuerpo.keys())
    for campo in ("ahorro_generado", "mttr", "efficiency", "costo_total_acumulado", "mtbfHours"):
        assert campo in cuerpo["financials"], f"falta {campo}"
    # Los tres bloques que el dashboard consume.
    assert isinstance(cuerpo["trend14Days"], list)
    assert isinstance(cuerpo["machines"], list)


async def test_la_respuesta_ya_no_tiene_forma_de_ceros(client):
    """Contraprueba del anti-patrón: la respuesta buena no es la estructura de ceros."""
    h = await _login(client, ADMIN_E1)
    cuerpo = (await client.get("/api/stats/financial-impact", headers=h)).json()
    ceros = {
        "ahorro_generado": 0.0,
        "mttr": 0.0,
        "efficiency": 0.0,
        "costo_total_acumulado": 0.0,
        "mtbfHours": None,
    }
    assert cuerpo["financials"] != ceros or cuerpo["trend14Days"] or cuerpo["machines"], (
        "la respuesta es indistinguible del relleno de ceros que se devolvía ante error"
    )


# =============================================================================
# 503: la dependencia no está disponible
# =============================================================================

async def test_base_inalcanzable_devuelve_503(client, monkeypatch):
    h = await _login(client, ADMIN_E1)
    monkeypatch.setattr(
        stats, "pool", _pool_que_falla(psycopg.OperationalError("connection refused"))
    )
    r = await client.get("/api/stats/financial-impact", headers=h)

    assert r.status_code == 503, r.text
    assert "no está disponible" in r.json()["detail"]


async def test_pool_agotado_devuelve_503(client, monkeypatch):
    h = await _login(client, ADMIN_E1)
    monkeypatch.setattr(stats, "pool", _pool_que_falla(PoolTimeout("pool exhausted")))
    r = await client.get("/api/stats/financial-impact", headers=h)

    assert r.status_code == 503, r.text
    assert "no está disponible" in r.json()["detail"]


# =============================================================================
# 500: error inesperado
# =============================================================================

async def test_error_inesperado_devuelve_500(client, monkeypatch):
    h = await _login(client, ADMIN_E1)
    monkeypatch.setattr(stats, "pool", _pool_que_falla(RuntimeError("algo se rompió")))
    r = await client.get("/api/stats/financial-impact", headers=h)

    assert r.status_code == 500, r.text
    assert "Error interno" in r.json()["detail"]


async def test_no_devuelve_ceros_ante_error(client, monkeypatch):
    """El corazón de CGBIDA-403: ante fallo NO se devuelve la estructura de ceros."""
    h = await _login(client, ADMIN_E1)
    monkeypatch.setattr(stats, "pool", _pool_que_falla(psycopg.OperationalError("caída")))
    r = await client.get("/api/stats/financial-impact", headers=h)

    cuerpo = r.json()
    # Si devolviera 200 con ceros, el usuario creería que la planta no tiene costos.
    assert r.status_code != 200, f"devolvió 200 con {cuerpo}"
    assert "financials" not in cuerpo, "sigue devolviendo la estructura con ceros"


# =============================================================================
# Los errores deliberados y de validación no se enmascaran
# =============================================================================

async def test_sin_token_no_devuelve_metricas(client):
    """Control de acceso: sin credenciales no hay datos."""
    r = await client.get("/api/stats/financial-impact")
    assert r.status_code in (401, 422), r.text


async def test_token_invalido_devuelve_401(client):
    r = await client.get(
        "/api/stats/financial-impact",
        headers={"Authorization": "Bearer token-que-no-existe"},
    )
    assert r.status_code == 401, r.text


async def test_parametro_invalido_devuelve_422(client):
    """`days` tiene cota inferior 1: un valor inválido lo rechaza el esquema, no el handler."""
    h = await _login(client, ADMIN_E1)
    r = await client.get("/api/stats/financial-impact?days=0", headers=h)
    assert r.status_code == 422, r.text


async def test_visitante_puede_leer_las_metricas(client):
    """La matriz de rutas da 'ver' al visitante en dashboard (permissions.py:47).

    Se documenta el comportamiento real: el visitante SÍ accede, en solo lectura.
    """
    h = await _login(client, ("visitante@planta.com", "visitante123"))
    r = await client.get("/api/stats/financial-impact", headers=h)
    assert r.status_code == 200, r.text
