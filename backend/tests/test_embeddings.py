"""Tests del puente de embeddings y del enrutado semántico con fallback (HU-04 Fase 1).

Ningún test llama a la API real: los que necesitan un proveedor lo simulan. La red se
prueba a mano con `scripts/backfill_embeddings.py --dry-run`, que además valida la
dimensión contra la columna real. Acá se verifica lo que puede romperse en silencio:
la validación de dimensión y que el chat NO se quede sin recuperación si el proveedor
falla.
"""

from __future__ import annotations

import pytest

from barb.services import document_service
from barb.services import embeddings as emb


def test_acepta_la_dimension_que_exige_la_columna():
    emb._verificar_dimension([[0.0] * emb.EMBEDDING_DIM])


def test_rechaza_una_dimension_distinta_con_mensaje_util():
    with pytest.raises(emb.EmbeddingsDimensionInvalida) as excinfo:
        emb._verificar_dimension([[0.0] * 1024])
    # El mensaje debe decir qué modelo, qué dimensión trajo y qué exige la columna:
    # sin eso, el error aparece como violación de tipo de PostgreSQL y no se entiende.
    mensaje = str(excinfo.value)
    assert "1024" in mensaje
    assert str(emb.EMBEDDING_DIM) in mensaje
    assert "documento_embedding" in mensaje


@pytest.mark.asyncio
async def test_no_embebe_texto_vacio():
    with pytest.raises(ValueError):
        await emb.embed_texto("   ")


@pytest.mark.asyncio
async def test_lote_vacio_devuelve_lista_vacia():
    assert await emb.embed_lote([]) == []


@pytest.mark.asyncio
async def test_lote_con_chunk_vacio_falla_antes_de_llamar_a_la_api():
    with pytest.raises(ValueError):
        await emb.embed_lote(["texto", "  "])


@pytest.mark.asyncio
async def test_sin_configuracion_avisa_en_vez_de_fallar_raro(monkeypatch):
    monkeypatch.setattr(emb, "embeddings_disponibles", lambda: False)
    with pytest.raises(emb.EmbeddingsNoConfigurados):
        await emb._pedir(["algo"], "query")


def test_embeddings_disponibles_refleja_la_configuracion(monkeypatch):
    """Sin modelo o sin key, `embeddings_disponibles()` es False y no se llama a la API."""

    class _SinKey:
        embeddings_configurados = False

    class _Completo:
        embeddings_configurados = True

    monkeypatch.setattr(emb, "settings", _SinKey())
    assert emb.embeddings_disponibles() is False

    monkeypatch.setattr(emb, "settings", _Completo())
    assert emb.embeddings_disponibles() is True


# ---------------------------------------------------------------------------
# Enrutado: semántico primero, léxico como red de seguridad
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_usa_el_semantico_cuando_responde(monkeypatch):
    esperado = [{"chunk_id": None, "documento_id": 1, "title": "T", "contenido": "c", "rank": 0.9}]

    async def semantico(*_a, **_k):
        return esperado

    monkeypatch.setattr(document_service, "embeddings_disponibles", lambda: True)
    monkeypatch.setattr(document_service, "search_chunks_semantic", semantico)

    assert await document_service.search_chunks(1, "consulta") == esperado


@pytest.mark.asyncio
async def test_cae_a_lexico_si_el_proveedor_falla(monkeypatch):
    """
    Un timeout de NVIDIA no puede dejar al chat sin documentación.

    Es el caso más probable en producción: el free tier tiene latencia variable.
    """
    lexico = [{"chunk_id": 7, "documento_id": 2, "title": "L", "contenido": "x", "rank": 0.1}]
    llamado = {"lexico": False}

    async def semantico(*_a, **_k):
        raise emb.EmbeddingsError("timeout del proveedor")

    async def lex(*_a, **_k):
        llamado["lexico"] = True
        return lexico

    monkeypatch.setattr(document_service, "embeddings_disponibles", lambda: True)
    monkeypatch.setattr(document_service, "search_chunks_semantic", semantico)
    monkeypatch.setattr(document_service, "search_chunks_lexical", lex)

    assert await document_service.search_chunks(1, "consulta") == lexico
    assert llamado["lexico"] is True


@pytest.mark.asyncio
async def test_cae_a_lexico_si_el_semantico_no_supera_el_umbral(monkeypatch):
    """Si ningún fragmento llega al umbral, la vía semántica devuelve [] y se prueba texto."""
    lexico = [{"chunk_id": 3, "documento_id": 2, "title": "L", "contenido": "y", "rank": 0.2}]

    async def semantico_vacio(*_a, **_k):
        return []

    async def lex(*_a, **_k):
        return lexico

    monkeypatch.setattr(document_service, "embeddings_disponibles", lambda: True)
    monkeypatch.setattr(document_service, "search_chunks_semantic", semantico_vacio)
    monkeypatch.setattr(document_service, "search_chunks_lexical", lex)

    assert await document_service.search_chunks(1, "consulta") == lexico


@pytest.mark.asyncio
async def test_sin_key_va_directo_al_lexico(monkeypatch):
    """Sin embeddings configurados no se intenta la red siquiera."""
    lexico = [{"chunk_id": 1, "documento_id": 1, "title": "L", "contenido": "z", "rank": 0.3}]

    async def semantico(*_a, **_k):
        raise AssertionError("no debería llamarse sin configuración")

    async def lex(*_a, **_k):
        return lexico

    monkeypatch.setattr(document_service, "embeddings_disponibles", lambda: False)
    monkeypatch.setattr(document_service, "search_chunks_semantic", semantico)
    monkeypatch.setattr(document_service, "search_chunks_lexical", lex)

    assert await document_service.search_chunks(1, "consulta") == lexico
