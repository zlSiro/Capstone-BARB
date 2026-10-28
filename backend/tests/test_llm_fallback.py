"""Respaldo entre NVIDIA y DeepSeek.

Si la API de NVIDIA falla durante la presentación, el chat tiene que seguir respondiendo.
El respaldo es transparente para la IA: el modelo no sabe que existe, y las Skills siguen
disponibles porque las tools se bindean en el primario **y** en el respaldo.

Probado acá con modelos falsos: lo que se verifica es la cadena (orden de bind_tools y
retry, entrada del respaldo ante el error, y que el streaming —lo que usa el chat— también
haga fallback).
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage
from langchain_core.runnables import Runnable, RunnableWithFallbacks

from barb.services import chat_graph, llm_service


class ModeloFalso(Runnable):
    """Chat model mínimo: registra el orden de las llamadas y responde o falla a pedido."""

    def __init__(self, nombre: str, *, falla: bool = False, texto: str = "respuesta"):
        self.nombre = nombre
        self.falla = falla
        self.texto = texto
        self.tools: list | None = None
        self.llamadas: list[str] = []

    # --- API de LangChain que usa la cadena ---
    def bind_tools(self, tools):
        self.llamadas.append("bind_tools")
        self.tools = tools
        return self

    def with_retry(self, **_kwargs):
        self.llamadas.append("with_retry")
        return self

    def _respuesta(self) -> AIMessage:
        if self.falla:
            raise RuntimeError(f"{self.nombre} caido (simulado)")
        return AIMessage(content=self.texto)

    def invoke(self, *args, **kwargs):
        self.llamadas.append("invoke")
        return self._respuesta()

    async def ainvoke(self, *args, **kwargs):
        self.llamadas.append("ainvoke")
        return self._respuesta()

    def stream(self, *args, **kwargs):
        self.llamadas.append("stream")
        if self.falla:
            raise RuntimeError(f"{self.nombre} caido (simulado)")
        yield AIMessage(content=self.texto)

    async def astream(self, *args, **kwargs):
        self.llamadas.append("astream")
        if self.falla:
            raise RuntimeError(f"{self.nombre} caido (simulado)")
        yield AIMessage(content=self.texto)


@pytest.fixture
def fabrica(monkeypatch):
    """
    Sustituye `_build_llm` por una fábrica de modelos falsos y devuelve los creados.

    `disponibles` controla qué proveedores tienen key: los que no están levantan
    RuntimeError, como haría el constructor real.
    """
    creados: dict[str, ModeloFalso] = {}

    def configurar(*, falla_primario: bool = False, disponibles=("nvidia", "deepseek"), provider="nvidia"):
        monkeypatch.setattr(llm_service.settings, "llm_provider", provider)
        creados.clear()

        def _build(proveedor=None, modelo=None):
            proveedor = proveedor or llm_service.settings.llm_provider
            if proveedor not in disponibles:
                raise RuntimeError(f"{proveedor.upper()}_API_KEY no configurada en .env")
            modelo_falso = ModeloFalso(
                proveedor,
                falla=(falla_primario and proveedor == provider),
                texto=f"respuesta de {proveedor}",
            )
            creados[proveedor] = modelo_falso
            return modelo_falso

        monkeypatch.setattr(llm_service, "_build_llm", _build)
        return creados

    return configurar


def test_sin_fallo_el_respaldo_existe_pero_no_se_usa(fabrica):
    fabrica(disponibles=("nvidia", "deepseek"))
    cadena = llm_service._build_llm_con_fallback()

    assert isinstance(cadena, RunnableWithFallbacks)
    assert cadena.invoke("hola").content == "respuesta de nvidia"


@pytest.mark.asyncio
async def test_el_respaldo_responde_cuando_el_primario_falla(fabrica):
    """El caso de la presentación: NVIDIA se cae y DeepSeek contesta."""
    creados = fabrica(falla_primario=True, disponibles=("nvidia", "deepseek"))
    cadena = llm_service._build_llm_con_fallback()

    respuesta = await cadena.ainvoke("hola")

    assert respuesta.content == "respuesta de deepseek"
    assert "ainvoke" in creados["nvidia"].llamadas, "el primario debe intentarse primero"
    assert "ainvoke" in creados["deepseek"].llamadas


@pytest.mark.asyncio
async def test_el_streaming_tambien_hace_fallback(fabrica):
    """
    El chat consume `astream`, no `ainvoke`. Si el fallback solo funcionara sin streaming,
    la presentación se caería igual.
    """
    fabrica(falla_primario=True, disponibles=("nvidia", "deepseek"))
    cadena = llm_service._build_llm_con_fallback()

    trozos = [c.content async for c in cadena.astream("hola")]

    assert trozos == ["respuesta de deepseek"]


def test_las_tools_se_bindean_en_el_primario_y_en_el_respaldo(fabrica):
    """
    El respaldo también tiene que poder usar las Skills: si no, al caer NVIDIA el chat
    perdería la capacidad de consultar OTs justo cuando más se necesita.
    """
    creados = fabrica(disponibles=("nvidia", "deepseek"))
    tools = ["consultar_ots_maquina", "crear_ot"]

    llm_service._build_llm_con_fallback(tools)

    assert creados["nvidia"].tools == tools
    assert creados["deepseek"].tools == tools


def test_el_orden_es_bind_tools_antes_de_with_retry(fabrica):
    """
    `with_retry` devuelve un RunnableRetry que ya no expone `bind_tools`. Si el orden se
    invierte, el modelo se queda sin herramientas (fue un bug real en el grafo).
    """
    creados = fabrica(disponibles=("nvidia", "deepseek"))

    llm_service._build_llm_con_fallback(["tool"])

    for modelo in creados.values():
        assert modelo.llamadas[:2] == ["bind_tools", "with_retry"], modelo.llamadas


def test_sin_key_del_otro_proveedor_no_hay_respaldo(fabrica):
    """Un respaldo sin key se omite: no debe romper el arranque del chat."""
    fabrica(disponibles=("nvidia",))  # deepseek sin key
    cadena = llm_service._build_llm_con_fallback()

    assert not isinstance(cadena, RunnableWithFallbacks)
    assert cadena.invoke("hola").content == "respuesta de nvidia"


def test_el_fallback_es_bidireccional(fabrica):
    """Si el primario es DeepSeek y cae, NVIDIA responde."""
    fabrica(falla_primario=True, disponibles=("nvidia", "deepseek"), provider="deepseek")
    cadena = llm_service._build_llm_con_fallback()

    assert cadena.invoke("hola").content == "respuesta de nvidia"


def test_cada_proveedor_recibe_su_propio_nombre_de_modelo(fabrica, monkeypatch):
    """
    Un id de modelo no sirve en otra API: mandarle el de NVIDIA a DeepSeek da 400.
    """
    modelos: dict[str, str] = {}

    def _build(proveedor=None, modelo=None):
        proveedor = proveedor or llm_service.settings.llm_provider
        modelos[proveedor] = modelo
        return ModeloFalso(proveedor)

    monkeypatch.setattr(llm_service, "_build_llm", _build)
    monkeypatch.setattr(llm_service.settings, "llm_provider", "nvidia")

    llm_service._build_llm_con_fallback()

    assert modelos["nvidia"] == llm_service.settings.llm_model
    assert modelos["deepseek"] == "deepseek-chat"


@pytest.mark.asyncio
async def test_el_grafo_completo_responde_con_el_respaldo(fabrica, monkeypatch):
    """
    De punta a punta: `crear_grafo` sin modelo inyectado usa la cadena con respaldo y el
    streaming del chat sale igual cuando el primario falla.
    """
    fabrica(falla_primario=True, disponibles=("nvidia", "deepseek"))

    async def sin_documentos(*_a, **_k):
        return []

    monkeypatch.setattr(chat_graph, "search_chunks", sin_documentos)

    texto = "".join(
        [
            trozo
            async for trozo in chat_graph.astream_respuesta(
                empresa_id=1,
                mensaje="hola",
                historial=[],
                pistas=["hola"],
                usuario_id=1,
                rol="admin",
            )
        ]
    )

    assert "respuesta de deepseek" in texto
