# backend/tests/test_chat_multimedia.py
"""
Tests del endpoint POST /api/chat/multimedia (HU-05, CGBIDA-276/277).

Contrato: docs/contrato_api_chat_multimedia.md
- Validaciones de payload: 400 (sin imagen/mensaje vacío), 413 (tamaño),
  422 (formato no permitido → array de errores Pydantic).
- Infra compartida con /api/chat/stream: JWT, rate limit, token limit, SSE.
- Persistencia: SOLO el texto del turno (la imagen no se guarda, D2).
- Contabilidad: ~4096 tokens visuales por imagen (D6).

El LLM multimodal se simula con FakeChain (no se llama a NIM aquí); el ping
real contra muse-glimmer-30b se validó aparte (ver MULTIMODAL_ARCHITECTURE.md).
"""

from __future__ import annotations

import base64
import uuid
from unittest.mock import patch

import pytest

from barb.core.config import settings
from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import estimate_tokens, token_limiter
from barb.main import app
from barb.services.llm_service import MULTIMODAL_IMAGE_TOKENS, _prepare_multimodal_input

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


@pytest.fixture(autouse=True)
def mock_search():
    """
    D5 v1.1: el turno multimodal consulta search_chunks como el stream. Patch
    autouse para que los tests no dependan de la BD; los que prueban el RAG
    ajustan return_value.
    """
    with patch("barb.routers.chat.search_chunks", return_value=[]) as m:
        yield m


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
    """Sustituto del chain multimodal: captura el payload y emite chunks."""

    def __init__(self, chunks: list[str], raise_after: int | None = None):
        self.chunks = chunks
        self.raise_after = raise_after
        self.last_payload: dict | None = None

    async def astream(self, *args, **_kwargs):
        self.last_payload = args[0] if args else {}
        for i, chunk in enumerate(self.chunks):
            if self.raise_after is not None and i == self.raise_after:
                raise RuntimeError("boom del LLM multimodal")
            yield chunk


def _img_b64(data: bytes = b"datos-de-imagen-de-prueba") -> str:
    """Data URL válida (contenido arbitrario: el modelo va mockeado)."""
    return f"data:image/png;base64,{base64.b64encode(data).decode()}"


def _parse_sse(raw: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    current_event: str | None = None
    import json

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


def _multimedia_body(message: str = "¿Qué le pasa a esta bomba?", **extra) -> dict:
    body = {"message": message, "image_base64": _img_b64()}
    body.update(extra)
    return body


# =============================================================================
# Autenticación
# =============================================================================

@pytest.mark.asyncio
async def test_sin_header_authorization(client):
    resp = await client.post("/api/chat/multimedia", json=_multimedia_body())
    assert resp.status_code == 401


# =============================================================================
# Validación de payload (contrato: 400 / 413 / 422)
# =============================================================================

@pytest.mark.asyncio
async def test_falta_message_422(client, override_auth):
    resp = await client.post(
        "/api/chat/multimedia", json={"image_base64": _img_b64()}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_falta_image_base64_422(client, override_auth):
    resp = await client.post(
        "/api/chat/multimedia", json={"message": "¿Qué ves?"}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_mensaje_vacio_400(client, override_auth):
    resp = await client.post(
        "/api/chat/multimedia", json={"message": "   ", "image_base64": _img_b64()}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Debes adjuntar una imagen y una pregunta."


@pytest.mark.asyncio
async def test_mensaje_muy_largo_422(client, override_auth):
    resp = await client.post(
        "/api/chat/multimedia",
        json={"message": "x" * 2001, "image_base64": _img_b64()},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_sin_data_url_400(client, override_auth):
    resp = await client.post(
        "/api/chat/multimedia",
        json={"message": "¿Qué ves?", "image_base64": "hola-mundo"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Debes adjuntar una imagen y una pregunta."


@pytest.mark.asyncio
async def test_base64_ilegible_400(client, override_auth):
    resp = await client.post(
        "/api/chat/multimedia",
        json={
            "message": "¿Qué ves?",
            "image_base64": "data:image/png;base64,@@@@====",
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_base64_vacio_400(client, override_auth):
    """Data URL con payload vacío = sin imagen (400 del contrato)."""
    resp = await client.post(
        "/api/chat/multimedia",
        json={"message": "¿Qué ves?", "image_base64": "data:image/png;base64,"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Debes adjuntar una imagen y una pregunta."


@pytest.mark.asyncio
async def test_formato_no_permitido_422_array_pydantic(client, override_auth):
    """El contrato exige 422 con array de errores Pydantic para formato inválido."""
    resp = await client.post(
        "/api/chat/multimedia",
        json={
            "message": "¿Qué ves?",
            "image_base64": "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        },
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, list), "El 422 de formato debe ser un array de errores Pydantic"
    assert any("no permitido" in err["msg"] for err in detail)
    assert any("image/gif" in err["msg"] for err in detail)


@pytest.mark.asyncio
async def test_formatos_permitidos_pasan_validacion(client, override_auth, mock_repo):
    """jpeg, png y webp pasan la validación de formato (el LLM va mockeado)."""
    for mime in ("image/jpeg", "image/png", "image/webp"):
        body = {
            "message": "¿Qué ves?",
            "image_base64": f"data:{mime};base64,{base64.b64encode(b'img').decode()}",
        }
        with patch(
            "barb.routers.chat.create_multimodal_chain",
            return_value=FakeChain(["ok"]),
        ):
            async with client.stream("POST", "/api/chat/multimedia", json=body) as resp:
                raw = "".join([c async for c in resp.aiter_text()])
        assert "event: done" in raw, f"{mime} debería ser aceptado"


@pytest.mark.asyncio
async def test_imagen_sobre_5mb_413(client, override_auth):
    """413 sobre el tamaño DECODIFICADO (no sobre el string base64)."""
    oversized = base64.b64encode(b"x" * (settings.multimodal_max_image_mb * 1024 * 1024 + 1)).decode()
    resp = await client.post(
        "/api/chat/multimedia",
        json={
            "message": "¿Qué ves?",
            "image_base64": f"data:image/png;base64,{oversized}",
        },
    )
    assert resp.status_code == 413
    assert resp.json()["detail"] == "La imagen supera el máximo de 5 MB."


@pytest.mark.asyncio
async def test_imagen_justo_bajo_el_limite_pasa(client, override_auth, mock_repo):
    """Cobertura del borde: exactamente el máximo decodificado se acepta."""
    data = b"x" * (settings.multimodal_max_image_mb * 1024 * 1024)
    with patch(
        "barb.routers.chat.create_multimodal_chain",
        return_value=FakeChain(["ok"]),
    ):
        async with client.stream(
            "POST",
            "/api/chat/multimedia",
            json={"message": "¿Qué ves?", "image_base64": _img_b64(data)},
        ) as resp:
            assert resp.status_code == 200
            raw = "".join([c async for c in resp.aiter_text()])
    assert "event: done" in raw


# =============================================================================
# Modelo no configurado → 503
# =============================================================================

@pytest.mark.asyncio
async def test_modelo_no_configurado_503(client, override_auth, monkeypatch, mock_repo):
    monkeypatch.setattr(settings, "multimodal_model", "")
    resp = await client.post("/api/chat/multimedia", json=_multimedia_body())
    assert resp.status_code == 503
    assert resp.json()["detail"] == (
        "El análisis de imágenes no está disponible (MULTIMODAL_MODEL)."
    )
    mock_repo["create_session"].assert_not_called()


@pytest.mark.asyncio
async def test_sin_api_key_503(client, override_auth, monkeypatch, mock_repo):
    """Sin key dedicada NI NVIDIA_API_KEY el endpoint responde 503."""
    monkeypatch.setattr(settings, "nvidia_multimodal_api_key", "")
    monkeypatch.setattr(settings, "nvidia_api_key", "")
    resp = await client.post("/api/chat/multimedia", json=_multimedia_body())
    assert resp.status_code == 503


# =============================================================================
# Rate limit y token limit (compartidos con el stream)
# =============================================================================

@pytest.mark.asyncio
async def test_rate_limit_429(client, override_auth, mock_repo):
    with patch(
        "barb.routers.chat.create_multimodal_chain",
        return_value=FakeChain(["ok"]),
    ):
        for _ in range(10):
            r = await client.post("/api/chat/multimedia", json=_multimedia_body())
            assert r.status_code == 200, f"Falla en intento previo: {r.status_code}"

        r = await client.post("/api/chat/multimedia", json=_multimedia_body())
        assert r.status_code == 429
        assert "Retry-After" in r.headers


@pytest.mark.asyncio
async def test_token_limit_429(client, override_auth):
    token_limiter.add("1", token_limiter.max_tokens)
    r = await client.post("/api/chat/multimedia", json=_multimedia_body())
    assert r.status_code == 429
    assert "tokens" in r.json()["detail"].lower()


# =============================================================================
# session_id (misma mecánica que el stream)
# =============================================================================

@pytest.mark.asyncio
async def test_session_id_formato_invalido_422(client, override_auth, mock_repo):
    resp = await client.post(
        "/api/chat/multimedia",
        json=_multimedia_body(session_id="no-es-un-uuid"),
    )
    assert resp.status_code == 422
    assert "UUID" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_session_id_no_existe_404(client, override_auth, mock_repo):
    mock_repo["get_session"].return_value = None
    resp = await client.post(
        "/api/chat/multimedia",
        json=_multimedia_body(session_id=str(uuid.uuid4())),
    )
    assert resp.status_code == 404


# =============================================================================
# Streaming: happy path
# =============================================================================

@pytest.mark.asyncio
async def test_stream_happy_path_sesion_nueva(client, override_auth, mock_repo):
    fake_uuid = "55555555-5555-5555-5555-555555555555"
    mock_repo["create_session"].return_value = fake_uuid
    img = _img_b64()
    body = {"message": "¿Qué le pasa a esta bomba?", "image_base64": img}

    fake_chain = FakeChain(["Basado", " en la imagen..."])
    with patch(
        "barb.routers.chat.create_multimodal_chain", return_value=fake_chain
    ):
        async with client.stream("POST", "/api/chat/multimedia", json=body) as resp:
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")
            raw = "".join([c async for c in resp.aiter_text()])

    events = _parse_sse(raw)
    tipos = [e for e, _ in events]

    # Mismos eventos que el stream textual
    assert tipos[0] == "session"
    assert tipos[-1] == "done"
    assert tipos.count("token") == 2

    session_evt = next(d for e, d in events if e == "session")
    assert session_evt["session_id"] == fake_uuid

    contenido = "".join(d["text"] for e, d in events if e == "token")
    assert contenido == "Basado en la imagen..."

    # El chain recibe pregunta + imagen + historial vacío
    assert fake_chain.last_payload["input"] == "¿Qué le pasa a esta bomba?"
    assert fake_chain.last_payload["image"] == img
    assert fake_chain.last_payload["history"] == []

    # La sesión se crea con la empresa del usuario
    mock_repo["create_session"].assert_called_once()
    kwargs = mock_repo["create_session"].call_args.kwargs
    assert kwargs["usuario_id"] == 1
    assert kwargs["empresa_id"] == 1
    assert kwargs["primer_mensaje"] == "¿Qué le pasa a esta bomba?"


@pytest.mark.asyncio
async def test_stream_sesion_existente_recupera_historial(client, override_auth, mock_repo):
    fake_uuid = "66666666-6666-6666-6666-666666666666"
    mock_repo["get_session"].return_value = {"session_id": fake_uuid, "usuario_id": 1}
    mock_repo["load_messages"].return_value = [
        {"role": "user", "content": "pregunta previa"},
        {"role": "assistant", "content": "respuesta previa"},
    ]

    fake_chain = FakeChain(["ok"])
    with patch(
        "barb.routers.chat.create_multimodal_chain", return_value=fake_chain
    ):
        async with client.stream(
            "POST",
            "/api/chat/multimedia",
            json=_multimedia_body(session_id=fake_uuid),
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    assert fake_chain.last_payload["history"] == [
        {"role": "user", "content": "pregunta previa"},
        {"role": "assistant", "content": "respuesta previa"},
    ]
    mock_repo["create_session"].assert_not_called()
    mock_repo["load_messages"].assert_called_once_with(fake_uuid, 1)


# =============================================================================
# Persistencia: SOLO el texto del turno (D2 — la imagen no se guarda)
# =============================================================================

@pytest.mark.asyncio
async def test_persistencia_guarda_solo_texto(client, override_auth, mock_repo):
    fake_uuid = "77777777-7777-7777-7777-777777777777"
    mock_repo["create_session"].return_value = fake_uuid

    with patch(
        "barb.routers.chat.create_multimodal_chain",
        return_value=FakeChain(["respuesta visual"]),
    ):
        async with client.stream(
            "POST", "/api/chat/multimedia", json=_multimedia_body(message="¿Qué ves?")
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    mock_repo["append_messages"].assert_called_once()
    args = mock_repo["append_messages"].call_args.args
    assert args[0] == fake_uuid
    assert args[1] == 1
    nuevos = args[2]
    assert len(nuevos) == 2
    assert nuevos[0]["role"] == "user"
    assert nuevos[0]["content"] == "¿Qué ves?"
    assert nuevos[1]["role"] == "assistant"
    assert nuevos[1]["content"] == "respuesta visual"
    # D2: la imagen NUNCA llega a la persistencia
    assert "image" not in str(nuevos).lower()
    assert "base64" not in str(nuevos)


@pytest.mark.asyncio
async def test_persistencia_aunque_falle_llm(client, override_auth, mock_repo):
    with patch(
        "barb.routers.chat.create_multimodal_chain",
        return_value=FakeChain(["parcial", "segundo"], raise_after=1),
    ):
        async with client.stream(
            "POST", "/api/chat/multimedia", json=_multimedia_body()
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    mock_repo["append_messages"].assert_called_once()
    nuevos = mock_repo["append_messages"].call_args.args[2]
    assert nuevos[1]["role"] == "assistant"
    assert nuevos[1]["content"] == "parcial"


# =============================================================================
# Manejo de errores del LLM (evento SSE, HTTP ya es 200)
# =============================================================================

@pytest.mark.asyncio
async def test_error_llm_emite_evento_error_no_done(client, override_auth, mock_repo):
    with patch(
        "barb.routers.chat.create_multimodal_chain",
        return_value=FakeChain(["parcial", "segundo"], raise_after=1),
    ):
        async with client.stream(
            "POST", "/api/chat/multimedia", json=_multimedia_body()
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
    assert "boom del LLM multimodal" in error_data["message"]


# =============================================================================
# Contabilidad de tokens (D6: la imagen suma ~4096 tokens visuales)
# =============================================================================

@pytest.mark.asyncio
async def test_tokens_imagen_y_texto_se_registran(client, override_auth, mock_repo):
    antes = token_limiter.used("1")
    mensaje = "¿Qué le pasa a esta bomba?"
    salida = ["a" * 40]  # 40 chars → 10 tokens

    with patch(
        "barb.routers.chat.create_multimodal_chain",
        return_value=FakeChain(salida),
    ):
        async with client.stream(
            "POST", "/api/chat/multimedia", json=_multimedia_body(message=mensaje)
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    esperado = estimate_tokens(mensaje) + MULTIMODAL_IMAGE_TOKENS + len("".join(salida)) // 4
    assert token_limiter.used("1") - antes == esperado


@pytest.mark.asyncio
async def test_tokens_se_consumen_aunque_falle_el_llm(client, override_auth, mock_repo):
    antes = token_limiter.used("1")

    with patch(
        "barb.routers.chat.create_multimodal_chain",
        return_value=FakeChain(["x"], raise_after=0),
    ):
        async with client.stream(
            "POST", "/api/chat/multimedia", json=_multimedia_body()
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    delta = token_limiter.used("1") - antes
    # Al menos el costo fijo de la imagen se cobra por el intento.
    assert delta >= MULTIMODAL_IMAGE_TOKENS


# =============================================================================
# RBAC del DocChat (v1.1: idéntico al stream tras la HU-12/PR #23)
# =============================================================================

@pytest.mark.asyncio
async def test_super_usuario_recibe_403_igual_que_el_stream(client, mock_repo):
    """La política del DocChat completa es la misma: super_usuario no entra.
    El empresa_id del body (si llega) se ignora — ya no forma parte del request."""
    app.dependency_overrides[get_current_user] = lambda: {
        "id": 9,
        "empresa_id": None,
        "name": "Super",
        "email": "super@barb.com",
        "role": "super_usuario",
    }
    try:
        resp = await client.post(
            "/api/chat/multimedia",
            json=_multimedia_body(empresa_id=3),
        )
        assert resp.status_code == 403
        assert "DocChat" in resp.json()["detail"]
        mock_repo["create_session"].assert_not_called()
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_usuario_sin_empresa_recibe_403(client, mock_repo):
    """Misma guarda que el stream: un usuario sin empresa no tiene DocChat."""
    app.dependency_overrides[get_current_user] = lambda: {
        "id": 10,
        "empresa_id": None,
        "name": "Sin Empresa",
        "email": "ne@barb.com",
        "role": "admin",
    }
    try:
        resp = await client.post("/api/chat/multimedia", json=_multimedia_body())
        assert resp.status_code == 403
        mock_repo["create_session"].assert_not_called()
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# =============================================================================
# RAG multimodal (D5 v1.1): el turno con imagen consulta la documentación
# =============================================================================

@pytest.mark.asyncio
async def test_chunks_de_la_empresa_se_inyectan_al_chain(client, override_auth, mock_repo, mock_search):
    """Con coincidencia en la documentación, el chain recibe el contexto formateado."""
    mock_search.return_value = [{"title": "Manual Chancador CH-01", "contenido": "Torque 450 Nm"}]
    fake_chain = FakeChain(["respuesta"])
    with patch("barb.routers.chat.create_multimodal_chain", return_value=fake_chain):
        async with client.stream(
            "POST",
            "/api/chat/multimedia",
            json=_multimedia_body(message="¿Cómo se opera el chancador?"),
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    assert fake_chain.last_payload["context"] == (
        "[Documento: Manual Chancador CH-01]\nTorque 450 Nm"
    )


@pytest.mark.asyncio
async def test_sin_chunks_el_contexto_va_vacio(client, override_auth, mock_repo, mock_search):
    """Sin coincidencia, el turno multimodal sigue funcionando (solo visual)."""
    mock_search.return_value = []
    fake_chain = FakeChain(["respuesta"])
    with patch("barb.routers.chat.create_multimodal_chain", return_value=fake_chain):
        async with client.stream(
            "POST", "/api/chat/multimedia", json=_multimedia_body()
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    assert fake_chain.last_payload["context"] == ""


@pytest.mark.asyncio
async def test_la_busqueda_incluye_el_contexto_previo_del_asistente(client, override_auth, mock_repo, mock_search):
    """El mensaje del asistente del turno con imagen aporta el equipo a la búsqueda."""
    fake_uuid = "88888888-8888-8888-8888-888888888888"
    mock_repo["get_session"].return_value = {"session_id": fake_uuid, "usuario_id": 1}
    mock_repo["load_messages"].return_value = [
        {"role": "user", "content": "Descríbeme qué tipo de máquina es"},
        {"role": "assistant", "content": "Es un chancador de mandíbulas, trituradora primaria."},
    ]

    with patch("barb.routers.chat.create_multimodal_chain", return_value=FakeChain(["ok"])):
        async with client.stream(
            "POST",
            "/api/chat/multimedia",
            json=_multimedia_body(session_id=fake_uuid, message="¿Cómo funciona?"),
        ) as resp:
            _ = "".join([c async for c in resp.aiter_text()])

    args = mock_search.call_args.args
    assert args[0] == 1  # la empresa del usuario
    assert args[1] == "¿Cómo funciona?"
    assert args[2] == "Descríbeme qué tipo de máquina es"  # último mensaje del usuario
    assert args[3] == "Es un chancador de mandíbulas, trituradora primaria."  # último del asistente


# =============================================================================
# System prompt multimodal (D5 v1.1): etiquetado del origen del conocimiento
# =============================================================================

def test_prepare_input_con_documentacion_la_agrega_al_system():
    msgs = _prepare_multimodal_input(
        {
            "input": "¿Qué ves?",
            "image": "data:image/png;base64,QQ==",
            "context": "[Documento: Manual CH-01]\nTorque 450 Nm",
        }
    )
    system = msgs[0].content
    assert "DOCUMENTACIÓN DE LA EMPRESA" in system
    assert "Torque 450 Nm" in system
    # Reglas de etiquetado de origen (review HU-05)
    assert "identificación visual" in system
    # El mecanismo anti-razonamiento queda como última línea (validado vs NIM)
    assert system.endswith("Reasoning strength: low")
    # La documentación NO contamina el turno humano (solo texto + imagen)
    human_content = msgs[-1].content
    assert human_content[0] == {"type": "text", "text": "¿Qué ves?"}


def test_prepare_input_sin_documentacion_no_mienta_sobre_el_origen():
    msgs = _prepare_multimodal_input(
        {"input": "x", "image": "data:image/png;base64,QQ==", "context": ""}
    )
    system = msgs[0].content
    # La regla MENCIONA el bloque, pero el bloque inyectado (con formato ":\n") no está
    assert "DOCUMENTACIÓN DE LA EMPRESA:\n" not in system
    assert "identificación visual" in system
    assert system.endswith("Reasoning strength: low")
