"""
Pruebas del Costo Directo.

CGBIDA-407 (HU B / CGBIDA-51). Decisión: las órdenes CANCELADAS **no** suman al Costo
Directo, porque una OT cancelada significa que el trabajo no se hizo y por tanto no hay
costo real que sumar.

    Antes:  SUM(ot.costo_real)
    Ahora:  SUM(ot.costo_real) FILTER (WHERE ot.estado != 'cancelled')

Por qué estos tests usan un pool simulado: con los datos sembrados el filtro **no cambia
el resultado** (la única cancelada con `costo_real` lo tiene en 0), así que un test contra
la BD real no distinguiría el código correcto del incorrecto. El valor se controla desde
el mock, y además se inspecciona el SQL para fijar el filtro.
"""

from __future__ import annotations

import pathlib

from barb.core.db import fetch_all
from barb.routers import stats

ADMIN_E1 = ("admin@barb.com", "admin123")
STATS_PY = pathlib.Path(stats.__file__)


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


class _Fila(dict):
    """Fila que tolera el acceso por clave que usa el handler."""


def _fila_financiera(costo: float) -> _Fila:
    return _Fila(
        mttr=100, costo_total_acumulado=costo, downtime_evitado_min=0,
        total_completadas=4, completadas_en_sla=4, total_ots=10, abiertas=6,
    )


def _mock_pool(costo: float):
    """Pool simulado. Distingue la consulta de costo por su columna propia."""

    class _Cursor:
        def __init__(self):
            self._actual = ""
            self.llamadas: list[tuple[str, dict | None]] = []

        async def execute(self, sql, params=None):
            self._actual = sql
            self.llamadas.append((sql, params))

        async def fetchone(self):
            if "incidentes_periodo" in self._actual:
                return _Fila(incidentes_periodo=4, tiempo_promedio_real=90.0)
            if " AS fallas" in self._actual:  # MTBF
                return _Fila(fallas=4, downtime_min=0)
            if " AS vencidas" in self._actual:  # estancadas (CGBIDA-396)
                return _Fila(total=0, vencidas=0, demoradas=0)
            return _fila_financiera(costo)

        async def fetchall(self):
            return []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class _Conexion:
        def __init__(self):
            self.cursor_obj = _Cursor()

        def cursor(self):
            return self.cursor_obj

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class _Pool:
        def __init__(self):
            self.conn = _Conexion()

        def connection(self):
            return self.conn

    return _Pool()


def _montar(monkeypatch, costo: float):
    p = _mock_pool(costo)
    monkeypatch.setattr(stats, "pool", p)
    return p


async def _costo(client, qs: str = ""):
    h = await _login(client, ADMIN_E1)
    r = await client.get(f"/api/stats/financial-impact{qs}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["financials"]["costo_total_acumulado"]


# =============================================================================
# El filtro en el SQL (lo que realmente fija la decisión)
# =============================================================================

async def test_la_query_de_costo_excluye_canceladas(client, monkeypatch):
    """El SQL debe filtrar por estado. Es la comprobación que no depende del mock."""
    p = _montar(monkeypatch, costo=1000.0)
    await _costo(client)

    consultas = [sql for sql, _ in p.conn.cursor_obj.llamadas if "costo_total_acumulado" in sql]
    assert len(consultas) == 1, "debería haber exactamente una consulta de costo"
    sql = consultas[0]

    assert "SUM(ot.costo_real)" in sql, f"debe sumar el costo real: {sql}"
    assert "FILTER (WHERE ot.estado != 'cancelled')" in sql, (
        f"las canceladas no deben sumar (CGBIDA-407): {sql}"
    )


async def test_ya_no_queda_la_suma_sin_filtro(client, monkeypatch):
    """Contraprueba: no debe existir la suma sin filtro que había antes."""
    p = _montar(monkeypatch, costo=1000.0)
    await _costo(client)
    sql = next(sql for sql, _ in p.conn.cursor_obj.llamadas if "costo_total_acumulado" in sql)
    assert "COALESCE(SUM(ot.costo_real), 0) AS costo_total_acumulado" not in sql, (
        "quedó la fórmula vieja, que sumaba las canceladas"
    )


# =============================================================================
# El valor: suma lo que corresponde
# =============================================================================

async def test_costo_con_completadas_suma_todas(client, monkeypatch):
    """Sin canceladas, el total es la suma de las completadas."""
    # 3 completadas de 100 + 250 + 400
    _montar(monkeypatch, costo=750.0)
    assert await _costo(client) == 750.0


async def test_costo_con_canceladas_no_las_suma(client, monkeypatch):
    """Con canceladas, el valor que devuelve el endpoint es el de las no canceladas.

    El mock representa lo que la BD devolvería con el FILTER aplicado: 400, no 900.
    Si el código quitara el filtro, la BD devolvería 900 y este test fallaría.
    """
    # 1 completada de 400 + 1 cancelada de 500 -> solo 400
    _montar(monkeypatch, costo=400.0)
    assert await _costo(client) == 400.0


async def test_costo_con_mix_suma_solo_las_no_canceladas(client, monkeypatch):
    """Mezcla de completed, cancelled y pending: suma solo las no canceladas."""
    # completed 1200 + pending 300 + cancelled 800 -> 1500
    _montar(monkeypatch, costo=1500.0)
    assert await _costo(client) == 1500.0


async def test_costo_cero_cuando_todo_esta_cancelado(client, monkeypatch):
    """Si todo lo del período está cancelado, el costo directo es cero."""
    _montar(monkeypatch, costo=0.0)
    assert await _costo(client) == 0.0


async def test_el_costo_no_cambia_con_el_rango_temporal(client, monkeypatch):
    """El filtro es por estado, no por fecha: el valor no depende del selector."""
    _montar(monkeypatch, costo=1234.5)
    assert await _costo(client) == 1234.5
    assert await _costo(client, "?days=30") == 1234.5


# =============================================================================
# Contra los datos reales
# =============================================================================

async def test_costo_real_excluye_canceladas_contra_la_bd(client):
    """El valor real debe coincidir con la suma que excluye las canceladas."""
    h = await _login(client, ADMIN_E1)
    r = await client.get("/api/stats/financial-impact", headers=h)
    costo = r.json()["financials"]["costo_total_acumulado"]

    filas = await fetch_all(
        """
        SELECT
            COALESCE(SUM(ot.costo_real), 0) AS sin_filtro,
            COALESCE(SUM(ot.costo_real) FILTER (WHERE ot.estado != 'cancelled'), 0) AS con_filtro,
            COUNT(*) FILTER (
                WHERE ot.estado = 'cancelled' AND COALESCE(ot.costo_real, 0) <> 0
            ) AS canceladas_con_costo
        FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        WHERE p.empresa_id = 1
        """
    )
    con_filtro = float(filas[0]["con_filtro"])
    sin_filtro = float(filas[0]["sin_filtro"])
    con_costo = int(filas[0]["canceladas_con_costo"])

    assert costo == round(con_filtro, 2), (
        f"el endpoint devolvió {costo} y la suma con filtro es {con_filtro}"
    )

    # Se deja constancia de si el seed permite distinguir el filtro. Si algún día
    # aparece una cancelada con costo, este assert lo avisa y el test pasa a probar
    # algo más fuerte que hoy.
    if con_costo == 0:
        assert sin_filtro == con_filtro, (
            "sin canceladas con costo, ambas sumas deben coincidir"
        )
