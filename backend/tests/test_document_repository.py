"""Tests de integración del repositorio de documentos (CGBIDA-242).

Requisitos (como el resto de la suite): Postgres arriba, migraciones
aplicadas (0003-0005) y seed multi-empresa. Limpian sus propios datos.

El aislamiento por empresa se prueba explícitamente: una empresa jamás ve,
borra ni recupera chunks de otra (misma regla que chat_repository).
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from barb.core.db import execute, fetch_one
from barb.services import document_repository as repo
from barb.services.document_repository import EMBEDDING_DIM

EMPRESA_1 = 1  # Planta Demo BARB (seed)
EMPRESA_2 = 2  # Minera Norte S.A. (seed)


@pytest_asyncio.fixture
async def cleanup_documentos(db_pool):
    """Registra ids creados por cada test y los borra al final."""
    created: list[int] = []
    yield created
    for did in created:
        try:
            await execute("DELETE FROM documento WHERE documento_id = %(id)s", {"id": did})
        except Exception:
            pass


def _vec(valor: float) -> list[float]:
    """Vector constante de la dimensión del modelo (2048)."""
    return [valor] * EMBEDDING_DIM


async def _crear_documento_indexado(
    cleanup: list[int],
    title: str,
    empresa_id: int = EMPRESA_1,
    chunk_embeddings: list[list[float]] | None = None,
    activo: bool = True,
) -> int:
    """Crea un documento (opcionalmente con chunks) de la empresa indicada."""
    did = await repo.create_documento(
        empresa_id=empresa_id,
        title=title,
        original_name=f"{title}.pdf",
        stored_name=f"{title}.bin",
        file_id=f"file-{title}",
    )
    cleanup.append(did)
    if chunk_embeddings:
        await repo.set_chunks(
            did,
            [(i, f"chunk {i} de {title}", emb) for i, emb in enumerate(chunk_embeddings)],
        )
    if not activo:
        await execute(
            "UPDATE documento SET activo = FALSE WHERE documento_id = %(id)s", {"id": did}
        )
    return did


# =============================================================================
# create_documento / set_chunks
# =============================================================================


@pytest.mark.asyncio
async def test_create_documento_inicia_con_cero_chunks(cleanup_documentos):
    did = await repo.create_documento(
        empresa_id=EMPRESA_1,
        title="Manual sin indexar",
        original_name="a.pdf",
        stored_name="a.bin",
        file_id="file-a",
    )
    cleanup_documentos.append(did)

    doc = await repo.get_documento(did, empresa_id=EMPRESA_1)
    assert doc is not None
    assert doc["chunks_indexed"] == 0
    assert doc["activo"] is True


@pytest.mark.asyncio
async def test_create_documento_exige_empresa_del_schema():
    """El schema (0004) exige empresa_id NOT NULL: None debe fallar limpio."""
    from psycopg.errors import NotNullViolation

    with pytest.raises(NotNullViolation):
        await repo.create_documento(
            empresa_id=None,  # type: ignore[arg-type]
            title="Sin empresa",
            original_name="x.pdf",
            stored_name="x.bin",
            file_id="file-x",
        )


@pytest.mark.asyncio
async def test_set_chunks_indexa_y_actualiza_contador(cleanup_documentos):
    did = await _crear_documento_indexado(
        cleanup_documentos, "Manual con 3 chunks", chunk_embeddings=[_vec(1.0)] * 3
    )

    row = await fetch_one(
        "SELECT COUNT(*) AS n FROM documento_embedding WHERE documento_id = %(id)s",
        {"id": did},
    )
    assert row["n"] == 3

    doc = await repo.get_documento(did, empresa_id=EMPRESA_1)
    assert doc["chunks_indexed"] == 3


# =============================================================================
# Aislamiento por empresa (misma regla que chat_repository)
# =============================================================================


@pytest.mark.asyncio
async def test_get_documento_de_otra_empresa_devuelve_none(cleanup_documentos):
    did = await _crear_documento_indexado(cleanup_documentos, "Doc empresa 2", empresa_id=EMPRESA_2)

    assert await repo.get_documento(did, empresa_id=EMPRESA_1) is None
    assert await repo.get_documento(did, empresa_id=EMPRESA_2) is not None


@pytest.mark.asyncio
async def test_search_similar_no_cruza_empresas(cleanup_documentos):
    """La búsqueda vectorial de la empresa 1 jamás recupera chunks de la 2."""
    await _crear_documento_indexado(
        cleanup_documentos, "Manual positivo", empresa_id=EMPRESA_1, chunk_embeddings=[_vec(1.0)]
    )
    await _crear_documento_indexado(
        cleanup_documentos, "Manual negativo ajeno", empresa_id=EMPRESA_2,
        chunk_embeddings=[_vec(-1.0)],  # MÁS cercano al query que el de empresa 1
    )

    resultados = await repo.search_similar_chunks(_vec(1.0), empresa_id=EMPRESA_1, top_k=4)

    assert len(resultados) == 1
    assert "positivo" in resultados[0]["content"]


@pytest.mark.asyncio
async def test_search_similar_ignora_documentos_inactivos(cleanup_documentos):
    await _crear_documento_indexado(
        cleanup_documentos, "Manual inactivo", empresa_id=EMPRESA_1,
        chunk_embeddings=[_vec(1.0)], activo=False,
    )

    resultados = await repo.search_similar_chunks(_vec(1.0), empresa_id=EMPRESA_1, top_k=4)
    assert len(resultados) == 0


@pytest.mark.asyncio
async def test_search_similar_devuelve_el_chunk_mas_cercano_y_su_documento(cleanup_documentos):
    await _crear_documento_indexado(
        cleanup_documentos, "Manual positivo", empresa_id=EMPRESA_1, chunk_embeddings=[_vec(1.0)]
    )
    await _crear_documento_indexado(
        cleanup_documentos, "Manual negativo", empresa_id=EMPRESA_1, chunk_embeddings=[_vec(-1.0)]
    )

    resultados = await repo.search_similar_chunks(_vec(1.0), empresa_id=EMPRESA_1, top_k=2)

    assert len(resultados) == 2
    assert "positivo" in resultados[0]["documento"]  # título para citar la fuente
    assert resultados[0]["distancia"] < resultados[1]["distancia"]


@pytest.mark.asyncio
async def test_search_similar_respeta_top_k(cleanup_documentos):
    for i in range(5):
        await _crear_documento_indexado(
            cleanup_documentos, f"Manual {i}", empresa_id=EMPRESA_1, chunk_embeddings=[_vec(1.0)]
        )

    resultados = await repo.search_similar_chunks(_vec(1.0), empresa_id=EMPRESA_1, top_k=3)
    assert len(resultados) == 3


# =============================================================================
# delete / list
# =============================================================================


@pytest.mark.asyncio
async def test_delete_documento_borra_chunks_en_cascada(cleanup_documentos):
    did = await _crear_documento_indexado(
        cleanup_documentos, "Manual a borrar", empresa_id=EMPRESA_1, chunk_embeddings=[_vec(0.5)]
    )

    assert await repo.delete_documento(did, empresa_id=EMPRESA_1) is True

    row = await fetch_one(
        "SELECT COUNT(*) AS n FROM documento_embedding WHERE documento_id = %(id)s",
        {"id": did},
    )
    assert row["n"] == 0, "los chunks deben desaparecer por ON DELETE CASCADE"
    assert await repo.get_documento(did, empresa_id=EMPRESA_1) is None


@pytest.mark.asyncio
async def test_delete_documento_de_otra_empresa_devuelve_false(cleanup_documentos):
    did = await _crear_documento_indexado(cleanup_documentos, "Doc empresa 2", empresa_id=EMPRESA_2)

    assert await repo.delete_documento(did, empresa_id=EMPRESA_1) is False
    assert await repo.get_documento(did, empresa_id=EMPRESA_2) is not None, "no lo borró"


@pytest.mark.asyncio
async def test_delete_documento_inexistente_devuelve_false():
    assert await repo.delete_documento(999_999, empresa_id=EMPRESA_1) is False


@pytest.mark.asyncio
async def test_list_documentos_filtra_por_empresa_y_ordena_desc(cleanup_documentos):
    viejo = await repo.create_documento(
        empresa_id=EMPRESA_1, title="Documento viejo",
        original_name="v.pdf", stored_name="v.bin", file_id="f-v",
    )
    de_otra_empresa = await repo.create_documento(
        empresa_id=EMPRESA_2, title="Ajeno",
        original_name="a.pdf", stored_name="a.bin", file_id="f-a",
    )
    nuevo = await repo.create_documento(
        empresa_id=EMPRESA_1, title="Documento nuevo",
        original_name="n.pdf", stored_name="n.bin", file_id="f-n",
    )
    cleanup_documentos.extend([viejo, de_otra_empresa, nuevo])

    lista = await repo.list_documentos(empresa_id=EMPRESA_1, limit=10)
    ids = [d["documento_id"] for d in lista]

    assert lista[0]["documento_id"] == nuevo, "el más reciente va primero"
    assert de_otra_empresa not in ids, "no lista documentos de otras empresas"
