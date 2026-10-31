"""Skills de acción sobre OTs: `proponer_ot` (la tool) y `crear_ot_aprobada` (el INSERT).

Lo que se prueba acá es lo que podría salir caro: que la propuesta no toque la base, que
el INSERT (que solo ejecuta el gate tras la confirmación) no invente la máquina, que no
duplique, que la OT quede coherente en la base y que el aislamiento entre empresas se
mantenga (el `empresa_id` viaja cerrado; el modelo nunca lo ve).

Cada test limpia lo que crea: la base es compartida con el resto de la suite.
"""

from __future__ import annotations

import re

import pytest
from langchain_core.messages import AIMessage

from barb.core.db import execute, fetch_all, fetch_one
from barb.services.ai_tools import (
    _PREFIJO_PROPUESTA,
    crear_ot_aprobada,
    crear_tools,
    propuesta_pendiente,
)

_NUMERO = re.compile(r"(OT-IA-\d{8}-\d{6}-[0-9A-F]{4})")


async def _limpiar(numeros: list[str]) -> None:
    for numero in numeros:
        await execute("DELETE FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": numero})


def _numero(salida: str) -> str | None:
    encontrado = _NUMERO.search(salida or "")
    return encontrado.group(1) if encontrado else None


@pytest.fixture
def tools_chat():
    # admin (usuario 1, empresa 1): no es técnico, así que la OT se asignaría a un técnico.
    return {t.name: t for t in crear_tools(empresa_id=1, usuario_id=1, rol="admin")}


@pytest.mark.asyncio
async def test_crear_ot_crea_una_ot_real_y_coherente(db_pool):
    """La fila creada tiene que ser una OT válida, no un registro a medias."""
    salida = await crear_ot_aprobada(
        "Compresor A1",
        "Vibración y ruido metálico al arrancar, desde ayer",
        "alta",
        empresa_id=1,
        usuario_id=1,
        rol="admin",
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
async def test_crear_ot_no_duplica_la_misma_orden(db_pool):
    """
    Protección contra el doble llamado: el modelo puede repetir la tool, o el grafo
    reintentar tras un error, y el usuario no debe ver dos OTs iguales.
    """
    datos = ("Compresor A1", "Fuga de aceite en la tapa del cárter", "medium")
    primera = await crear_ot_aprobada(*datos, empresa_id=1, usuario_id=1, rol="admin")
    segunda = await crear_ot_aprobada(*datos, empresa_id=1, usuario_id=1, rol="admin")

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
async def test_crear_ot_no_crea_nada_si_la_maquina_no_existe(db_pool):
    """Un nombre inventado no puede terminar en una OT; la tool sugiere equipos reales."""
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    salida = await crear_ot_aprobada(
        "S1",
        "Falla total del equipo",
        "medium",
        empresa_id=1,
        usuario_id=1,
        rol="admin",
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")
    assert antes["n"] == despues["n"], "no debe crearse ninguna OT"
    assert "No encontré" in salida
    assert "Estas son las disponibles" in salida


@pytest.mark.asyncio
async def test_proponer_ot_pide_detalle_si_la_descripcion_es_corta(db_pool, tools_chat):
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    salida = await tools_chat["proponer_ot"].ainvoke({"nombre_maquina": "Compresor A1", "descripcion_problema": "falla"})

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

    salida = await crear_ot_aprobada(
        "Compressor A1",  # es de la empresa 1
        "Intento de escritura cruzada entre empresas",
        "medium",
        empresa_id=2,
        usuario_id=17,
        # Gerente de la empresa 2: tiene permiso para crear OTs, asi el test llega
        # al resolver y mide lo que dice medir (aislamiento por empresa). Con un
        # tecnico el corte ocurriria antes, en el chequeo de permisos.
        rol="gerente",
    )

    despues = await fetch_one(
        "SELECT COUNT(*) AS n FROM orden_trabajo ot JOIN maquina m ON m.maquina_id = ot.maquina_id "
        "JOIN planta p ON p.planta_id = m.planta_id WHERE p.empresa_id = 1"
    )
    assert antes["n"] == despues["n"], "la empresa 2 escribió en la empresa 1"
    assert "No encontré" in salida


@pytest.mark.asyncio
async def test_el_grafo_bindea_las_dos_skills(db_pool):
    """El modelo tiene que ver las dos tools: consultar y PROponer (jamás una que escriba)."""
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
    # HU-26: el universo de Skills creó a 5. Ninguna escribe sin confirmación.
    assert nombres == [
        "actualizar_parametros_maquina",
        "consultar_ots_maquina",
        "listar_maquinas_planta",
        "proponer_ot",
        "proponer_planta_completa",
    ]


# ---------------------------------------------------------------------------
# El candado (CGBIDA-476): proponer nunca inserta y el texto es parseable
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_proponer_ot_no_toca_la_base(db_pool, tools_chat):
    """El candado estructural: proponer valida y redacta, pero NO inserta nada."""
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    salida = await tools_chat["proponer_ot"].ainvoke(
        {
            "nombre_maquina": "Compressor A1",
            "descripcion_problema": "Ruido metálico al arrancar, desde ayer",
            "prioridad": "alta",
        }
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")
    assert antes["n"] == despues["n"], "la propuesta no debe crear filas"
    assert salida.startswith(_PREFIJO_PROPUESTA), "la propuesta tiene formato parseable"


@pytest.mark.asyncio
async def test_la_propuesta_persistida_es_parseable_por_el_gate(db_pool, tools_chat):
    """El texto que queda en el historial es lo que el gate re-parsea al turno siguiente."""
    salida = await tools_chat["proponer_ot"].ainvoke(
        {
            "nombre_maquina": "Compressor A1",
            "descripcion_problema": "Ruido metálico al arrancar, desde ayer",
            "prioridad": "alta",
        }
    )
    borrador = propuesta_pendiente([AIMessage(content=salida)])
    assert borrador is not None, "la propuesta se reconoce en el historial"
    assert borrador["consulta_maquina"] == "Compressor A1"
    assert borrador["problema"] == "Ruido metálico al arrancar, desde ayer"
    assert borrador["prioridad"] == "high", "«alta» se normaliza antes de persistir"
