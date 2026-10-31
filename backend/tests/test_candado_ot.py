"""El candado de la creación de OTs (CGBIDA-476).

Lo que garantiza el candado: el modelo NO tiene ninguna herramienta que escriba en la
base. Solo puede *proponer*; el INSERT lo ejecuta el gate del grafo con código, y solo si
el usuario confirma. Acá se prueban los caminos del gate (confirmar, rechazar, ambiguo,
sin propuesta, propuesta ya resuelta) y el streaming, sin base real: `crear_ot_aprobada`,
la resolución de máquinas y el retrieval se parchean igual que en `test_chat_graph.py`.

Los tests de integración contra la base real de `proponer_ot`/`crear_ot_aprobada` están
en `test_crear_ot.py`.
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from barb.services import ai_tools, chat_graph
from barb.services.ai_tools import TEXTO_RECHAZO, _texto_propuesta, crear_tools
from barb.services.chat_graph import astream_respuesta, crear_grafo


class _LLMFalso:
    """Modelo guionado: igual que en test_chat_graph.py."""

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


def _propuesta() -> str:
    maquina = {"nombre": "Compressor A1", "codigo": "COMP-A1", "planta": "Planta Norte"}
    return _texto_propuesta(maquina, "Ruido metálico al arrancar", "high")


def _entrada(mensajes) -> dict:
    return {
        "messages": mensajes,
        "empresa_id": 1,
        "pistas": [],
        "contexto": "",
        "fragmentos": 0,
    }


@pytest.fixture(autouse=True)
def _retrieval_aislado(monkeypatch):
    """El retrieval no corre en estos tests: el gate no depende de documentación."""

    async def vacio(*_a, **_k):
        return []

    monkeypatch.setattr(chat_graph, "search_chunks", vacio)


@pytest.fixture
def _maquina_conocida(monkeypatch):
    """proponer_ot resuelve la máquina sin tocar la base."""

    async def resolver(empresa_id, consulta, accion):
        return ({"nombre": "Compressor A1", "codigo": "COMP-A1", "planta": "Planta Norte"}, None)

    monkeypatch.setattr(ai_tools, "_resolver_maquina", resolver)


@pytest.fixture
def _insert_espia(monkeypatch):
    """Sustituto de crear_ot_aprobada: registra los args y devuelve una confirmación fija."""
    llamadas: list[tuple] = []

    async def insertar(consulta, problema, prioridad, empresa_id, usuario_id=None, rol=None):
        llamadas.append((consulta, problema, prioridad, empresa_id, usuario_id, rol))
        return "OT creada: **OT-IA-20261025-120000-ABCD**"

    monkeypatch.setattr(chat_graph, "crear_ot_aprobada", insertar)
    return llamadas


@pytest.mark.asyncio
async def test_el_modelo_solo_ve_tools_de_lectura_y_propuesta():
    """Criterio central del candado: no existe ninguna tool que escriba en la base."""
    herramientas = {t.name: t for t in crear_tools(empresa_id=1, usuario_id=1, rol="admin")}
    # HU-26: se agregaron las Skills de topología. Ninguna escribe sin confirmación.
    assert set(herramientas) == {
        "consultar_ots_maquina",
        "proponer_ot",
        "listar_maquinas_planta",
        "actualizar_parametros_maquina",
        "proponer_planta_completa",
    }


@pytest.mark.asyncio
async def test_el_turno_de_propuesta_termina_con_el_texto_exacto(_maquina_conocida):
    """El turno de propuesta NO vuelve a pasar por `generate`: el texto que se persiste es
    el exacto de la tool (formato parseable), y el modelo no re-redacta."""
    modelo = _LLMFalso(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "proponer_ot",
                        "args": {
                            "nombre_maquina": "Compressor A1",
                            "descripcion_problema": "Ruido metálico al arrancar",
                            "prioridad": "high",
                        },
                        "id": "call_1",
                    }
                ],
            )
        ]
    )
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=1, rol="admin")

    estado = await grafo.ainvoke(_entrada([HumanMessage(content="crea una OT por ruido")]))

    final = estado["messages"][-1]
    assert final.content == _propuesta(), "el texto persistido es el exacto de la propuesta"
    assert len(modelo.llamadas) == 1, "el modelo no re-redacta la propuesta"


@pytest.mark.asyncio
async def test_confirmacion_inserta_la_ot(_insert_espia):
    """Con propuesta pendiente y un «sí» claro, el gate ejecuta el INSERT con los datos
    parseados de la propuesta — y el modelo no participa."""
    modelo = _LLMFalso([AIMessage(content="esto no debería usarse")])
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=1, rol="admin")

    estado = await grafo.ainvoke(_entrada([AIMessage(content=_propuesta()), HumanMessage(content="sí, confirmo")]))

    final = estado["messages"][-1]
    assert final.content.startswith("OT creada: **OT-IA-")
    assert len(_insert_espia) == 1
    consulta, problema, prioridad, empresa_id, usuario_id, rol = _insert_espia[0]
    assert (consulta, problema, prioridad) == ("Compressor A1", "Ruido metálico al arrancar", "high")
    assert (empresa_id, usuario_id, rol) == (1, 1, "admin")
    assert len(modelo.llamadas) == 0, "la confirmación no vuelve a invocar al modelo"


@pytest.mark.asyncio
async def test_rechazo_no_inserta(_insert_espia):
    """Un rechazo explícito descarta la propuesta: no hay INSERT y se avisa."""
    modelo = _LLMFalso([AIMessage(content="esto no debería usarse")])
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=1, rol="admin")

    estado = await grafo.ainvoke(_entrada([AIMessage(content=_propuesta()), HumanMessage(content="no, espera")]))

    final = estado["messages"][-1]
    assert final.content == TEXTO_RECHAZO
    assert _insert_espia == []


@pytest.mark.asyncio
async def test_respuesta_ambigua_repregunta_con_el_mismo_texto(_insert_espia):
    """Ante la duda se re-pregunta con la propuesta IDÉNTICA (para que el turno siguiente
    la vuelva a detectar) y no se crea nada."""
    modelo = _LLMFalso([AIMessage(content="esto no debería usarse")])
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=1, rol="admin")

    estado = await grafo.ainvoke(_entrada([AIMessage(content=_propuesta()), HumanMessage(content="mmm, no sé")]))

    final = estado["messages"][-1]
    assert final.content == _propuesta(), "la propuesta se re-emite byte a byte"
    assert _insert_espia == []


@pytest.mark.asyncio
async def test_sin_propuesta_el_gate_pasa_derecho(_insert_espia):
    """Sin propuesta pendiente, el gate no interviene y el turno corre normal."""
    modelo = _LLMFalso([AIMessage(content="El Compressor A1 tiene 3 OTs abiertas.")])
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=1, rol="admin")

    estado = await grafo.ainvoke(_entrada([HumanMessage(content="¿cuántas OTs tiene el Compressor A1?")]))

    final = estado["messages"][-1]
    assert final.content == "El Compressor A1 tiene 3 OTs abiertas."
    assert len(modelo.llamadas) == 1, "el turno llegó hasta generate"
    assert _insert_espia == []


@pytest.mark.asyncio
async def test_la_resolucion_cierra_el_borrador(_insert_espia):
    """Después de crear la OT (o descartar), el borrador queda cerrado: un «sí» tardío ya
    no vuelve a insertar nada."""
    modelo = _LLMFalso([AIMessage(content="¡De nada! Avísame si necesitas otra cosa.")])
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=1, rol="admin")

    await grafo.ainvoke(
        _entrada(
            [
                AIMessage(content="OT creada: **OT-IA-20261025-120000-ABCD**"),
                HumanMessage(content="gracias"),
            ]
        )
    )

    assert _insert_espia == [], "la OT ya resuelta no se vuelve a crear"


@pytest.mark.asyncio
async def test_propuesta_corrupta_no_se_confirma(_insert_espia):
    """Un texto con el prefijo pero sin datos parseables NO llega al INSERT: el gate
    prefiere no hacer nada antes que crear una OT con datos inventados."""
    modelo = _LLMFalso([AIMessage(content="respuesta normal")])
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=1, rol="admin")

    await grafo.ainvoke(
        _entrada(
            [
                AIMessage(content="PROPUESTA DE ORDEN DE TRABAJO\n\nformato roto"),
                HumanMessage(content="sí"),
            ]
        )
    )

    assert _insert_espia == []


@pytest.mark.asyncio
async def test_astream_emite_el_texto_del_gate(_insert_espia):
    """El streaming entrega las resoluciones del gate igual que las respuestas normales:
    el router solo filtra por `_NODOS_QUE_HABLAN` y no toca nada más."""
    chunks = [
        chunk
        async for chunk in astream_respuesta(
            empresa_id=1,
            mensaje="no, espera",
            historial=[{"role": "assistant", "content": _propuesta()}],
            pistas=[],
            llm=_LLMFalso([AIMessage(content="esto no debería usarse")]),
            usuario_id=1,
            rol="admin",
        )
    ]
    assert "".join(chunks) == TEXTO_RECHAZO
    assert _insert_espia == []
