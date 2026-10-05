"""Tests unitarios del cliente de embeddings (CGBIDA-242).

Con mocks: no llaman a la API de NVIDIA. La validación real del endpoint
se hace con una invocación directa (ver registro del 04-10 en Jira).
"""

from __future__ import annotations

import pytest

from barb.core.config import settings
from barb.services import embeddings_service
from barb.services.embeddings_service import embed_texts, get_embeddings_client


class _FakeClient:
    def __init__(self) -> None:
        self.llamadas: list[list[str]] = []

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.llamadas.append(list(texts))
        return [[0.5, 0.5] for _ in texts]


def test_embed_texts_envia_lote_y_mantiene_orden(monkeypatch) -> None:
    fake = _FakeClient()
    monkeypatch.setattr(embeddings_service, "get_embeddings_client", lambda: fake)

    vectores = embed_texts(["hola", "mundo"])

    assert len(vectores) == 2
    assert len(fake.llamadas) == 1, "todos los textos deben ir en UNA llamada por lote"
    assert fake.llamadas[0] == ["hola", "mundo"]


def test_embed_texts_lista_vacia_no_llama_a_la_api() -> None:
    def _explota():
        raise AssertionError("no debe construir el cliente con lista vacía")

    import barb.services.embeddings_service as svc
    svc.get_embeddings_client = _explota
    assert embed_texts([]) == []


def test_embed_texts_sin_key_lanza_error_claro(monkeypatch) -> None:
    monkeypatch.setattr(settings, "nvidia_api_key", "")
    with pytest.raises(RuntimeError, match="NVIDIA_API_KEY"):
        get_embeddings_client()


def test_cliente_usa_el_modelo_validado(monkeypatch) -> None:
    monkeypatch.setattr(settings, "nvidia_api_key", "nvapi-test")
    client = get_embeddings_client()
    assert client.model == "nvidia/nemotron-3-embed-1b"
