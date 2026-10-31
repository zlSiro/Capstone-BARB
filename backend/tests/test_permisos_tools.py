"""El 403 de la API no se puede evadir por el chat.

`require_action("crear_ot")` protege el endpoint, pero **no** la tool: las tools no pasan por
las dependencias de FastAPI. Sin un chequeo explícito, un técnico que abra el chat podía crear
OTs que la API le rechaza con 403.

Estos tests fijan tres cosas:
  1. el permiso se evalúa en las DOS puntas (proponer y aprobar), y falla cerrado;
  2. el candado de dos pasos sigue intacto: no existe tool de creación directa;
  3. el grafo no escribe nada cuando el rol no puede.
"""

from __future__ import annotations

import logging

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from barb.core.db import fetch_one
from barb.services import chat_graph
from barb.services.ai_tools import (
    SIN_PERMISO_OT,
    _puede_crear_ot,
    _texto_propuesta,
    crear_ot_aprobada,
    crear_planta_aprobada,
    crear_tools,
)
from barb.services.chat_graph import crear_grafo

TECNICO = "tecnico"
GERENTE = "gerente"

PROBLEMA = "Ruido metálico al arrancar desde ayer"


def _tools(rol: str, empresa_id: int = 1, usuario_id: int = 1) -> dict:
    return {t.name: t for t in crear_tools(empresa_id=empresa_id, usuario_id=usuario_id, rol=rol)}


# =============================================================================
# La matriz de permisos, mirada desde la tool
# =============================================================================


@pytest.mark.parametrize(
    "rol, esperado",
    [("gerente", True), ("admin", True), ("tecnico", False), ("operador", False), (None, False)],
)
def test_el_permiso_es_el_mismo_que_exige_el_endpoint(rol, esperado):
    """Gerente y admin crean OTs; el resto no. Un rol nulo o vacío no revienta."""
    assert _puede_crear_ot(rol) is esperado


def test_un_rol_desconocido_falla_cerrado():
    """`puede_ejecutar_accion` lanza 403 si el rol no está en la matriz: no debe propagar."""
    assert _puede_crear_ot("rol_que_no_existe") is False


# =============================================================================
# proponer_ot: la propuesta tampoco se le ofrece a quien no puede crear
# =============================================================================


@pytest.mark.asyncio
async def test_el_tecnico_no_puede_proponer_ot():
    salida = await _tools(TECNICO)["proponer_ot"].ainvoke({"nombre_maquina": "Compressor A1", "descripcion_problema": PROBLEMA})
    assert salida == SIN_PERMISO_OT


@pytest.mark.asyncio
async def test_el_gerente_si_puede_proponer_ot(db_pool, caplog):
    """Contraprueba: con permiso, la propuesta sale y NO escribe."""
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")
    with caplog.at_level(logging.WARNING):
        salida = await _tools(GERENTE)["proponer_ot"].ainvoke(
            {"nombre_maquina": "Compressor A1", "descripcion_problema": PROBLEMA}
        )
    despues = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    assert salida != SIN_PERMISO_OT
    assert salida.startswith("PROPUESTA DE ORDEN DE TRABAJO")
    assert despues["n"] == antes["n"], "proponer no debe insertar nada"


# =============================================================================
# crear_ot_aprobada: aunque llegue a la aprobación, no escribe
# =============================================================================


@pytest.mark.asyncio
async def test_el_tecnico_no_crea_la_ot_aunque_confirme(db_pool):
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    salida = await crear_ot_aprobada(
        consulta_maquina="Compressor A1",
        problema=PROBLEMA,
        prioridad="high",
        empresa_id=1,
        usuario_id=4,
        rol=TECNICO,
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")
    assert salida == SIN_PERMISO_OT
    assert despues["n"] == antes["n"], "un técnico no debe poder crear OTs por el chat"


@pytest.mark.asyncio
async def test_otra_empresa_no_crea_aunque_sea_gerente(db_pool):
    """Ser gerente de la empresa 2 no habilita a crear OTs sobre una máquina de la 1."""
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    salida = await crear_ot_aprobada(
        consulta_maquina="Compressor A1",
        problema=PROBLEMA,
        prioridad="high",
        empresa_id=2,
        usuario_id=17,
        rol=GERENTE,
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")
    assert salida != SIN_PERMISO_OT  # el rol sí puede; el problema es la empresa
    assert "no existe" in salida.lower() or "no encontré" in salida.lower()
    assert despues["n"] == antes["n"]


# =============================================================================
# El candado de dos pasos sigue intacto
# =============================================================================


def test_no_existe_una_tool_de_creacion_directa():
    """
    La creación vive en `crear_ot_aprobada`, que NO es una tool: el modelo no la ve y no
    puede llamarla. Si algún día vuelve a serlo, el candado deja de existir.
    """
    nombres = set(_tools(GERENTE))
    # HU-26: el universo creó a 5 con las Skills de topología. Las escrituras siguen
    # detrás del candado: las tools solo PROPONEN; las `_aprobada` (que escriben) nunca
    # son tools.
    assert nombres == {
        "consultar_ots_maquina",
        "proponer_ot",
        "listar_maquinas_planta",
        "actualizar_parametros_maquina",
        "proponer_planta_completa",
    }
    assert "crear_ot" not in nombres
    assert "crear_ot_aprobada" not in nombres
    assert "crear_planta_aprobada" not in nombres
    # Una función común tiene __name__; una @tool además expone .name.
    assert not hasattr(crear_ot_aprobada, "name")
    assert not hasattr(crear_planta_aprobada, "name")


# =============================================================================
# El grafo completo
# =============================================================================


class _LLMFalso:
    """Modelo guionado (mismo patrón que test_candado_ot.py)."""

    def __init__(self, respuestas: list[AIMessage]) -> None:
        self.respuestas = list(respuestas)

    def bind_tools(self, tools):
        return self

    def with_retry(self, **_kwargs):
        return self

    async def ainvoke(self, mensajes):
        return self.respuestas.pop(0) if self.respuestas else AIMessage(content="listo")


@pytest.fixture(autouse=True)
def _sin_retrieval(monkeypatch):
    async def vacio(*_a, **_k):
        return []

    monkeypatch.setattr(chat_graph, "search_chunks", vacio)


@pytest.mark.asyncio
async def test_el_grafo_no_crea_ot_con_un_tecnico(db_pool):
    """Un técnico que confirma una propuesta no crea nada: el gate también valida."""
    propuesta = _texto_propuesta(
        {"nombre": "Compressor A1", "codigo": "COMP-A1", "planta": "Planta Norte"},
        PROBLEMA,
        "high",
    )
    antes = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    grafo = crear_grafo(empresa_id=1, llm=_LLMFalso([]), usuario_id=4, rol=TECNICO)
    estado = await grafo.ainvoke(
        {
            "messages": [AIMessage(content=propuesta), HumanMessage(content="sí, confirmo")],
            "empresa_id": 1,
            "pistas": [],
            "contexto": "",
            "fragmentos": 0,
        }
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")
    ultimo = estado["messages"][-1]
    assert SIN_PERMISO_OT in str(ultimo.content)
    assert despues["n"] == antes["n"]
