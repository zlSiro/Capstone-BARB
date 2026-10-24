"""Tests del grafo del chat y de la primera Skill (HU-04 Fase 2).

Dos niveles:

- **Grafo con LLM falso**: se verifica el bucle `generate -> tools -> generate`, que es
  la parte que ninguna cadena lineal podía hacer. No gasta API ni depende del proveedor.
- **Tool real contra la base**: se comprueba que `consultar_ots_maquina` devuelve datos
  verdaderos de la empresa del usuario y que no ve los de otra.
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool

from barb.services import chat_graph
from barb.services.ai_tools import _buscar_maquinas, crear_tools
from barb.services.chat_graph import crear_grafo


class _LLMFalso:
    """Modelo guionado: primera respuesta pide la tool, la segunda redacta."""

    def __init__(self, respuestas: list[AIMessage]) -> None:
        self.respuestas = list(respuestas)
        self.llamadas: list[list] = []
        self.tools_vinculadas: list = []

    def bind_tools(self, tools):
        self.tools_vinculadas = list(tools)
        return self

    def with_retry(self, **_kwargs):
        return self

    async def ainvoke(self, mensajes):
        self.llamadas.append(list(mensajes))
        return self.respuestas.pop(0)


@tool("consultar_ots_maquina")
async def _tool_controlada(nombre_maquina: str) -> str:
    """Versión de prueba: misma firma y nombre, sin tocar la base.

    Args:
        nombre_maquina: Nombre del equipo a consultar.
    """
    return f"Órdenes de trabajo abiertas de {nombre_maquina}: 7 (pending=3, in_progress=4)."


@pytest.fixture(autouse=True)
def _retrieval_aislado(monkeypatch):
    """Los tests del grafo no deben tocar la base: el retrieval se neutraliza por defecto.

    El test que verifica el contexto lo vuelve a parchear con su propio contenido, y ese
    parche se aplica después y gana.
    """

    async def vacio(*_a, **_k):
        return []

    monkeypatch.setattr(chat_graph, "search_chunks", vacio)


@pytest.mark.asyncio
async def test_el_grafo_ejecuta_la_tool_y_vuelve_a_generar(monkeypatch):
    """Si el modelo pide la tool, el grafo la ejecuta y su resultado vuelve al prompt."""
    monkeypatch.setattr(chat_graph, "crear_tools", lambda _empresa: [_tool_controlada])

    pedido = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "consultar_ots_maquina",
                "args": {"nombre_maquina": "Compressor A1"},
                "id": "call_1",
                "type": "tool_call",
            }
        ],
    )
    final = AIMessage(content="El Compressor A1 tiene 7 OTs abiertas.")
    llm = _LLMFalso([pedido, final])

    grafo = crear_grafo(empresa_id=1, llm=llm)
    resultado = await grafo.ainvoke(
        {
            "messages": [HumanMessage(content="¿Cuántas OTs abiertas tiene el Compressor A1?")],
            "empresa_id": 1,
            "pistas": [],
            "contexto": "",
            "fragmentos": 0,
        }
    )

    # El modelo intervino DOS veces: la primera para pedir la tool, la segunda para
    # redactar con el resultado. Ese ida y vuelta es lo que el grafo agrega.
    assert len(llm.llamadas) == 2

    mensajes_segunda = llm.llamadas[1]
    tool_messages = [m for m in mensajes_segunda if isinstance(m, ToolMessage)]
    assert tool_messages, "el ToolMessage debe volver al prompt de la segunda generación"
    assert "7" in tool_messages[0].content
    assert tool_messages[0].tool_call_id == "call_1"

    assert resultado["messages"][-1].content == "El Compressor A1 tiene 7 OTs abiertas."


@pytest.mark.asyncio
async def test_el_grafo_expone_la_tool_al_modelo(monkeypatch):
    """`bind_tools` recibe la Skill: si no, el modelo no sabría que puede pedirla."""
    monkeypatch.setattr(chat_graph, "crear_tools", lambda _empresa: [_tool_controlada])
    llm = _LLMFalso([AIMessage(content="ok")])

    crear_grafo(empresa_id=1, llm=llm)

    assert [t.name for t in llm.tools_vinculadas] == ["consultar_ots_maquina"]


@pytest.mark.asyncio
async def test_sin_tool_calls_termina_sin_pasar_por_tools(monkeypatch):
    """El caso normal (solo RAG) no debe dar una vuelta extra por el nodo de tools."""
    monkeypatch.setattr(chat_graph, "crear_tools", lambda _empresa: [_tool_controlada])
    llm = _LLMFalso([AIMessage(content="Según el manual, el torque es 85 Nm.")])

    grafo = crear_grafo(empresa_id=1, llm=llm)
    resultado = await grafo.ainvoke(
        {
            "messages": [HumanMessage(content="¿Qué torque lleva el rodamiento?")],
            "empresa_id": 1,
            "pistas": ["torque"],
            "contexto": "Documento: Plan de Lubricación…",
            "fragmentos": 1,
        }
    )

    assert len(llm.llamadas) == 1
    assert resultado["messages"][-1].content.startswith("Según el manual")


@pytest.mark.asyncio
async def test_el_prompt_incluye_el_contexto_recuperado(monkeypatch):
    """El nodo `retrieve` alimenta al `generate`: sin eso el RAG no llegaría al modelo."""
    monkeypatch.setattr(chat_graph, "crear_tools", lambda _empresa: [_tool_controlada])

    async def chunks_falsos(*_a, **_k):
        return [
            {
                "chunk_id": 1,
                "documento_id": 1,
                "title": "Manual B7",
                "contenido": "Cambiar sello cada 800 h.",
                "rank": 0.9,
            }
        ]

    monkeypatch.setattr(chat_graph, "search_chunks", chunks_falsos)
    llm = _LLMFalso([AIMessage(content="Cada 800 horas.")])

    grafo = crear_grafo(empresa_id=1, llm=llm)
    await grafo.ainvoke(
        {
            "messages": [HumanMessage(content="¿Cada cuánto el sello?")],
            "empresa_id": 1,
            "pistas": ["sello"],
            "contexto": "",
            "fragmentos": 0,
        }
    )

    sistema = llm.llamadas[0][0]
    assert "Manual B7" in sistema.content
    assert "Cambiar sello cada 800 h." in sistema.content
    # El placeholder del prompt tiene que venir resuelto, no literal.
    assert "{context}" not in sistema.content


# ---------------------------------------------------------------------------
# La tool real, contra la base
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_la_tool_encuentra_una_maquina_real_y_cuenta_sus_ots(db_pool):
    """Integración: la Skill consulta datos verdaderos de la empresa 1 del seed."""
    tools = crear_tools(empresa_id=1)
    assert [t.name for t in tools] == ["consultar_ots_maquina"]

    salida = await tools[0].ainvoke({"nombre_maquina": "Compressor A1"})

    assert "Compressor A1" in salida
    assert "Órdenes de trabajo abiertas:" in salida


@pytest.mark.asyncio
async def test_la_tool_no_ve_maquinas_de_otra_empresa(db_pool):
    """El aislamiento no depende de lo que escriba el modelo: va en la clausura."""
    maquinas_e1 = await _buscar_maquinas(1, "Compressor A1")
    assert maquinas_e1, "el seed debería tener el Compressor A1 en la empresa 1"

    # La misma búsqueda desde otra empresa no debe encontrarla.
    maquinas_ajenas = await _buscar_maquinas(999, "Compressor A1")
    assert maquinas_ajenas == []


@pytest.mark.asyncio
async def test_la_tool_pide_aclaracion_si_no_hay_coincidencias(db_pool):
    tools = crear_tools(empresa_id=1)
    salida = await tools[0].ainvoke({"nombre_maquina": "Máquina Inexistente XYZ"})
    assert "No encontré ninguna máquina" in salida


@pytest.mark.asyncio
async def test_la_tool_no_explota_con_nombre_vacio(db_pool):
    tools = crear_tools(empresa_id=1)
    salida = await tools[0].ainvoke({"nombre_maquina": "   "})
    assert "Necesito el nombre" in salida
