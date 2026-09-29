from __future__ import annotations

import json
import uuid
from unittest.mock import patch

import pytest

from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import token_limiter
from barb.main import app


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(autouse=True)
def _reset_state():
    chat_rate_limiter._hits.clear()
    token_limiter._usage.clear()
    yield
    chat_rate_limiter._hits.clear()
    token_limiter._usage.clear()


@pytest.fixture
def fake_user():
    return {
        "id": 1,
        "empresa_id": 1,
        "name": "Tester",
        "email": "t@barb.com",
        "role": "admin",
    }


@pytest.fixture
def override_auth(fake_user):
    app.dependency_overrides[get_current_user] = lambda: fake_user
    yield fake_user
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def mock_repo():
    with patch("barb.routers.chat.chat_repository.create_session") as m_create, \
         patch("barb.routers.chat.chat_repository.get_session") as m_get, \
         patch("barb.routers.chat.chat_repository.load_messages") as m_load, \
         patch("barb.routers.chat.chat_repository.append_messages") as m_append:

        # Defaults razonables
        m_create.return_value = "11111111-1111-1111-1111-111111111111"
        m_get.return_value = None
        m_load.return_value = []
        m_append.return_value = True

        yield {
            "create_session": m_create,
            "get_session": m_get,
            "load_messages": m_load,
            "append_messages": m_append,
        }


# =============================================================================
# Helpers
# =============================================================================

class FakeChain:

    def __init__(self, chunks: list[str], raise_after: int | None = None):
        self.chunks = chunks
        self.raise_after = raise_after
        self.last_payload: dict | None = None

    async def astream(self, *args, **_kwargs):
        self.last_payload = args[0] if args else {}
        for i, chunk in enumerate(self.chunks):
            if self.raise_after is not None and i == self.raise_after:
                raise RuntimeError("boom del LLM")
            yield chunk


def _parse_sse(raw: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    current_event: str | None = None
    for line in raw.splitlines():
        if line.startswith("event:"):
            current_event = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            payload = line.split(":", 1)[1].strip()
            try:
                data = json.loads(payload) if payload else {}
            except json.JSONDecodeError:
                data = {"_raw": payload}
            if current_event:
                events.append((current_event, data))
            current_event = None
    return events


# =============================================================================
# Autenticación y validación
# =============================================================================

@pytest.mark.asyncio
async def test_sin_header_authorization(client):
    resp = await client.post("/api/chat/stream", json={"message": "hola"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_mensaje_vacio(client, override_auth):
    resp = await client.post("/api/chat/stream", json={"message": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_mensaje_muy_largo(client, override_auth):
    resp = await client.post("/api/chat/stream", json={"message": "x" * 2001})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_payload_sin_message(client, override_auth):
    resp = await client.post("/api/chat/stream", json={})
    assert resp.status_code == 422


# =============================================================================
# Validación de session_id
# =============================================================================

@pytest.mark.asyncio
async def test_session_id_formato_invalido(client, override_auth, mock_repo):
    resp = await client.post(
        "/api/chat/stream",
        json={"message": "hi", "session_id": "no-es-un-uuid"},
    )
    assert resp.status_code == 422
    assert "UUID" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_session_id_no_existe_404(client, override_auth, mock_repo):
    mock_repo["get_session"].return_value = None  

    sid = str(uuid.uuid4())
    resp = await client.post(
        "/api/chat/stream",
        json={"message": "hi", "session_id": sid},
    )
    assert resp.status_code == 404
    assert "no" in resp.json()["detail"].lower()


# =============================================================================
# Rate limit y token limit
# =============================================================================

@pytest.mark.asyncio
async def test_rate_limit_429(client, override_auth, mock_repo):
    with patch(
        "barb.routers.chat.create_conversation_chain",
        return_value=FakeChain(["ok"]),
    ):
        for _ in range(10):
            r = await client.post("/api/chat/stream", json={"message": "hi"})
            assert r.status_code == 200, f"Falla en intento previo: {r.status_code}"

        r = await client.post("/api/chat/stream", json={"message": "hi"})
        assert r.status_code == 429
        assert "Retry-After" in r.headers


@pytest.mark.asyncio
async def test_token_limit_429(client, override_auth):
    token_limiter.add("1", token_limiter.max_tokens)
    r = await client.post("/api/chat/stream", json={"message": "hi"})
    assert r.status_code == 429
    assert "tokens" in r.json()["detail"].lower()


# =============================================================================
# Streaming: happy path
# =============================================================================

@pytest.mark.asyncio
async def test_stream_happy_path_sesion_nueva(client, override_auth, mock_repo):
    fake_uuid = "11111111-1111-1111-1111-111111111111"
    mock_repo["create_session"].return_value = fake_uuid

    with patch(
        "barb.routers.chat.create_conversation_chain",
        return_value=FakeChain(["Hola", " ", "mundo", "!"]),
    ):
        async with client.stream(
            "POST", "/api/chat/stream", json={"message": "test"}
        ) as resp:
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")
            raw = "".join([c async for c in resp.aiter_text()])

    events = _parse_sse(raw)
    tipos = [e for e, _ in events]

    assert tipos[0] == "session"
    assert tipos[-1] == "done"
    assert tipos.count("token") == 4

    session_evt = next(d for e, d in events if e == "session")
    assert session_evt["session_id"] == fake_uuid

    contenido = "".join(d["text"] for e, d in events if e == "token")
    assert contenido == "Hola mundo!"

    mock_repo["create_session"].assert_called_once()
    kwargs = mock_repo["create_session"].call_args.kwargs
    assert kwargs["usuario_id"] == 1
    assert kwargs["empresa_id"] == 1
    assert kwargs["primer_mensaje"] == "test"


@pytest.mark.asyncio
async def test_stream_sesion_existente_recupera_historial(client, override_auth, mock_repo):
    fake_uuid = "22222222-2222-2222-2222-222222222222"
    mock_repo["get_session"].return_value = {"session_id": fake_uuid, "usuario_id": 1}
    mock_repo["load_messages"].return_value = [
        {"role": "user", "content": "pregunta previa"},
        {"role": "assistant", "content": "respuesta previa"},
    ]

    fake_chain = FakeChain(["ok"])
    with patch(
        "barb.routers.chat.create_conversation_chain", return_value=fake_chain
    ):
        async with client.stream(
            "POST",
            "/api/chat/stream",
            json={"message": "seguimiento", "session_id": fake_uuid},
        ) as resp:
            raw = "".join([c async for c in resp.aiter_text()])

    assert fake_chain.last_payload is not None
    assert fake_chain.last_payload["input"] == "seguimiento"
    assert len(fake_chain.last_payload["history"]) == 2
    assert fake_chain.last_payload["history"][0]["content"] == "pregunta previa"

    mock_repo["create_session"].assert_not_called()
    mock_repo["load_messages"].assert_called_once_with(fake_uuid, 1)


# =============================================================================
# Persistencia
# =============================================================================

@pytest.mark.asyncio
async def test_persistencia_guarda_user_y_assistant(client, override_auth, mock_repo):
    fake_uuid = "33333333-3333-3333-3333-333333333333"
    mock_repo["create_session"].return_value = fake_uuid

    with patch(
        "barb.routers.chat.create_conversation_chain",
        return_value=FakeChain(["respuesta"]),
    ):
        async with client.stream(
            "POST", "/api/chat/stream", json={"message": "pregunta"}
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    mock_repo["append_messages"].assert_called_once()
    args = mock_repo["append_messages"].call_args.args
    assert args[0] == fake_uuid
    assert args[1] == 1
    nuevos = args[2]
    assert len(nuevos) == 2
    assert nuevos[0]["role"] == "user"
    assert nuevos[0]["content"] == "pregunta"
    assert nuevos[1]["role"] == "assistant"
    assert nuevos[1]["content"] == "respuesta"


@pytest.mark.asyncio
async def test_persistencia_aunque_falle_llm(client, override_auth, mock_repo):
    fake_uuid = "44444444-4444-4444-4444-444444444444"
    mock_repo["create_session"].return_value = fake_uuid

    with patch(
        "barb.routers.chat.create_conversation_chain",
        return_value=FakeChain(["parcial", "segundo"], raise_after=1),
    ):
        async with client.stream(
            "POST", "/api/chat/stream", json={"message": "pregunta"}
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    mock_repo["append_messages"].assert_called_once()
    nuevos = mock_repo["append_messages"].call_args.args[2]
    assert nuevos[1]["role"] == "assistant"
    assert nuevos[1]["content"] == "parcial"


# =============================================================================
# Manejo de errores del LLM
# =============================================================================

@pytest.mark.asyncio
async def test_error_llm_emite_evento_error_no_done(client, override_auth, mock_repo):
    with patch(
        "barb.routers.chat.create_conversation_chain",
        return_value=FakeChain(["parcial", "segundo"], raise_after=1),
    ):
        async with client.stream(
            "POST", "/api/chat/stream", json={"message": "hi"}
        ) as resp:
            assert resp.status_code == 200
            raw = "".join([c async for c in resp.aiter_text()])

    events = _parse_sse(raw)
    tipos = [e for e, _ in events]

    assert "error" in tipos
    assert "done" not in tipos
    assert tipos.count("token") == 1

    error_data = next(d for e, d in events if e == "error")
    assert error_data["code"] == "internal_error"
    assert "boom del LLM" in error_data["message"]


# =============================================================================
# Consumo de tokens
# =============================================================================

@pytest.mark.asyncio
async def test_tokens_consumidos_en_happy_path(client, override_auth, mock_repo):
    antes = token_limiter.used("1")

    with patch(
        "barb.routers.chat.create_conversation_chain",
        return_value=FakeChain(["a" * 40]),
    ):
        async with client.stream(
            "POST", "/api/chat/stream", json={"message": "doce letras!"}
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    assert token_limiter.used("1") > antes


@pytest.mark.asyncio
async def test_tokens_se_consumen_aunque_falle_el_llm(client, override_auth, mock_repo):
    antes = token_limiter.used("1")

    with patch(
        "barb.routers.chat.create_conversation_chain",
        return_value=FakeChain(["x"], raise_after=0),
    ):
        async with client.stream(
            "POST", "/api/chat/stream", json={"message": "input de prueba"}
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    assert token_limiter.used("1") > antes


# =============================================================================
# Multi-usuario
# =============================================================================

@pytest.mark.asyncio
async def test_usuarios_distintos_crean_sesiones_distintas(client, mock_repo):

    def make_user(uid: int, empresa_id: int) -> dict:
        return {
            "id": uid,
            "empresa_id": empresa_id,
            "name": f"u{uid}",
            "email": f"u{uid}@b.com",
            "role": "admin",
        }

    captured_calls = []

    def fake_create(**kwargs):
        captured_calls.append((kwargs["usuario_id"], kwargs["empresa_id"]))
        return str(uuid.uuid4())

    mock_repo["create_session"].side_effect = fake_create

    try:
        with patch(
            "barb.routers.chat.create_conversation_chain",
            return_value=FakeChain(["x"]),
        ):
            for uid, emp in ((1, 1), (2, 1)):
                app.dependency_overrides[get_current_user] = (
                    lambda uid=uid, emp=emp: make_user(uid, emp)
                )
                async with client.stream(
                    "POST", "/api/chat/stream", json={"message": "hola"}
                ) as resp:
                    _ = "".join([c async for c in resp.aiter_text()])
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert captured_calls == [(1, 1), (2, 1)]