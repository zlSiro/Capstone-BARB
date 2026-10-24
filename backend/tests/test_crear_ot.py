"""Skill de acción: `crear_ot`.

La IA crea una orden de trabajo real desde el chat. Lo que se prueba acá es lo que podría
salir caro: que no invente la máquina, que no duplique, que la OT quede coherente en la
base y que el aislamiento entre empresas se mantenga (el `empresa_id` va cerrado en la
tool; el modelo nunca lo ve).

Cada test limpia lo que crea: la base es compartida con el resto de la suite.
"""

from __future__ import annotations

import re

import pytest

from barb.core.db import execute, fetch_all, fetch_one
from barb.services.ai_tools import crear_tools

_NUMERO = re.compile(r"(OT-IA-\d{8}-\d{6}-[0-9A-F]{4})")


async def _limpiar(numeros: list[str]) -> None:
    for numero in numeros:
        await execute(
            "DELETE FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": numero}
        )


def _numero(salida: str) -> str | None:
    encontrado = _NUMERO.search(salida or "")
    return encontrado.group(1) if encontrado else None


@pytest.fixture
def crear_ot_tool():
    # admin (usuario 1, empresa 1): no es técnico, así que la OT se asigna a un técnico.
    return {t.name: t for t in crear_tools(empresa_id=1, usuario_id=1, rol="admin")}


@pytest.mark.asyncio
async def test_crear_ot_crea_una_ot_real_y_coherente(db_pool, crear_ot_tool):
    """La fila creada tiene que ser una OT válida, no un registro a medias."""
    salida = await crear_ot_tool["crear_ot"].ainvoke(
        {
            "nombre_maquina": "Compresor A1",
            "descripcion_problema": "Vibración y ruido metálico al arrancar, desde ayer",
            "prioridad": "alta",
        }
    )
    numero = _numero(salida)
    assert numero, f"la tool no informó el número de OT: {salida}"

    try:
        fila = await fetch_one(
            """
            SELECT ot.numero_ot, ot.estado, ot.tipo, ot.priority, ot.tecnico_id,
                   ot.creado_por, ot.descripcion_problema, ot.fecha_vencimiento,
                   m.nombre AS maquina
              FROM orden_trabajo ot
              JOIN maquina m ON m.maquina_id = ot.maquina_id
             WHERE ot.numero_ot = %(n)s
            """,
            {"n": numero},
        )
        assert fila is not None, "la OT no quedó en la base"
        assert fila["estado"] == "pending"
        assert fila["tipo"] == "corrective"
        assert fila["priority"] == "high", "«alta» debe normalizarse a high"
        assert fila["maquina"] == "Compressor A1"
        assert "Vibración y ruido metálico" in fila["descripcion_problema"]
        assert fila["creado_por"] == 1, "el creador es el usuario logueado"
        # Al no ser técnico, se asigna a un técnico real de la empresa.
        assert fila["tecnico_id"] is not None
        tecnico = await fetch_one(
            "SELECT rol, empresa_id FROM usuario WHERE usuario_id = %(u)s",
            {"u": fila["tecnico_id"]},
        )
        assert tecnico == {"rol": "tecnico", "empresa_id": 1}
        assert fila["fecha_vencimiento"] is not None, "la OT debe nacer con vencimiento"
    finally:
        await _limpiar([numero])


@pytest.mark.asyncio
async def test_crear_ot_no_duplica_la_misma_orden(db_pool, crear_ot_tool):
    """
    Protección contra el doble llamado: el modelo puede repetir la tool, o el grafo
    reintentar tras un error, y el usuario no debe ver dos OTs iguales.
    """
    datos = {
        "nombre_maquina": "Compresor A1",
        "descripcion_problema": "Fuga de aceite en la tapa del cárter",
    }
    primera = await crear_ot_tool["crear_ot"].ainvoke(datos)
    segunda = await crear_ot_tool["crear_ot"].ainvoke(datos)

    numeros = [n for n in (_numero(primera), _numero(segunda)) if n]
    try:
        assert "ya estaba creada" in segunda
        assert len(set(numeros)) == 1, f"se crearon dos OTs distintas: {numeros}"
        filas = await fetch_all(
            """
            SELECT COUNT(*) AS n FROM orden_trabajo
             WHERE numero_ot = ANY(%(nums)s)
            """,
            {"nums": numeros},
        )
        assert filas[0]["n"] == 1
    finally:
        await _limpiar(numeros)


@pytest.mark.asyncio
async def test_crear_ot_no_crea_nada_si_la_maquina_no_existe(db_pool, crear_ot_tool):
    """Un nombre inventado no puede terminar en una OT; la tool sugiere equipos reales."""
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    salida = await crear_ot_tool["crear_ot"].ainvoke(
        {"nombre_maquina": "S1", "descripcion_problema": "Falla total del equipo"}
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")
    assert antes["n"] == despues["n"], "no debe crearse ninguna OT"
    assert "No encontré" in salida
    assert "Estas son las disponibles" in salida


@pytest.mark.asyncio
async def test_crear_ot_pide_detalle_si_la_descripcion_es_vacia(db_pool, crear_ot_tool):
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    salida = await crear_ot_tool["crear_ot"].ainvoke(
        {"nombre_maquina": "Compresor A1", "descripcion_problema": "falla"}
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")
    assert antes["n"] == despues["n"]
    assert "descripción del problema" in salida


@pytest.mark.asyncio
async def test_crear_ot_no_escribe_en_otra_empresa(db_pool):
    """
    Clave de seguridad: el `empresa_id` va en la clausura. Un usuario de la empresa 2 no
    puede crear una OT sobre una máquina de la empresa 1 aunque el modelo insista.
    """
    antes = await fetch_one(
        "SELECT COUNT(*) AS n FROM orden_trabajo ot JOIN maquina m ON m.maquina_id = ot.maquina_id "
        "JOIN planta p ON p.planta_id = m.planta_id WHERE p.empresa_id = 1"
    )

    tools_empresa_2 = {t.name: t for t in crear_tools(empresa_id=2, usuario_id=20, rol="tecnico")}
    salida = await tools_empresa_2["crear_ot"].ainvoke(
        {
            "nombre_maquina": "Compressor A1",  # es de la empresa 1
            "descripcion_problema": "Intento de escritura cruzada entre empresas",
        }
    )

    despues = await fetch_one(
        "SELECT COUNT(*) AS n FROM orden_trabajo ot JOIN maquina m ON m.maquina_id = ot.maquina_id "
        "JOIN planta p ON p.planta_id = m.planta_id WHERE p.empresa_id = 1"
    )
    assert antes["n"] == despues["n"], "la empresa 2 escribió en la empresa 1"
    assert "No encontré" in salida


@pytest.mark.asyncio
async def test_el_grafo_bindea_las_dos_skills(db_pool):
    """El modelo tiene que ver las dos tools: consultar y crear."""
    from barb.services.chat_graph import crear_grafo

    class _Espia:
        def __init__(self):
            self.tools = None

        def bind_tools(self, tools):
            self.tools = tools
            return self

        def with_retry(self, **_k):
            return self

    espia = _Espia()
    crear_grafo(empresa_id=1, llm=espia, usuario_id=1, rol="admin")

    nombres = sorted(t.name for t in espia.tools)
    assert nombres == ["consultar_ots_maquina", "crear_ot"]
