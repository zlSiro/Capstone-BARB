"""
Pruebas del Impacto Anual Proyectado.

CGBIDA-406 (HU B / CGBIDA-51). El KPI compara dos escenarios sobre los incidentes
REALES del período:

    sin BARB -> los incidentes tardan `impact_without_barb_minutes` (supuesto de negocio)
    con BARB -> los incidentes tardan el tiempo REAL medido en las órdenes
    ahorro   = sin_barb - con_barb

Propiedades que se fijan aquí:

1. Mide SIEMPRE un año: con `days=None` la consulta se acota a 365 días, para que el
   numerador y el `dias_periodo` hablen del mismo período.
2. Las correctivas CANCELADAS no cuentan como incidentes (coherencia con CGBIDA-407).
3. El conteo y el promedio usan el MISMO conjunto: solo las que tienen tiempo registrado.
4. El ahorro NEGATIVO no se recorta: es información real.
5. Solo se calcula si el rango lo justifica (`impacto_visible`, umbral 90 días).
6. No hay literales de negocio en el router: el supuesto de minutos y el costo salen de config.
"""

from __future__ import annotations

import pathlib

from barb.core.db import fetch_all
from barb.routers import stats

# El supuesto de negocio se lee de config, no se escribe a mano: si cambia (180 -> 240),
# las expectativas de estas pruebas siguen siendo válidas sin editarlas.
SIN_BARB = stats.settings.impact_without_barb_minutes

ADMIN_E1 = ("admin@barb.com", "admin123")
STATS_PY = pathlib.Path(stats.__file__)


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


class _Fila(dict):
    """Fila que tolera el acceso por clave que usa el handler."""


def _mock_pool(incidentes: int, tiempo_promedio: float | None):
    """Pool simulado. Distingue la consulta de impacto de la de MTBF por su SQL.

    El handler ejecuta: financials -> trend -> machines -> (mtbf si visible)
    -> (impacto si visible). Se reconocen por el texto del SQL.
    """

    class _Cursor:
        def __init__(self):
            self._actual = ""
            self.llamadas: list[tuple[str, dict | None]] = []

        async def execute(self, sql, params=None):
            self._actual = sql
            self.llamadas.append((sql, params))

        async def fetchone(self):
            # Cada consulta se reconoce por el ALIAS de su columna propia, no por una
            # palabra compartida: 'corrective' aparece en esta consulta y también en la de
            # MTBF, y esa ambigüedad ya provocó un bug real. Los alias vienen del SELECT
            # de stats.py y son únicos.
            if " AS incidentes_periodo" in self._actual:
                return _Fila(incidentes_periodo=incidentes, tiempo_promedio_real=tiempo_promedio)
            if " AS fallas" in self._actual:  # MTBF
                return _Fila(fallas=4, downtime_min=0)
            if " AS vencidas" in self._actual:  # estancadas (CGBIDA-396)
                return _Fila(total=0, vencidas=0, demoradas=0)
            return _Fila(
                mttr=100, costo_total_acumulado=1000, downtime_evitado_min=0,
                total_completadas=4, completadas_en_sla=4, total_ots=10, abiertas=6,
            )

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


def _montar(monkeypatch, incidentes: int, tiempo_promedio: float | None):
    p = _mock_pool(incidentes, tiempo_promedio)
    monkeypatch.setattr(stats, "pool", p)
    return p


async def _impacto(client, qs: str = ""):
    h = await _login(client, ADMIN_E1)
    r = await client.get(f"/api/stats/financial-impact{qs}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["impacto_anual"]


# =============================================================================
# Visibilidad y umbral
# =============================================================================

async def test_impacto_visible_sin_filtro(client, monkeypatch):
    _montar(monkeypatch, incidentes=4, tiempo_promedio=90.0)
    imp = await _impacto(client)
    assert imp["impacto_visible"] is True
    assert imp["escenario_sin_barb"] is not None


async def test_impacto_days_365_igual_que_sin_filtro(client, monkeypatch):
    """Ambos miden un año, así que deben dar exactamente lo mismo."""
    _montar(monkeypatch, incidentes=4, tiempo_promedio=90.0)
    sin_filtro = await _impacto(client)
    con_365 = await _impacto(client, "?days=365")

    assert con_365["impacto_visible"] is True
    assert con_365["escenario_sin_barb"] == sin_filtro["escenario_sin_barb"]
    assert con_365["ahorro_proyectado"] == sin_filtro["ahorro_proyectado"]
    assert con_365["supuestos"]["dias_periodo"] == 365


async def test_impacto_days_90_es_visible(client, monkeypatch):
    """Límite inferior del umbral."""
    _montar(monkeypatch, incidentes=4, tiempo_promedio=90.0)
    imp = await _impacto(client, "?days=90")
    assert imp["impacto_visible"] is True
    assert imp["supuestos"]["dias_periodo"] == 90
    # Con 90 días el factor anual es 365/90, así que la proyección es mayor.
    assert imp["escenario_sin_barb"] == round(4 * (365 / 90) * SIN_BARB * 2000, 2)


async def test_impacto_days_30_no_visible_y_campos_null(client, monkeypatch):
    _montar(monkeypatch, incidentes=4, tiempo_promedio=90.0)
    imp = await _impacto(client, "?days=30")
    assert imp["impacto_visible"] is False
    for campo in ("escenario_sin_barb", "escenario_con_barb", "ahorro_proyectado", "incidentes_anuales"):
        assert imp[campo] is None, f"{campo} debería ser null"


async def test_impacto_con_rango_corto_ni_se_ejecuta_la_query(client, monkeypatch):
    """`impacto_visible=False` no es cosmético: ahorra la consulta.

    ACTUALIZADO A PROPÓSITO en CGBIDA-395, 396 y 435: el conteo pasó de 3 a 6 consultas. Se
    agregó la distribución por tipo de intervención (por_tipo) y la segunda lista de
    máquinas ordenada por costo (machines_por_costo), que se ejecutan siempre.
    Lo que este test protege no es el número exacto, sino que el impacto NO se consulte
    cuando el rango no lo justifica.
    """
    p = _montar(monkeypatch, incidentes=4, tiempo_promedio=90.0)
    await _impacto(client, "?days=30")
    ejecutadas = [sql for sql, _ in p.conn.cursor_obj.llamadas]
    assert not any("incidentes_periodo" in s for s in ejecutadas), "se ejecutó la consulta de impacto"
    assert len(ejecutadas) == 6, f"esperaba 6 consultas, hubo {len(ejecutadas)}"


async def test_supuestos_se_devuelven_siempre(client, monkeypatch):
    """Incluso sin cifras, el modelo debe poder explicarse."""
    _montar(monkeypatch, incidentes=4, tiempo_promedio=90.0)
    imp = await _impacto(client, "?days=30")
    assert imp["supuestos"] == {"minutos_sin_barb": SIN_BARB, "costo_por_minuto": 2000, "dias_periodo": 30}


# =============================================================================
# La fórmula
# =============================================================================

async def test_impacto_calcula_la_formula_exacta(client, monkeypatch):
    """Valores controlados -> número exacto, sin depender del seed."""
    _montar(monkeypatch, incidentes=10, tiempo_promedio=45.0)
    imp = await _impacto(client, "?days=365")

    # factor = 365/365 = 1
    assert imp["incidentes_anuales"] == 10.0
    assert imp["escenario_sin_barb"] == 10 * SIN_BARB * 2000
    assert imp["escenario_con_barb"] == 10 * 45 * 2000       # 900.000
    assert imp["ahorro_proyectado"] == 10 * (SIN_BARB - 45) * 2000
    assert imp["supuestos_incompletos"] is False


async def test_impacto_extrapola_con_rango_de_90_dias(client, monkeypatch):
    _montar(monkeypatch, incidentes=3, tiempo_promedio=60.0)
    imp = await _impacto(client, "?days=90")
    factor = 365 / 90
    assert imp["incidentes_anuales"] == round(3 * factor, 2)
    assert imp["escenario_sin_barb"] == round(3 * factor * SIN_BARB * 2000, 2)


async def test_impacto_sin_incidentes_devuelve_null(client, monkeypatch):
    """Sin base no se proyecta, aunque el rango sea visible."""
    _montar(monkeypatch, incidentes=0, tiempo_promedio=None)
    imp = await _impacto(client)
    assert imp["impacto_visible"] is True
    assert imp["escenario_sin_barb"] is None
    assert imp["ahorro_proyectado"] is None
    assert imp["incidentes_anuales"] is None


async def test_impacto_sin_tiempos_marca_supuestos_incompletos(client, monkeypatch):
    """Si hay incidentes pero ningún tiempo medido, el ahorro es 0 y se avisa."""
    _montar(monkeypatch, incidentes=5, tiempo_promedio=None)
    imp = await _impacto(client)
    assert imp["supuestos_incompletos"] is True
    # Ambos escenarios usan el mismo supuesto -> diferencia cero.
    assert imp["ahorro_proyectado"] == 0.0
    assert imp["escenario_sin_barb"] == imp["escenario_con_barb"]


async def test_ahorro_negativo_no_se_recorta(client, monkeypatch):
    """Si el tiempo real supera el supuesto, el ahorro es negativo y se muestra.

    Es información real: el tiempo actual supera el objetivo del modelo de negocio.
    No debe recortarse a cero (decisión explícita en CGBIDA-406).
    """
    _montar(monkeypatch, incidentes=4, tiempo_promedio=265.0)  # > supuesto
    imp = await _impacto(client)
    assert imp["ahorro_proyectado"] < 0, imp
    assert imp["escenario_con_barb"] > imp["escenario_sin_barb"]
    assert imp["supuestos_incompletos"] is False


# =============================================================================
# Contra los datos reales
# =============================================================================

async def test_impacto_caso_normal_con_datos_reales(client):
    """Con el seed real, el KPI se calcula y los dos escenarios son coherentes."""
    imp = await _impacto(client)
    assert imp["impacto_visible"] is True
    if imp["escenario_sin_barb"] is not None:
        assert imp["escenario_sin_barb"] > 0
        assert imp["incidentes_anuales"] > 0
        assert imp["ahorro_proyectado"] == round(
            imp["escenario_sin_barb"] - imp["escenario_con_barb"], 2
        )


async def test_impacto_usa_solo_correctivas_no_canceladas_contra_la_bd(client):
    """El conteo real debe excluir las correctivas canceladas y las sin tiempo.

    La consulta replica la del endpoint, incluida su **ventana fija de 365 días**:
    sin `days` el KPI mide siempre un año, aunque el historial sea de 24 meses
    (CGBIDA-408). Omitir ese acotado hacía que el test pasara por casualidad.
    """
    imp = await _impacto(client)
    filas = await fetch_all(
        """
        SELECT
            COUNT(*) FILTER (WHERE ot.tipo = 'corrective') AS todas_correctivas,
            COUNT(*) FILTER (
                WHERE ot.tipo = 'corrective' AND ot.estado != 'cancelled'
                  AND ot.tiempo_reparacion_min IS NOT NULL
                  AND ot.fecha_creacion >= NOW() - INTERVAL '365 days'
            ) AS base_esperada
        FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        WHERE p.empresa_id = 1
        """
    )
    todas = int(filas[0]["todas_correctivas"])
    esperada = int(filas[0]["base_esperada"])

    if imp["incidentes_anuales"] is not None:
        assert imp["incidentes_anuales"] == float(esperada), (
            f"incidentes_anuales={imp['incidentes_anuales']} pero la base correcta es {esperada}"
        )
    # Y las cifras deben diferir, o el test no probaría los filtros.
    assert esperada < todas, (
        f"la base esperada ({esperada}) no es menor que todas las correctivas ({todas}): "
        "el seed no permite distinguir los filtros"
    )


async def test_la_query_de_impacto_filtra_correctivas_y_excluye_canceladas(client, monkeypatch):
    """Prueba directa del filtro: el SQL debe exigir correctivas y excluir canceladas.

    Es la comprobación que faltaba. El pool simulado devuelve un valor fijo, así que
    quitar el filtro `tipo='corrective'` NO cambiaría el número y ningún test de valor
    lo notaría. Verificar el SQL sí lo detecta.
    """
    p = _montar(monkeypatch, incidentes=4, tiempo_promedio=90.0)
    await _impacto(client)

    consultas = [sql for sql, _ in p.conn.cursor_obj.llamadas if "incidentes_periodo" in sql]
    assert len(consultas) == 1, "debería haber exactamente una consulta de impacto"
    sql = consultas[0]

    assert "ot.tipo = 'corrective'" in sql, f"la base de incidentes debe ser correctiva: {sql}"
    assert "ot.estado != 'cancelled'" in sql, f"las canceladas no son incidentes: {sql}"
    assert "tiempo_reparacion_min IS NOT NULL" in sql, (
        f"el conteo debe acotarse a las que tienen tiempo registrado: {sql}"
    )
    # Y la ventana debe estar acotada incluso sin filtro del selector.
    assert "INTERVAL '365 days'" in sql, f"con days=None debe acotar a 365 días: {sql}"


async def test_con_days_sin_filtro_la_query_usa_la_ventana_de_365(client, monkeypatch):
    """El numerador y el `dias_periodo` deben hablar del mismo período."""
    p = _montar(monkeypatch, incidentes=4, tiempo_promedio=90.0)
    imp = await _impacto(client)
    sql = next(sql for sql, _ in p.conn.cursor_obj.llamadas if "incidentes_periodo" in sql)

    assert "%(days)s" not in sql, "con days=None no debe ligar el parámetro del selector"
    assert imp["supuestos"]["dias_periodo"] == 365


# =============================================================================
# No hay literales de negocio en el router
# =============================================================================

async def test_no_quedan_literales_180_ni_2000_en_stats_py():
    """El 180 y el 2000 deben venir de config o del campo, nunca del código."""
    import re

    codigo = STATS_PY.read_text(encoding="utf-8")
    # Se quitan los comentarios para no contar los que explican el supuesto.
    sin_comentarios = re.sub(r"#.*", "", codigo)

    assert not re.search(r"\b180\b", sin_comentarios), "quedó un 180 hardcodeado en stats.py"
    assert not re.search(r"\b2000\b", sin_comentarios), "quedó un 2000 hardcodeado en stats.py"

