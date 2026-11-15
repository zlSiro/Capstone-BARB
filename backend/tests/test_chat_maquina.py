"""HU-23 (spec 02, paso 5): máquina vinculada a la conversación en el chat textual.

Router con el repositorio y el grafo simulados (como `test_chat.py`) + grafo con un LLM falso.
Semántica de `maquina_id` en el request: ausente = conserva, int = fija/cambia, null = desvincula.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import token_limiter
from barb.main import app
from barb.services import chat_graph
from barb.services.chat_graph import crear_grafo
from tests.test_chat import FakeChain

SESION = "99999999-9999-9999-9999-999999999999"
FICHA = {
    "maquina_id": 5,
    "nombre": "Compressor A1",
    "codigo": "CHA-001",
    "planta": "Planta Central",
    "disciplina": "Neumática",
}


@pytest.fixture(autouse=True)
def _reset_state():
    chat_rate_limiter._hits.clear()
    token_limiter._usage.clear()
    yield
    chat_rate_limiter._hits.clear()
    token_limiter._usage.clear()


@pytest.fixture
def override_auth():
    user = {"id": 1, "empresa_id": 1, "name": "T", "email": "t@barb.com", "role": "admin"}
    app.dependency_overrides[get_current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def repo():
    with patch("barb.routers.chat.chat_repository.create_session", new_callable=AsyncMock) as create, \
         patch("barb.routers.chat.chat_repository.get_session", new_callable=AsyncMock) as get_s, \
         patch("barb.routers.chat.chat_repository.load_messages", new_callable=AsyncMock) as load, \
         patch("barb.routers.chat.chat_repository.append_messages", new_callable=AsyncMock), \
         patch("barb.routers.chat.chat_repository.set_maquina", new_callable=AsyncMock) as set_m, \
         patch("barb.routers.chat.chat_repository.get_maquina_de_empresa", new_callable=AsyncMock) as get_m:
        create.return_value = SESION
        get_s.return_value = {"session_id": SESION, "usuario_id": 1, "maquina_id": None}
        load.return_value = []
        get_m.return_value = FICHA
        yield {"create": create, "get_session": get_s, "set_maquina": set_m, "get_maquina": get_m}


async def _enviar(client, **body) -> FakeChain:
    grafo = FakeChain(["ok"])
    with patch("barb.routers.chat.astream_respuesta", new=grafo):
        async with client.stream("POST", "/api/chat/stream", json={"message": "¿y el torque?", **body}) as r:
            _ = "".join([c async for c in r.aiter_text()])
    return grafo


# --------------------------------------------------------------------------- router


async def test_maquina_de_otra_empresa_da_404_sin_consumir_cuota(client, override_auth, repo):
    repo["get_maquina"].return_value = None

    r = await client.post("/api/chat/stream", json={"message": "hola", "maquina_id": 999})

    assert r.status_code == 404
    repo["get_maquina"].assert_awaited_once_with(999, 1)  # se valida contra la empresa del usuario
    repo["create"].assert_not_called()
    assert not chat_rate_limiter._hits  # no consumió rate limit
    assert not token_limiter._usage  # ni tokens


async def test_sesion_nueva_con_maquina_la_vincula_y_la_pasa_al_grafo(client, override_auth, repo):
    grafo = await _enviar(client, maquina_id=5)

    assert repo["create"].call_args.kwargs["maquina"] == FICHA
    assert grafo.last_kwargs["maquina"] == FICHA


async def test_sesion_nueva_sin_maquina_no_busca_ni_vincula(client, override_auth, repo):
    grafo = await _enviar(client)

    assert repo["create"].call_args.kwargs["maquina"] is None
    assert grafo.last_kwargs["maquina"] is None
    repo["get_maquina"].assert_not_called()


async def test_seguimiento_sin_campo_hereda_la_maquina_de_la_sesion(client, override_auth, repo):
    repo["get_session"].return_value = {"session_id": SESION, "usuario_id": 1, "maquina_id": 5}

    grafo = await _enviar(client, session_id=SESION)  # no manda maquina_id

    repo["get_maquina"].assert_awaited_once_with(5, 1)
    repo["set_maquina"].assert_not_called()
    assert grafo.last_kwargs["maquina"] == FICHA


async def test_maquina_nueva_en_sesion_existente_la_cambia(client, override_auth, repo):
    repo["get_session"].return_value = {"session_id": SESION, "usuario_id": 1, "maquina_id": 3}

    grafo = await _enviar(client, session_id=SESION, maquina_id=5)

    repo["set_maquina"].assert_awaited_once_with(SESION, 1, FICHA)
    assert grafo.last_kwargs["maquina"] == FICHA


async def test_maquina_null_desvincula_la_sesion(client, override_auth, repo):
    repo["get_session"].return_value = {"session_id": SESION, "usuario_id": 1, "maquina_id": 5}

    grafo = await _enviar(client, session_id=SESION, maquina_id=None)

    repo["set_maquina"].assert_awaited_once_with(SESION, 1, None)
    repo["get_maquina"].assert_not_called()
    assert grafo.last_kwargs["maquina"] is None


async def test_sesion_con_maquina_borrada_sigue_sin_ficha(client, override_auth, repo):
    repo["get_session"].return_value = {"session_id": SESION, "usuario_id": 1, "maquina_id": 5}
    repo["get_maquina"].return_value = None  # la máquina ya no existe

    grafo = await _enviar(client, session_id=SESION)

    assert grafo.last_kwargs["maquina"] is None


# --------------------------------------------------------------------------- grafo


class _LLM:
    def __init__(self):
        self.llamadas: list = []

    def bind_tools(self, _tools):
        return self

    def with_retry(self, **_k):
        return self

    async def ainvoke(self, mensajes):
        self.llamadas.append(list(mensajes))
        return AIMessage(content="ok")


def _estado(pistas):
    return {
        "messages": [HumanMessage(content="¿y el torque?")],
        "empresa_id": 1,
        "pistas": pistas,
        "contexto": "",
        "fragmentos": 0,
    }


@pytest.fixture
def busquedas(monkeypatch):
    llamadas: list[dict] = []

    async def fake(empresa_id, *pistas, **kwargs):
        llamadas.append({"empresa_id": empresa_id, "pistas": pistas, **kwargs})
        return [{"chunk_id": 1, "documento_id": 1, "title": "Manual A1", "contenido": "Torque 85 Nm.", "rank": 0.9}]

    monkeypatch.setattr(chat_graph, "search_chunks", fake)
    monkeypatch.setattr(chat_graph, "crear_tools", lambda *_a, **_k: [])
    return llamadas


async def test_el_retrieval_prioriza_la_maquina_aunque_el_mensaje_no_la_nombre(busquedas):
    llm = _LLM()
    grafo = crear_grafo(empresa_id=1, llm=llm, maquina=FICHA)

    await grafo.ainvoke(_estado(["¿y el torque?"]))

    assert busquedas == [{"empresa_id": 1, "pistas": ("¿y el torque?",), "maquina_id": 5}]


async def test_la_ficha_del_equipo_va_en_el_system_prompt(busquedas):
    llm = _LLM()
    grafo = crear_grafo(empresa_id=1, llm=llm, maquina=FICHA)

    await grafo.ainvoke(_estado(["torque"]))

    sistema = llm.llamadas[0][0].content
    assert "EQUIPO SELECCIONADO: Compressor A1 (CHA-001) — planta Planta Central, disciplina Neumática" in sistema
    assert "Manual A1" in sistema  # el contexto sigue inyectado
    assert "{context}" not in sistema


async def test_sin_maquina_el_comportamiento_no_cambia(busquedas):
    llm = _LLM()
    grafo = crear_grafo(empresa_id=1, llm=llm)

    await grafo.ainvoke(_estado(["torque"]))

    assert busquedas == [{"empresa_id": 1, "pistas": ("torque",)}]  # sin kwarg maquina_id
    assert "EQUIPO SELECCIONADO" not in llm.llamadas[0][0].content
