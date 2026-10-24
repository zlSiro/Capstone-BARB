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


# ---------------------------------------------------------------------------
# Ingesta: los documentos nuevos se vectorizan en el mismo POST (HU-04 Fase 1)
# ---------------------------------------------------------------------------


class _CursorFalso:
    """Cursor mínimo: registra las llamadas para poder afirmar qué se ejecutó."""

    def __init__(self) -> None:
        self.ejecutados: list[str] = []
        self.filas: list[tuple] = []

    async def executemany(self, sql: str, params) -> None:
        self.ejecutados.append(sql)
        self.filas.extend(params)


@pytest.mark.asyncio
async def test_ingesta_guarda_los_vectores(monkeypatch):
    """Si el proveedor responde, el documento queda vectorizado sin esperar al backfill."""
    cur = _CursorFalso()
    capturado: dict = {}

    async def fake_embed_lote(textos):
        return [[0.1] * emb.EMBEDDING_DIM for _ in textos]

    async def fake_insert(cursor, documento_id, chunks):
        capturado["documento_id"] = documento_id
        capturado["chunks"] = chunks
        return len(chunks)

    monkeypatch.setattr(document_service, "embed_lote", fake_embed_lote)
    monkeypatch.setattr(document_service, "insert_embeddings", fake_insert)

    await document_service.index_chunks(cur, documento_id=42, empresa_id=1, chunks=["uno", "dos"])

    # Siempre se insertan los chunks de texto...
    assert len(cur.ejecutados) == 1
    assert "documento_chunk" in cur.ejecutados[0]
    # ...y además los vectores, con su índice alineado al orden del chunk.
    assert capturado["documento_id"] == 42
    assert [c[0] for c in capturado["chunks"]] == [0, 1]
    assert [c[1] for c in capturado["chunks"]] == ["uno", "dos"]


@pytest.mark.asyncio
async def test_ingesta_no_falla_si_el_proveedor_de_embeddings_cae(monkeypatch):
    """
    Un proveedor caído no puede rechazar la subida del usuario.

    El documento queda indexado para full-text y el backfill lo completa después: es
    preferible un documento encontrable por texto que un 500 al subirlo.
    """
    cur = _CursorFalso()
    llamado = {"insert": False}

    async def fake_embed_lote(_textos):
        raise emb.EmbeddingsError("503 del proveedor")

    async def fake_insert(*_a, **_k):
        llamado["insert"] = True
        return 0

    monkeypatch.setattr(document_service, "embed_lote", fake_embed_lote)
    monkeypatch.setattr(document_service, "insert_embeddings", fake_insert)

    await document_service.index_chunks(cur, documento_id=43, empresa_id=1, chunks=["uno"])

    assert len(cur.ejecutados) == 1  # los chunks de texto sí se guardaron
    assert llamado["insert"] is False


@pytest.mark.asyncio
async def test_ingesta_puede_omitir_los_embeddings(monkeypatch):
    """`embeber=False` existe para reindexar solo texto (reprocesos, pruebas)."""
    cur = _CursorFalso()

    async def fake_embed_lote(_textos):
        raise AssertionError("no debería llamarse con embeber=False")

    monkeypatch.setattr(document_service, "embed_lote", fake_embed_lote)

    await document_service.index_chunks(cur, documento_id=44, empresa_id=1, chunks=["x"], embeber=False)
    assert len(cur.ejecutados) == 1


@pytest.mark.asyncio
async def test_segunda_pasada_con_umbral_laxo_cuando_el_estricto_no_devuelve_nada(monkeypatch):
    """
    Consulta mal escrita: el vector sí encuentra el fragmento, pero no llega al umbral
    estricto. Antes el chat se quedaba sin contexto (el caso real: «quiero ver la
    instrucción del compresor» puntuaba 0.229 contra un umbral de 0.25).
    """
    llamadas: list[float | None] = []
    laxo = [{"chunk_id": None, "documento_id": 4, "title": "Manual Compresor A1", "contenido": "x", "rank": 0.2}]

    async def semantico(_empresa, *_a, limit=4, min_similarity=None, **_k):
        llamadas.append(min_similarity)
        return [] if min_similarity is None else laxo

    monkeypatch.setattr(document_service, "embeddings_disponibles", lambda: True)
    monkeypatch.setattr(document_service, "search_chunks_semantic", semantico)

    resultado = await document_service.search_chunks(1, "quiero ver la instruccion del compresor")

    assert resultado == laxo
    # Dos intentos: el estricto (None = usa settings) y el laxo con el umbral de config.
    assert len(llamadas) == 2
    assert llamadas[0] is None
    assert llamadas[1] == document_service.settings.rag_min_similarity_laxa


@pytest.mark.asyncio
async def test_si_tampoco_hay_nada_con_umbral_laxo_cae_a_full_text(monkeypatch):
    lexico = [{"chunk_id": 1, "documento_id": 1, "title": "L", "contenido": "z", "rank": 0.3}]

    async def semantico(*_a, **_k):
        return []

    async def lex(*_a, **_k):
        return lexico

    monkeypatch.setattr(document_service, "embeddings_disponibles", lambda: True)
    monkeypatch.setattr(document_service, "search_chunks_semantic", semantico)
    monkeypatch.setattr(document_service, "search_chunks_lexical", lex)

    assert await document_service.search_chunks(1, "algo") == lexico
