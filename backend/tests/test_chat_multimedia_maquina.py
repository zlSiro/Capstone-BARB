"""HU-23 (spec 02, paso 6): máquina vinculada a la conversación en el chat multimodal.

El LLM va simulado: se verifica lo que el router le inyecta (ficha, contexto, búsqueda priorizada) y lo
que persiste. Semántica de `maquina_id`: ausente = conserva, int = fija/cambia, null = desvincula.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import token_limiter
from barb.main import app
from barb.services.llm_service import _prepare_multimodal_input
from tests.test_chat_multimedia import FakeChain, _multimedia_body

SESION = "99999999-9999-9999-9999-999999999999"
FICHA = {
    "maquina_id": 5,
    "nombre": "Compressor A1",
    "codigo": "CHA-001",
    "planta": "Planta Central",
    "disciplina": "Neumática",
}
CHUNKS = [
    {"title": "Manual A1", "contenido": "Torque 85 Nm.", "documento_id": 1, "de_maquina": True},
    {"title": "Procedimiento LOTO", "contenido": "Bloquear y etiquetar.", "documento_id": 2, "de_maquina": False},
]


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
         patch("barb.routers.chat.chat_repository.append_messages", new_callable=AsyncMock) as append, \
         patch("barb.routers.chat.chat_repository.set_maquina", new_callable=AsyncMock) as set_m, \
         patch("barb.routers.chat.chat_repository.get_maquina_de_empresa", new_callable=AsyncMock) as get_m:
        create.return_value = SESION
        get_s.return_value = {"session_id": SESION, "usuario_id": 1, "maquina_id": None}
        load.return_value = []
        get_m.return_value = FICHA
        yield {"create": create, "get_session": get_s, "set_maquina": set_m, "get_maquina": get_m, "append": append}


@pytest.fixture
def busqueda():
    with patch("barb.routers.chat.search_chunks", new_callable=AsyncMock, return_value=CHUNKS) as m:
        yield m


async def _enviar(client, **extra) -> FakeChain:
    chain = FakeChain(["ok"])
    with patch("barb.routers.chat.create_multimodal_chain", return_value=chain):
        async with client.stream("POST", "/api/chat/multimedia", json=_multimedia_body(**extra)) as r:
            _ = "".join([c async for c in r.aiter_text()])
    return chain


# --------------------------------------------------------------------------- router


async def test_maquina_de_otra_empresa_da_404_sin_consumir_cuota(client, override_auth, repo, busqueda):
    repo["get_maquina"].return_value = None

    r = await client.post("/api/chat/multimedia", json=_multimedia_body(maquina_id=999))

    assert r.status_code == 404
    repo["get_maquina"].assert_awaited_once_with(999, 1)
    repo["create"].assert_not_called()
    busqueda.assert_not_called()
    assert not chat_rate_limiter._hits and not token_limiter._usage


async def test_con_maquina_prioriza_sus_documentos_y_los_inyecta_en_orden(client, override_auth, repo, busqueda):
    chain = await _enviar(client, maquina_id=5)

    assert busqueda.call_args.kwargs["maquina_id"] == 5
    assert repo["create"].call_args.kwargs["maquina"] == FICHA
    payload = chain.last_payload
    assert payload["maquina"] == FICHA
    # Contexto en el orden que devolvió la búsqueda: documento de la máquina antes que el general.
    assert payload["context"].index("Manual A1") < payload["context"].index("Procedimiento LOTO")


async def test_sin_maquina_busca_como_antes(client, override_auth, repo, busqueda):
    chain = await _enviar(client)

    assert "maquina_id" not in busqueda.call_args.kwargs
    assert chain.last_payload["maquina"] is None
    repo["get_maquina"].assert_not_called()


async def test_seguimiento_con_imagen_hereda_la_maquina_de_la_sesion(client, override_auth, repo, busqueda):
    repo["get_session"].return_value = {"session_id": SESION, "usuario_id": 1, "maquina_id": 5}

    chain = await _enviar(client, session_id=SESION)

    repo["set_maquina"].assert_not_called()
    assert busqueda.call_args.kwargs["maquina_id"] == 5
    assert chain.last_payload["maquina"] == FICHA


async def test_maquina_nueva_cambia_y_null_desvincula(client, override_auth, repo, busqueda):
    repo["get_session"].return_value = {"session_id": SESION, "usuario_id": 1, "maquina_id": 3}

    await _enviar(client, session_id=SESION, maquina_id=5)
    repo["set_maquina"].assert_awaited_once_with(SESION, 1, FICHA)

    repo["set_maquina"].reset_mock()
    chain = await _enviar(client, session_id=SESION, maquina_id=None)
    repo["set_maquina"].assert_awaited_once_with(SESION, 1, None)
    assert chain.last_payload["maquina"] is None


async def test_el_mensaje_de_usuario_se_persiste_con_has_image_y_sin_imagen(client, override_auth, repo, busqueda):
    await _enviar(client, maquina_id=5)

    nuevos = repo["append"].call_args.args[2]
    assert nuevos[0]["has_image"] is True
    assert "has_image" not in nuevos[1]
    assert set(nuevos[0]) == {"role", "content", "timestamp", "has_image"}  # ni base64 ni URL
    assert "base64" not in str(nuevos)


# --------------------------------------------------------------------------- prompt


def _system(**payload) -> str:
    return _prepare_multimodal_input({"input": "x", "image": "data:image/png;base64,QQ==", **payload})[0].content


def test_prompt_con_maquina_incluye_ficha_y_regla_de_discrepancia():
    system = _system(maquina=FICHA, context="[Documento: Manual A1]\nTorque 85 Nm.")

    assert "EQUIPO SELECCIONADO: Compressor A1 (CHA-001) — planta Planta Central, disciplina Neumática" in system
    assert "DISCREPANCIA IMAGEN-EQUIPO" in system
    assert "otro equipo" in system and "continúa el análisis con el equipo seleccionado" in system
    assert "DOCUMENTACIÓN DE LA EMPRESA:\n[Documento: Manual A1]" in system
    assert "SIN DOCUMENTACIÓN APLICABLE" not in system
    assert system.endswith("Reasoning strength: low")


def test_prompt_sin_maquina_ni_docs_exige_identificacion_visual_y_decir_que_no_hay_documentacion():
    system = _system(context="")

    assert "EQUIPO SELECCIONADO" not in system and "DISCREPANCIA" not in system
    assert "SIN DOCUMENTACIÓN APLICABLE" in system
    assert "identificación visual" in system
    assert "aclara explícitamente que no hay documentación" in system
    assert "DOCUMENTACIÓN DE LA EMPRESA:\n" not in system


def test_prompt_con_maquina_pero_sin_docs_tambien_avisa_que_falta_documentacion():
    system = _system(maquina=FICHA, context="")

    assert "EQUIPO SELECCIONADO" in system and "DISCREPANCIA IMAGEN-EQUIPO" in system
    assert "SIN DOCUMENTACIÓN APLICABLE" in system
