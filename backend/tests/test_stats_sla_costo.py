"""KPIs de stats con SLA por OT y costo por máquina.

El SLA cumplido dejó de ser «tiempo de reparación <= 1440» y pasó a ser «se cerró antes de
su propio vencimiento». Las OTs viejas (sin `fecha_vencimiento`) conservan la regla anterior.

Las aserciones se hacen sobre el **efecto** en `efficiency` (el % de cumplimiento), no
replicando la fórmula: una OT lenta pero cerrada a tiempo no puede bajar el indicador, y una
rápida pero cerrada tarde tiene que bajarlo. Con la regla vieja pasaba exactamente lo
contrario, así que los tests discriminan de verdad.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio

from barb.core.config import settings
from barb.core.db import execute, fetch_one
from barb.routers import stats

SESION = {"usuario_id": 2, "empresa_id": 1, "rol": "gerente"}


def _hace(**delta) -> datetime:
    """Fecha naive (la columna es `timestamp without time zone`) en el pasado."""
    return datetime.now(UTC).replace(tzinfo=None) - timedelta(**delta)


@pytest_asyncio.fixture
async def ots(db_pool):
    creadas: list[int] = []

    async def crear(**campos) -> int:
        base = {
            "maquina_id": 1,
            "tecnico_id": 4,
            "creado_por": 2,
            "tipo": "corrective",
            "priority": "medium",
            "estado": "completed",
            "descripcion_problema": "OT de prueba de KPIs",
            "numero_ot": f"TEST-{uuid.uuid4().hex[:10]}",
        }
        base.update(campos)
        columnas = ", ".join(base.keys())
        valores = ", ".join(f"%({k})s" for k in base)
        fila = await fetch_one(
            f"INSERT INTO orden_trabajo ({columnas}) VALUES ({valores}) RETURNING ot_id", base
        )
        creadas.append(int(fila["ot_id"]))
        return int(fila["ot_id"])

    yield crear

    for ot_id in creadas:
        await execute("DELETE FROM orden_trabajo WHERE ot_id = %(o)s", {"o": ot_id})


async def _eficiencia() -> float:
    r = await stats.get_financial_impact(days=None, sesion=SESION)
    return float(r["financials"]["efficiency"])


@pytest.mark.asyncio
async def test_una_ot_lenta_pero_a_tiempo_no_baja_el_sla(ots):
    """
    Reparación de 5000 minutos (la regla vieja la reprobaba) pero cerrada ANTES de su
    vencimiento: cuenta como cumplida, así que el indicador no puede caer.
    """
    antes = await _eficiencia()

    await ots(
        tiempo_reparacion_min=5000,
        fecha_vencimiento=_hace(hours=1),
        fecha_cierre=_hace(hours=2),
    )

    despues = await _eficiencia()
    assert despues >= antes, (
        f"una OT cerrada a tiempo bajó el SLA ({antes} -> {despues}): "
        "se está midiendo el tiempo de reparación en vez del vencimiento"
    )


@pytest.mark.asyncio
async def test_una_ot_rapida_pero_tarde_baja_el_sla(ots):
    """
    Reparación de 10 minutos (la regla vieja la aprobaba) pero cerrada DESPUÉS de su
    vencimiento: no cuenta como cumplida, así que el indicador tiene que bajar.
    """
    antes = await _eficiencia()

    await ots(
        tiempo_reparacion_min=10,
        fecha_vencimiento=_hace(hours=5),
        fecha_cierre=_hace(hours=1),
    )

    despues = await _eficiencia()
    assert despues < antes, (
        f"una OT cerrada tarde no bajó el SLA ({antes} -> {despues}): "
        "no se está usando el vencimiento de la OT"
    )


@pytest.mark.asyncio
async def test_las_ots_sin_vencimiento_usan_la_regla_anterior(ots):
    """
    Compatibilidad con el histórico: sin `fecha_vencimiento` se compara el tiempo de
    reparación contra el SLA global, como antes.
    """
    antes = await _eficiencia()

    # Rápida y sin vencimiento: cumple por la regla vieja -> el indicador no baja.
    await ots(tiempo_reparacion_min=30, fecha_vencimiento=None, fecha_cierre=_hace(hours=1))

    despues = await _eficiencia()
    assert despues >= antes


@pytest.mark.asyncio
async def test_el_ahorro_usa_el_costo_de_la_maquina(ots):
    """
    El ahorro se valoriza con el costo de la máquina de la OT; si esa máquina no tiene costo
    propio (o la columna no existe), cae al global de la empresa. Se comprueba por
    diferencia, y el valor esperado se lee de la base para no atarse al dataset.
    """
    r = await stats.get_financial_impact(days=None, sesion=SESION)
    ahorro_antes = r["financials"]["ahorro_generado"]

    minutos = 42
    await ots(
        tiempo_reparacion_min=10,
        fecha_cierre=_hace(hours=1),
        fecha_vencimiento=_hace(days=1),
        downtime_minutes=minutos,
    )

    r = await stats.get_financial_impact(days=None, sesion=SESION)
    delta = r["financials"]["ahorro_generado"] - ahorro_antes

    maquina = await fetch_one("SELECT costo_inactividad_minuto FROM maquina WHERE maquina_id = 1")
    costo = maquina["costo_inactividad_minuto"] if maquina else None
    costo_minuto = float(costo) if costo is not None else float(settings.downtime_cost_per_minute)

    assert delta == pytest.approx(minutos * costo_minuto, rel=0.01)


@pytest.mark.asyncio
async def test_las_canceladas_no_suman_ahorro(ots):
    """Una OT cancelada no representa trabajo realizado: no valoriza inactividad evitada."""
    r = await stats.get_financial_impact(days=None, sesion=SESION)
    ahorro_antes = r["financials"]["ahorro_generado"]

    await ots(estado="cancelled", downtime_minutes=999, fecha_cierre=_hace(hours=1))

    r = await stats.get_financial_impact(days=None, sesion=SESION)
    assert r["financials"]["ahorro_generado"] == pytest.approx(ahorro_antes, rel=0.001)


@pytest.mark.asyncio
async def test_el_costo_global_sigue_expuesto_en_los_supuestos():
    """`costo_por_minuto` es el eco de la configuración: el valor que usa el fallback."""
    r = await stats.get_financial_impact(days=None, sesion=SESION)
    assert r["impacto_anual"]["supuestos"]["costo_por_minuto"] == settings.downtime_cost_per_minute
