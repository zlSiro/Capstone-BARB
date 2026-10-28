"""SLA efectivo: la máquina dice cuánto tolera, la prioridad dice cuánto de eso se usa.

Antes el vencimiento de una OT solo se guardaba si el cliente lo mandaba (y la UI nunca lo
mandaba), así que todas las OTs nacían sin plazo. Ahora se calcula:

    plazo = SLA de la máquina (o el global) × factor de prioridad
    fecha_vencimiento = fecha_creacion + plazo

Las columnas `sla_horas` pueden no existir todavía en la base: en ese caso se usa el SLA
global y el cálculo no falla.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from psycopg import errors as pg_errors

from barb.core.config import settings
from barb.core.db import execute, fetch_one
from barb.routers import work_orders


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "prioridad, factor",
    [("urgent", 0.5), ("high", 0.75), ("medium", 1.0), ("low", 1.5)],
)
async def test_el_factor_de_prioridad_acorta_o_estira_el_plazo(monkeypatch, prioridad, factor):
    """Con un SLA de máquina de 8 h, cada prioridad da su propio plazo."""

    async def con_sla(*_a, **_k):
        return {"sla_horas": 8}

    monkeypatch.setattr(work_orders, "fetch_one", con_sla)

    minutos = await work_orders._sla_efectivo_minutos(1, prioridad)

    assert minutos == int(round(8 * 60 * factor))


@pytest.mark.asyncio
async def test_sin_sla_de_maquina_usa_el_global(monkeypatch):
    """`sla_horas` en NULL = la máquina hereda el SLA de la empresa."""

    async def sin_sla(*_a, **_k):
        return {"sla_horas": None}

    monkeypatch.setattr(work_orders, "fetch_one", sin_sla)

    minutos = await work_orders._sla_efectivo_minutos(1, "medium")

    assert minutos == settings.sla_target_minutes


@pytest.mark.asyncio
async def test_si_la_columna_no_existe_usa_el_global_y_no_rompe(monkeypatch):
    """La base puede no tener `sla_horas` todavía: no es un error del usuario."""

    async def explota(*_a, **_k):
        raise pg_errors.UndefinedColumn("column \"sla_horas\" does not exist")

    monkeypatch.setattr(work_orders, "fetch_one", explota)

    minutos = await work_orders._sla_efectivo_minutos(1, "urgent")

    assert minutos == int(settings.sla_target_minutes * 0.5)


@pytest_asyncio.fixture
async def ot_creada(client, db_pool):
    """Crea una OT real con el gerente de la empresa 1 y la borra al terminar."""
    from barb.core.db import fetch_all

    token = f"test-sla-{uuid.uuid4().hex[:8]}"
    await execute(
        "INSERT INTO sesion (token, usuario_id, expira_en) "
        "VALUES (%(t)s, 2, NOW() + INTERVAL '10 minutes')",
        {"t": token},
    )
    h = {"Authorization": f"Bearer {token}"}

    creadas: list[str] = []

    async def crear(**extra):
        payload = {
            "maquina_id": 1,
            "tecnico_id": 4,
            "descripcion_problema": "Prueba de SLA efectivo",
            "tipo": "corrective",
            **extra,
        }
        r = await client.post("/api/work-orders", headers=h, json=payload)
        # Se registra antes de validar para que la limpieza corra aunque el test falle.
        if r.status_code in (200, 201):
            creadas.append(r.json()["numero_ot"])
        assert r.status_code in (200, 201), r.text
        return r.json()

    yield crear

    for numero in creadas:
        await execute("DELETE FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": numero})
    await execute("DELETE FROM sesion WHERE token = %(t)s", {"t": token})


@pytest.mark.asyncio
async def test_la_ot_nace_con_vencimiento_calculado(ot_creada):
    """
    Sin `fecha_vencimiento` en el payload, la OT igual queda con plazo.

    Se comprara contra el SLA global porque en esta base la columna `sla_horas` todavía no
    existe; si se corre el ALTER, el test sigue valiendo (usa el mismo camino).
    """
    ot = await ot_creada(priority="urgent")

    fila = await fetch_one(
        """
        SELECT fecha_vencimiento, fecha_creacion
          FROM orden_trabajo WHERE numero_ot = %(n)s
        """,
        {"n": ot["numero_ot"]},
    )

    assert fila["fecha_vencimiento"] is not None, "la OT debe nacer con plazo"

    # El plazo esperado se calcula con el SLA real de la máquina, no con una constante del
    # test: si la base ya tiene `sla_horas` poblado (lo está), manda ese valor.
    maquina = await fetch_one("SELECT sla_horas FROM maquina WHERE maquina_id = 1")
    sla_maquina = maquina["sla_horas"] if maquina else None
    base_min = float(sla_maquina) * 60 if sla_maquina else settings.sla_target_minutes
    esperado = base_min * 0.5  # urgent

    delta_min = (fila["fecha_vencimiento"] - fila["fecha_creacion"]).total_seconds() / 60
    assert abs(delta_min - esperado) <= max(2.0, esperado * 0.02), (
        f"plazo inesperado: {delta_min} min (esperado ~{esperado})"
    )


@pytest.mark.asyncio
async def test_el_vencimiento_explicito_del_cliente_se_respeta(ot_creada):
    """Si el cliente manda una fecha, manda el cliente: no se sobreescribe."""
    ot = await ot_creada(
        priority="urgent", fecha_vencimiento="2027-01-15T10:00:00"
    )

    fila = await fetch_one(
        "SELECT fecha_vencimiento FROM orden_trabajo WHERE numero_ot = %(n)s",
        {"n": ot["numero_ot"]},
    )

    assert fila["fecha_vencimiento"].year == 2027
    assert fila["fecha_vencimiento"].month == 1
    assert fila["fecha_vencimiento"].day == 15
