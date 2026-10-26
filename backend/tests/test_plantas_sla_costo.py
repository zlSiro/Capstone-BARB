"""SLA y costo de inactividad por máquina: el código está listo, la base manda.

Las columnas `sla_horas` y `costo_inactividad_minuto` de `maquina` todavía no existen en
el esquema del repositorio (AGENTS.md prohíbe migrar), así que el router se adapta:

- Sin columnas: el mantenedor sigue funcionando igual (los campos se devuelven en `null`).
- Si alguien envía valores y las columnas no están: 503 con el SQL exacto, en vez de
  ignorarlos en silencio y hacerle creer que se guardaron.

Cuando el SQL se corra, estos tests siguen valiendo: el que simula la ausencia fuerza el
flag de detección, así que no depende del estado real de la base.
"""

from __future__ import annotations

import uuid

import pytest

from barb.core.db import execute, fetch_one
from barb.routers import catalog


@pytest.fixture(autouse=True)
def _restaurar_cache():
    """El flag de detección es global y memorizado: se aísla entre tests."""
    previo = catalog._sla_costo_disponibles_cache
    yield
    catalog._sla_costo_disponibles_cache = previo


@pytest.fixture
async def planta(db_pool):
    """Planta propia para no tocar los datos del seed."""
    sufijo = uuid.uuid4().hex[:8]
    empresa = await fetch_one("SELECT empresa_id FROM empresa ORDER BY empresa_id LIMIT 1")
    fila = await fetch_one(
        """
        INSERT INTO planta (empresa_id, nombre, ubicacion)
        VALUES (%(e)s, %(n)s, 'Santiago')
        RETURNING planta_id
        """,
        {"e": empresa["empresa_id"], "n": f"Planta SLA {sufijo}"},
    )
    yield fila["planta_id"]
    # Las máquinas que creó el test primero: `maquina.planta_id` no tiene CASCADE.
    await execute("DELETE FROM maquina WHERE planta_id = %(p)s", {"p": fila["planta_id"]})
    await execute("DELETE FROM planta WHERE planta_id = %(p)s", {"p": fila["planta_id"]})


@pytest.mark.asyncio
async def test_sin_columnas_el_listado_sigue_funcionando_y_devuelve_nulls(db_pool):
    """Lo más importante: que falten las columnas no puede romper el mantenedor."""
    catalog._sla_costo_disponibles_cache = False

    filas = await catalog.get_machines(None, {"usuario_id": 1, "empresa_id": 1, "rol": "admin"})

    assert filas, "el seed debería tener máquinas"
    assert all("sla_horas" in fila and "costo_inactividad_minuto" in fila for fila in filas)
    assert all(fila["sla_horas"] is None for fila in filas)


@pytest.mark.asyncio
async def test_crear_maquina_con_sla_sin_columnas_devuelve_503_explicativo(db_pool, planta):
    """
    No se descarta el dato en silencio: si el usuario cargó un SLA y la base no tiene la
    columna, se le dice qué SQL correr.
    """
    catalog._sla_costo_disponibles_cache = False

    with pytest.raises(catalog.HTTPException) as exc:
        await catalog.add_maquina(
            planta_id=planta,
            payload=catalog.MaquinaNuevaRequest(
                nombre="Compresor SLA",
                codigo=f"CS-{uuid.uuid4().hex[:4]}",
                sla_horas=8,
            ),
            sesion={"usuario_id": 1, "empresa_id": 1, "rol": "admin"},
        )

    detalle = exc.value.detail
    assert exc.value.status_code == 503
    assert "sla_horas" in detalle
    assert "ALTER TABLE maquina" in detalle, "el mensaje debe traer el SQL a correr"

    # Y no se creó nada a medias.
    creada = await fetch_one(
        "SELECT 1 FROM maquina WHERE nombre = 'Compresor SLA' AND planta_id = %(p)s",
        {"p": planta},
    )
    assert creada is None


@pytest.mark.asyncio
async def test_crear_maquina_sin_sla_funciona_igual_sin_columnas(db_pool, planta):
    """El camino de siempre (sin SLA) no puede depender de que las columnas existan."""
    catalog._sla_costo_disponibles_cache = False

    creada = await catalog.add_maquina(
        planta_id=planta,
        payload=catalog.MaquinaNuevaRequest(
            nombre="Bomba sin SLA", codigo=f"BS-{uuid.uuid4().hex[:4]}"
        ),
        sesion={"usuario_id": 1, "empresa_id": 1, "rol": "admin"},
    )

    assert creada.maquina_id > 0
    assert creada.sla_horas is None
