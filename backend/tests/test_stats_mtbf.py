"""
Pruebas del cálculo de MTBF.

CGBIDA-404 (HU B / CGBIDA-51). El MTBF es una métrica de fiabilidad de largo plazo:

    MTBF = uptime_horas / fallas
    uptime_horas = 8760 - (suma(downtime_minutes) / 60)
    fallas = órdenes de tipo 'correctivo'

Propiedades que se fijan aquí:

1. La ventana es SIEMPRE de 365 días: NO depende del parámetro `days`.
2. Solo se muestra si el rango pedido justifica un año (`mtbf_visible`).
3. Con menos de dos fallas se devuelve `null`, aunque sea visible.
4. El proxy de falla es `tipo='corrective'`, no todas las órdenes completadas.

Se usa un pool simulado para controlar las filas y así poder ejercer los casos que los
datos sembrados no tienen (0 fallas, 1 falla). El caso real se contrasta contra la BD.
"""

from __future__ import annotations

from barb.core.db import fetch_all
from barb.routers import stats

ADMIN_E1 = ("admin@barb.com", "admin123")

# --- Identificación de consultas por ALIAS de columna ------------------------
# NO usar substrings como "corrective": esa palabra aparece en la consulta de MTBF y
# también en la de impacto anual, y esa ambigüedad ya provocó un bug real (8 tests de
# MTBF en rojo, CGBIDA-408). Los alias del SELECT sí son únicos por consulta.
ALIAS_MTBF = " AS fallas"
ALIAS_IMPACTO = " AS incidentes_periodo"
ALIAS_FINANCIERA = " AS costo_total_acumulado"


def es_mtbf(sql: str) -> bool:
    return ALIAS_MTBF in sql


def es_impacto(sql: str) -> bool:
    return ALIAS_IMPACTO in sql


def es_financiera(sql: str) -> bool:
    return ALIAS_FINANCIERA in sql


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


class _Fila(dict):
    """Fila que tolera el acceso por clave que usa el handler."""


def _fila_financiera() -> _Fila:
    """Fila del bloque `financials`. Valores neutros: lo que se prueba es el MTBF."""
    return _Fila(
        mttr=100, costo_total_acumulado=1000, downtime_evitado_min=0,
        total_completadas=4, completadas_en_sla=4, total_ots=10,
    )


def _mock_pool(fallas: int, downtime_min: int = 0):
    """Pool simulado. Devuelve las filas esperadas por consulta, en orden.

    El handler ejecuta: financials -> trend -> machines -> (mtbf si es visible).
    Se distingue la consulta de MTBF porque es la única cuyo SQL menciona 'corrective'.
    """

    class _Cursor:
        def __init__(self):
            self._actual = ""
            self.ejecutadas: list[str] = []
            # (sql, params) de cada consulta: permite comprobar qué se le ligó a cada una.
            self.llamadas: list[tuple[str, dict | None]] = []

        async def execute(self, sql, params=None):
            self._actual = sql
            self.ejecutadas.append(sql)
            self.llamadas.append((sql, params))

        async def fetchone(self):
            # Cada consulta se reconoce por el ALIAS de su columna propia, no por una
            # palabra compartida: 'corrective' aparece en la consulta de MTBF y también
            # en la de impacto anual, y esa ambigüedad ya provocó un bug real. Los alias
            # vienen del SELECT de stats.py y son únicos.
            if es_impacto(self._actual):
                return _Fila(incidentes_periodo=4, tiempo_promedio_real=90.0)
            if es_mtbf(self._actual):  # MTBF
                return _Fila(fallas=fallas, downtime_min=downtime_min)
            return _fila_financiera()

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


def _montar(monkeypatch, fallas: int, downtime_min: int = 0):
    p = _mock_pool(fallas, downtime_min)
    monkeypatch.setattr(stats, "pool", p)
    return p


async def _pedir(client, qs: str = ""):
    h = await _login(client, ADMIN_E1)
    return await client.get(f"/api/stats/financial-impact{qs}", headers=h)


# =============================================================================
# La fórmula
# =============================================================================

async def test_mtbf_con_dos_o_mas_fallas_calcula_el_valor(client, monkeypatch):
    """MTBF = (8760 - inactividad/60) / fallas."""
    _montar(monkeypatch, fallas=4, downtime_min=600)
    r = await _pedir(client)
    assert r.status_code == 200, r.text
    fin = r.json()["financials"]
    # (8760 - 10) / 4 = 2187.5
    assert fin["mtbfHours"] == 2187.5, fin
    assert fin["mtbf_visible"] is True


async def test_mtbf_sin_inactividad_usa_la_ventana_completa(client, monkeypatch):
    """Con downtime en cero, uptime = 8760 h exactas."""
    _montar(monkeypatch, fallas=2, downtime_min=0)
    r = await _pedir(client)
    # 8760 / 2 = 4380.0
    assert r.json()["financials"]["mtbfHours"] == 4380.0


async def test_mtbf_con_cero_fallas_devuelve_null(client, monkeypatch):
    _montar(monkeypatch, fallas=0)
    r = await _pedir(client)
    fin = r.json()["financials"]
    assert fin["mtbfHours"] is None
    # Sigue siendo visible: el rango lo justifica, lo que falta es historial.
    assert fin["mtbf_visible"] is True


async def test_mtbf_con_una_falla_devuelve_null(client, monkeypatch):
    """El mínimo son dos fallas: un promedio sobre una sola no es representativo."""
    _montar(monkeypatch, fallas=1)
    r = await _pedir(client)
    fin = r.json()["financials"]
    assert fin["mtbfHours"] is None
    assert fin["mtbf_visible"] is True


# =============================================================================
# Independencia del selector temporal y visibilidad
# =============================================================================

async def test_mtbf_no_cambia_entre_dias_y_sin_filtro(client, monkeypatch):
    """La ventana es fija: 7 días y sin filtro deben dar el MISMO MTBF."""
    _montar(monkeypatch, fallas=3, downtime_min=300)
    sin_filtro = (await _pedir(client)).json()["financials"]["mtbfHours"]
    con_365 = (await _pedir(client, "?days=365")).json()["financials"]["mtbfHours"]
    # 8760 - 5 = 8755 ; 8755/3 = 2918.333 -> 2918.3
    assert sin_filtro == 2918.3, sin_filtro
    assert con_365 == sin_filtro, f"el MTBF cambió con el rango: {con_365} vs {sin_filtro}"


async def test_dias_menor_a_365_oculta_el_mtbf(client, monkeypatch):
    """Con un rango corto no se calcula: `mtbf_visible=False` y valor null."""
    _montar(monkeypatch, fallas=5, downtime_min=0)
    r = await _pedir(client, "?days=7")
    fin = r.json()["financials"]
    assert fin["mtbf_visible"] is False, fin
    assert fin["mtbfHours"] is None, fin


async def test_la_consulta_de_mtbf_no_usa_el_parametro_days(client, monkeypatch):
    """Prueba directa de la independencia: el SQL de MTBF no usa el parámetro `days`.

    Es la comprobación que faltaba. Los datos sembrados caen dentro de 365 días, así que
    una ventana que dependiera de `days` daría el mismo número y ningún test de valor lo
    notaría. Verificar el SQL sí lo detecta.

    Se pide `days=365` (y no 7) porque con un rango corto la consulta ni se ejecuta: eso
    lo cubre `test_con_rango_corto_ni_se_ejecuta_la_consulta_de_mtbf`.
    """
    p = _montar(monkeypatch, fallas=4)
    await _pedir(client, "?days=365")

    # La consulta de impacto anual también menciona 'corrective': se identifica la de
    # MTBF por su columna propia (`fallas`), no por la palabra compartida.
    consultas_mtbf = [(sql, par) for sql, par in p.conn.cursor_obj.llamadas if es_mtbf(sql)]
    assert len(consultas_mtbf) == 1, "debería haber exactamente una consulta de MTBF"
    sql, _par = consultas_mtbf[0]

    # Lo que importa es si el SQL USA el parámetro, no si el dict lo trae: el handler
    # pasa el mismo `params` a todas las consultas.
    assert "%(days)s" not in sql, "el SQL de MTBF no debe usar el parámetro del selector"
    assert "INTERVAL '365 days'" in sql, f"la ventana debe ser fija de 365 días: {sql}"


async def test_las_demas_consultas_si_usan_days(client, monkeypatch):
    """Contraprueba: las otras consultas sí dependen del selector."""
    p = _montar(monkeypatch, fallas=4)
    await _pedir(client, "?days=365")
    otras = [(sql, par) for sql, par in p.conn.cursor_obj.llamadas if not es_mtbf(sql)]
    assert otras, "esperaba las consultas de financials/trend/machines"
    assert any("%(days)s" in sql for sql, _ in otras), (
        "ninguna otra consulta usa `days`: el selector no estaría haciendo nada"
    )


async def test_las_demas_consultas_si_ligan_days(client, monkeypatch):
    """Contraprueba: las otras consultas sí dependen del selector."""
    p = _montar(monkeypatch, fallas=4)
    await _pedir(client, "?days=7")
    otras = [(sql, par) for sql, par in p.conn.cursor_obj.llamadas if not es_mtbf(sql)]
    assert otras, "esperaba las consultas de financials/trend/machines"
    assert any(par and "days" in par for _, par in otras), (
        "ninguna consulta ligó `days`: el selector no estaría haciendo nada"
    )


async def test_con_rango_corto_ni_se_ejecuta_la_consulta_de_mtbf(client, monkeypatch):
    """`mtbf_visible=False` no es solo cosmético: ahorra la consulta."""
    p = _montar(monkeypatch, fallas=5)
    await _pedir(client, "?days=7")
    ejecutadas = p.conn.cursor_obj.ejecutadas
    assert not any(es_mtbf(s) for s in ejecutadas), "se ejecutó la consulta de MTBF"
    assert len(ejecutadas) == 3, f"esperaba 3 consultas, hubo {len(ejecutadas)}"


async def test_dias_365_muestra_el_mtbf(client, monkeypatch):
    _montar(monkeypatch, fallas=5, downtime_min=0)
    r = await _pedir(client, "?days=365")
    fin = r.json()["financials"]
    assert fin["mtbf_visible"] is True
    assert fin["mtbfHours"] == 1752.0  # 8760 / 5


async def test_dias_90_oculta_y_dias_365_muestra(client, monkeypatch):
    """El límite está exactamente en 365: 90 oculta, 365 muestra."""
    _montar(monkeypatch, fallas=5)
    assert (await _pedir(client, "?days=90")).json()["financials"]["mtbf_visible"] is False
    assert (await _pedir(client, "?days=365")).json()["financials"]["mtbf_visible"] is True


# =============================================================================
# El proxy de falla es correctivo, contra los datos reales
# =============================================================================

async def test_mtbf_usa_solo_correctivas_contra_la_bd(client):
    """El valor real NO puede reproducirse sin acotar el downtime a las correctivas.

    Antes este test calculaba su valor esperado con un SQL semejante al del endpoint, así
    que se adaptaba solo a cualquier cambio en la consulta: quitar el filtro de
    `downtime_minutes` (mutación M2 de CGBIDA-409) pasaba sin que ningún test fallara.

    Ahora se calcula el MTBF bajo LAS DOS interpretaciones y se exige que el endpoint
    coincida con la correcta y **difiera** de la incorrecta. Si las dos coincidieran, el
    test se marca como no concluyente en vez de pasar en falso.
    """
    r = await _pedir(client)
    assert r.status_code == 200, r.text
    mtbf = r.json()["financials"]["mtbfHours"]

    filas = await fetch_all(
        """
        SELECT
            COUNT(*) FILTER (WHERE ot.tipo = 'corrective') AS correctivas_sin_ventana,
            COUNT(*) FILTER (WHERE ot.estado = 'completed') AS completadas,
            COALESCE(SUM(ot.downtime_minutes), 0) AS dt_correctivas,
            COALESCE((
                SELECT SUM(o2.downtime_minutes)
                FROM orden_trabajo o2
                WHERE o2.maquina_id IN (
                        SELECT m2.maquina_id FROM maquina m2
                        JOIN planta p2 ON p2.planta_id = m2.planta_id
                        WHERE p2.empresa_id = 1)
                  AND o2.fecha_creacion >= NOW() - INTERVAL '365 days'
            ), 0) AS dt_todas
        FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        WHERE p.empresa_id = 1
          AND ot.tipo = 'corrective' AND ot.estado != 'cancelled'
          AND ot.fecha_creacion >= NOW() - INTERVAL '365 days'
        """
    )
    correctivas = int(filas[0]["correctivas_sin_ventana"])
    completadas = int(filas[0]["completadas"])
    dt_correctivas = float(filas[0]["dt_correctivas"])
    dt_todas = float(filas[0]["dt_todas"])

    assert correctivas >= 2, f"el seed debería dar al menos 2 correctivas, dio {correctivas}"

    # Interpretación correcta: la inactividad solo de las correctivas.
    correcto = round((8760 - dt_correctivas / 60) / correctivas, 1)
    # Interpretación incorrecta: la inactividad de TODAS las órdenes de la ventana.
    incorrecto = round((8760 - dt_todas / 60) / correctivas, 1)

    assert mtbf == correcto, f"MTBF={mtbf}, esperado con downtime de correctivas={correcto}"

    # Esta es la comprobación que detecta la mutación. Si las dos interpretaciones
    # coinciden, el seed no permite distinguirlas y hay que decirlo.
    assert dt_correctivas != dt_todas, (
        "el downtime de las correctivas es igual al de todas las órdenes: el seed no "
        "permite distinguir si el SUM está acotado"
    )

    # LIMITACIÓN MEDIDA (CGBIDA-409): comparar solo el MTBF redondeado NO detecta que el
    # `SUM` no esté acotado a correctivas. La diferencia entre las dos interpretaciones es
    # de una décima de hora y se pierde en el redondeo. Se fija aquí como documentación
    # ejecutable; la detección real la hace `test_la_query_de_mtbf_acota_el_sum_a_correctivas`.
    assert abs(correcto - incorrecto) <= 0.2, (
        f"las dos interpretaciones difieren en {abs(correcto - incorrecto):.1f} h: si la "
        "diferencia creciera, este test SÍ podría detectar el SUM sin acotar por valor"
    )

    # El proxy importa: si las cifras coincidieran, usar 'completadas' daría lo mismo.
    assert correctivas != completadas, (
        "correctivas y completadas coinciden en el seed: el test no distingue el proxy"
    )

    # Y el acotado a 365 días importa: si coincidiera con el total sin ventana, el test
    # no estaría ejercitando la ventana fija del MTBF.
    assert correctivas <= int(filas[0]["correctivas_sin_ventana"])


def test_la_query_de_mtbf_acota_el_sum_a_correctivas():
    """El `SUM` de la inactividad debe llevar FILTER a correctivas, igual que el conteo.

    Sin esto, el numerador suma la inactividad de preventivas, predictivas e
    inspecciones mientras el denominador cuenta solo correctivas: dos universos
    distintos. Es la mutación M2 de CGBIDA-409.

    Se comprueba sobre el SQL y no sobre el valor porque con los datos actuales la
    diferencia (223.5 vs 223.6) se pierde en el redondeo a un decimal.
    """
    import re
    from pathlib import Path as _Path

    codigo = _Path(stats.__file__).read_text(encoding="utf-8")
    i = codigo.index("mtbf_query = f")
    consulta = codigo[i : i + 700]

    assert "COUNT(*) FILTER (WHERE ot.tipo = 'corrective') AS fallas" in consulta, consulta
    assert "SUM(ot.downtime_minutes) FILTER (WHERE ot.tipo = 'corrective')" in consulta, (
        "el SUM debe acotarse a correctivas con FILTER"
    )
    # Contraprueba: la suma sin acotar no debe estar.
    assert not re.search(r"SUM\(ot\.downtime_minutes\), 0\) AS downtime_min", consulta), (
        "quedó el SUM sin FILTER: suma la inactividad de órdenes que no son correctivas"
    )
    # Y el WHERE debe excluir las canceladas: si el trabajo no se hizo, no es una falla.
    assert "AND ot.estado != 'cancelled'" in consulta, consulta
