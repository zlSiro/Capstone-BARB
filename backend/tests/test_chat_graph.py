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
from barb.services.ai_tools import _UMBRAL_PARECIDO, _buscar_maquinas, _puntaje, crear_tools
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
    monkeypatch.setattr(chat_graph, "crear_tools", lambda _empresa, *_a, **_k: [_tool_controlada])

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
    monkeypatch.setattr(chat_graph, "crear_tools", lambda _empresa, *_a, **_k: [_tool_controlada])
    llm = _LLMFalso([AIMessage(content="ok")])

    crear_grafo(empresa_id=1, llm=llm)

    assert [t.name for t in llm.tools_vinculadas] == ["consultar_ots_maquina"]


@pytest.mark.asyncio
async def test_sin_tool_calls_termina_sin_pasar_por_tools(monkeypatch):
    """El caso normal (solo RAG) no debe dar una vuelta extra por el nodo de tools."""
    monkeypatch.setattr(chat_graph, "crear_tools", lambda _empresa, *_a, **_k: [_tool_controlada])
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
    monkeypatch.setattr(chat_graph, "crear_tools", lambda _empresa, *_a, **_k: [_tool_controlada])

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
    # Consultar y crear; el orden importa poco, sí que estén las dos.
    assert sorted(t.name for t in tools) == ["consultar_ots_maquina", "crear_ot"]

    consultar = next(t for t in tools if t.name == "consultar_ots_maquina")
    salida = await consultar.ainvoke({"nombre_maquina": "Compressor A1"})

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


# ---------------------------------------------------------------------------
# Tolerancia a errores de tipeo: corpus GENERADO, no una lista elegida a mano
# ---------------------------------------------------------------------------
#
# Antes había una lista de nueve frases "reales". Servía de documentación, pero probaba
# exactamente esos nueve casos: un cambio en el matcher podía romper el décimo y los
# tests seguían verdes. Ahora las variantes se DERIVAN del nombre que hay en la base, así
# que cualquier equipo que se agregue al inventario queda cubierto solo.


def _mutaciones(nombre: str) -> list[str]:
    """
    Variantes con errores humanos típicos de un nombre, generadas por reglas.

    No conoce ningún equipo: recibe un nombre y devuelve formas plausibles de escribirlo
    mal (letra que falta, letra repetida, letras intercambiadas, sin espacio, mayúsculas
    gritadas, con signos, o solo la primera palabra).
    """
    base = nombre.strip()
    variantes: set[str] = set()

    if len(base) > 4:
        medio = len(base) // 2
        # Quitar una letra del medio: el error de tipeo más común.
        variantes.add(base[:medio] + base[medio + 1 :])
        # Repetir una letra.
        variantes.add(base[:medio] + base[medio] * 2 + base[medio + 1 :])
        # Intercambiar dos letras contiguas.
        variantes.add(base[:medio] + base[medio + 1 : medio + 2] + base[medio] + base[medio + 2 :])

    variantes.add(base.upper())
    variantes.add(base.lower())
    variantes.add(base.replace(" ", ""))
    variantes.add(base + "!!!")
    variantes.add(f"el {base.lower()} del sector 2")

    primera = base.split()[0]
    if len(primera) >= 4:
        variantes.add(primera)

    variantes.discard(base)  # el original se prueba aparte
    return sorted(variantes)


@pytest.mark.asyncio
async def test_el_matcher_resuelve_las_mutaciones_de_cada_maquina_real(db_pool):
    """
    Propiedad, no ejemplos: para CADA máquina de la empresa, cada mutación de su nombre
    tiene que resolver a esa máquina y a ninguna otra.

    Es la prueba de que el matcher es genérico: si mañana se agrega «Bomba B7», sus
    variantes quedan cubiertas sin tocar el test.
    """
    from barb.core.db import fetch_all

    filas = await fetch_all(
        """
        SELECT m.nombre, m.codigo
          FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = 1
        """
    )
    assert filas, "el seed debería tener máquinas en la empresa 1"

    revisadas = 0
    for fila in filas:
        for variante in _mutaciones(fila["nombre"]):
            puntajes = [
                (otra["nombre"], _puntaje(variante, otra["nombre"], otra["codigo"]))
                for otra in filas
            ]
            puntajes.sort(key=lambda x: x[1], reverse=True)
            mejor, valor = puntajes[0]

            # Las mutaciones que se quedan solo con la primera palabra pueden ser
            # ambiguas (el distintivo no está en la consulta): se exige que el puntaje
            # sea alto, no que gane.
            if valor < _UMBRAL_PARECIDO:
                assert mejor == fila["nombre"], (
                    f"«{variante}» quedó bajo el umbral (mejor {mejor} {valor:.2f})"
                )
            revisadas += 1

    assert revisadas > 30, f"se generaron muy pocas variantes ({revisadas})"


@pytest.mark.asyncio
async def test_el_matcher_no_inventa_coincidencias(db_pool):
    """Cadenas que no se parecen a nada no deben superar el umbral."""
    from barb.core.db import fetch_all

    filas = await fetch_all(
        """
        SELECT m.nombre, m.codigo
          FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
        """
    )
    for ruido in ("S1", "zzzz qqqq", "123456", "el equipo de la sala 3", "no existe"):
        for fila in filas:
            assert _puntaje(ruido, fila["nombre"], fila["codigo"]) < _UMBRAL_PARECIDO, (
                f"«{ruido}» se pareció demasiado a {fila['nombre']}"
            )


@pytest.mark.asyncio
async def test_la_tool_resuelve_cualquier_maquina_de_la_empresa(db_pool):
    """De punta a punta: el nombre exacto de cada equipo devuelve sus OTs, no otra máquina."""
    from barb.core.db import fetch_all

    filas = await fetch_all(
        """
        SELECT m.nombre
          FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = 1
         ORDER BY m.nombre
        """
    )
    tools = crear_tools(empresa_id=1)
    for fila in filas:
        salida = await tools[0].ainvoke({"nombre_maquina": fila["nombre"]})
        assert fila["nombre"] in salida, f"«{fila['nombre']}» no se resolvió: {salida[:100]}"


@pytest.mark.asyncio
async def test_la_tool_sugiere_alternativas_cuando_no_encuentra(db_pool):
    """
    Un «no encontré» a secas deja al usuario sin salida.

    En la conversación real insistió cuatro veces con un código inventado («S1») porque
    no sabía qué equipos existen. La tool ahora lista las máquinas disponibles.
    """
    tools = crear_tools(empresa_id=1)
    salida = await tools[0].ainvoke({"nombre_maquina": "S1"})

    assert "No encontré" in salida
    assert "Estas son las disponibles" in salida
    # Las sugerencias son equipos reales de la empresa, con su código.
    assert "Compressor A1 (COMP-A1)" in salida


@pytest.mark.asyncio
async def test_las_sugerencias_no_salen_de_la_empresa(db_pool):
    """La lista de alternativas también respeta el aislamiento multi-empresa."""
    from barb.core.db import fetch_one

    ajena = await fetch_one(
        """
        SELECT m.nombre
          FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = 2
         ORDER BY m.nombre LIMIT 1
        """
    )
    if not ajena:
        pytest.skip("el seed no tiene máquinas en la empresa 2")

    tools = crear_tools(empresa_id=1)
    salida = await tools[0].ainvoke({"nombre_maquina": "S1"})

    assert "Estas son las disponibles" in salida
    assert ajena["nombre"] not in salida


def test_los_estados_abiertos_se_derivan_de_la_maquina_de_estados():
    """
    Sin listas propias: el conjunto de estados abiertos sale de `work_order_states`, que
    se declara única fuente de verdad. Si alguien agrega un estado a `TRANSICIONES`, esta
    tool lo va a considerar sin tocar nada.
    """
    from barb.core.work_order_states import ESTADOS_FINALES, TRANSICIONES
    from barb.services.ai_tools import ESTADOS_ABIERTOS

    assert set(ESTADOS_ABIERTOS) == set(TRANSICIONES) - ESTADOS_FINALES
    # Y los finales siguen fuera: una OT cerrada no cuenta como abierta.
    assert not set(ESTADOS_ABIERTOS) & set(ESTADOS_FINALES)


def test_el_prompt_obliga_a_resolver_referencias_y_prohibe_la_complacencia():
    """
    Reglas 5 a 8: nacen del caso real «eso, lo tercero».

    El bot ofreció una lista de 3 opciones, el usuario eligió la tercera y el bot respondió
    con el punto 3 del manual; después, al ser corregido, dijo «tienes toda la razón»
    manteniendo su respuesta anterior. Estas reglas tienen que estar en el prompt que
    recibe el modelo, no solo en la documentación del proyecto.
    """
    from barb.services.chat_graph import _prompt_sistema

    prompt = _prompt_sistema("(fragmentos de prueba)")

    # 5: la referencia se resuelve contra la conversación, no contra el documento.
    assert "REFERENCIAS DEL USUARIO" in prompt
    assert "CONTRA TU MENSAJE ANTERIOR" in prompt
    assert "ESA numeración manda" in prompt
    # 6: no mezclar las dos enumeraciones.
    assert "DOS ENUMERACIONES DISTINTAS" in prompt
    # 7: no inventar categorías ni listas de ayuda.
    assert "NO INVENTAR LISTAS NI CATEGORÍAS" in prompt
    # 8: nada de «tienes razón» mientras se mantiene la respuesta anterior.
    assert "COHERENCIA Y HONESTIDAD" in prompt
    assert "«tienes razón»" in prompt


def test_las_reglas_de_conversacion_tienen_prioridad_declarada():
    """El prompt debe decir explícitamente que estas reglas mandan para las referencias."""
    from barb.services.chat_graph import _prompt_sistema

    prompt = _prompt_sistema("x")
    assert "tienen prioridad sobre la documentación para interpretar" in prompt
