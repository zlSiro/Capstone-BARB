# backend/src/barb/services/document_repository.py
"""
Repositorio de documentos para RAG (HU-04).

Capa de persistencia sobre las tablas `documento` y `documento_embedding`
(migración 0003; ampliadas por 0004_multiempresa_documentos). El diseño
completo está en docs/RAG_ARCHITECTURE.md (D2/D5/D6).

Aislamiento multi-empresa (misma regla que el resto del sistema): TODAS las
funciones exigen `empresa_id` y filtran por él en SQL — una empresa jamás ve,
borra ni recupera documentos/chunks de otra. La búsqueda solo considera
documentos con `activo = TRUE` ("Uso por la IA" en el frontend).

Convención de ingesta (D5): primero se crea el documento con `chunks_indexed=0`
(create_documento) y luego se indexan sus chunks (set_chunks), que actualiza
el contador en la misma transacción. Si la indexación falla, el documento
queda en estado "subido sin indexar" y puede re-subirse — coherente con
docs/contrato_api_documents.md.

Nota: el flujo productivo actual usa búsqueda full-text (document_service);
este repositorio es la vía vectorial (embeddings/pgvector) para ranking
híbrido o futuras mejoras de relevancia semántica.
"""

from __future__ import annotations

import json
import logging

from barb.core.db import fetch_all, fetch_one, transaction

logger = logging.getLogger("barb.document_repo")

# Dimensión fija del modelo validado (D1: nvidia/nemotron-3-embed-1b).
EMBEDDING_DIM = 2048

_SELECT_BASE = """
    SELECT d.documento_id, d.empresa_id, d.title, d.notes, d.original_name,
           d.stored_name, d.file_id, d.chunks_indexed, d.created_at, d.activo,
           disc.nombre AS discipline, m.nombre AS machine
    FROM documento d
    LEFT JOIN disciplina disc ON disc.disciplina_id = d.discipline_id
    LEFT JOIN maquina   m    ON m.maquina_id = d.maquina_id
"""


def _vector_literal(embedding: list[float]) -> str:
    """Serializa el vector al formato de texto de pgvector: '[1,2,3]'."""
    return json.dumps(embedding, separators=(",", ""))


# ---------------------------------------------------------------------------
# Escritura
# ---------------------------------------------------------------------------


async def create_documento(
    *,
    empresa_id: int,
    title: str,
    original_name: str,
    stored_name: str,
    file_id: str,
    usuario_id: int | None = None,
    notes: str | None = None,
    discipline_id: int | None = None,
    maquina_id: int | None = None,
    content_type: str | None = None,
    size_bytes: int = 0,
) -> int:
    """Crea el registro del documento (chunks_indexed inicia en 0) y devuelve su id."""
    row = await fetch_one(
        """
        INSERT INTO documento (title, discipline_id, maquina_id, notes,
                               original_name, stored_name, file_id,
                               empresa_id, usuario_id, content_type, size_bytes)
        VALUES (%(title)s, %(discipline_id)s, %(maquina_id)s, %(notes)s,
                %(original_name)s, %(stored_name)s, %(file_id)s,
                %(empresa_id)s, %(usuario_id)s, %(content_type)s, %(size_bytes)s)
        RETURNING documento_id
        """,
        {
            "title": title,
            "discipline_id": discipline_id,
            "maquina_id": maquina_id,
            "notes": notes,
            "original_name": original_name,
            "stored_name": stored_name,
            "file_id": file_id,
            "empresa_id": empresa_id,
            "usuario_id": usuario_id,
            "content_type": content_type,
            "size_bytes": size_bytes,
        },
    )
    if not row:
        raise RuntimeError("No se pudo crear el documento")
    return int(row["documento_id"])


async def set_chunks(
    documento_id: int,
    chunks: list[tuple[int, str, list[float]]],
) -> int:
    """Indexa los chunks (chunk_index, content, embedding) de un documento.

    Transaccional: quedan todos los chunks + el contador actualizado, o nada.
    Devuelve la cantidad indexada.
    """
    if not chunks:
        return 0

    async with transaction() as cur:
        await cur.executemany(
            """
            INSERT INTO documento_embedding (documento_id, chunk_index, content, embedding)
            VALUES (%(documento_id)s, %(chunk_index)s, %(content)s, %(embedding)s::vector)
            """,
            [
                {
                    "documento_id": documento_id,
                    "chunk_index": index,
                    "content": content,
                    "embedding": _vector_literal(embedding),
                }
                for index, content, embedding in chunks
            ],
        )
        await cur.execute(
            "UPDATE documento SET chunks_indexed = %(total)s WHERE documento_id = %(id)s",
            {"total": len(chunks), "id": documento_id},
        )
    return len(chunks)


async def delete_documento(documento_id: int, empresa_id: int) -> bool:
    """Elimina el documento SI pertenece a la empresa; sus chunks caen por CASCADE."""
    row = await fetch_one(
        """
        DELETE FROM documento
        WHERE documento_id = %(id)s AND empresa_id = %(empresa_id)s
        RETURNING documento_id
        """,
        {"id": documento_id, "empresa_id": empresa_id},
    )
    return row is not None


# ---------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------


async def get_documento(documento_id: int, empresa_id: int) -> dict | None:
    """Devuelve el documento solo si pertenece a la empresa indicada."""
    return await fetch_one(
        _SELECT_BASE + " WHERE d.documento_id = %(id)s AND d.empresa_id = %(empresa_id)s",
        {"id": documento_id, "empresa_id": empresa_id},
    )


async def count_documentos(empresa_id: int) -> int:
    row = await fetch_one(
        "SELECT COUNT(*) AS total FROM documento WHERE empresa_id = %(empresa_id)s",
        {"empresa_id": empresa_id},
    )
    return int(row["total"]) if row else 0


async def list_documentos(empresa_id: int, limit: int = 20, offset: int = 0) -> list[dict]:
    """Lista paginada por fecha, los más recientes primero (contrato API)."""
    return await fetch_all(
        _SELECT_BASE
        + " WHERE d.empresa_id = %(empresa_id)s"
        + " ORDER BY d.created_at DESC LIMIT %(limit)s OFFSET %(offset)s",
        {"empresa_id": empresa_id, "limit": limit, "offset": offset},
    )


# ---------------------------------------------------------------------------
# Retrieval vectorial (D6)
# ---------------------------------------------------------------------------


async def search_similar_chunks(
    query_embedding: list[float],
    empresa_id: int,
    top_k: int = 4,
) -> list[dict]:
    """Top-k chunks más similares por distancia coseno, SOLO de la empresa.

    Considera únicamente documentos con `activo = TRUE` y devuelve el título
    del documento (para citar la fuente, como piden las RAG_RULES del chat).

    Usa el mismo cast halfvec(2048) del índice HNSW (ver migración 0003):
    con 2048 dimensiones, HNSW solo indexa la proyección a float16.
    """
    query = _vector_literal(query_embedding)
    return await fetch_all(
        """
        SELECT e.documento_id, e.chunk_index, e.content, d.title AS documento,
               e.embedding::halfvec(2048) <=> %(query)s::halfvec(2048) AS distancia
        FROM documento_embedding e
        JOIN documento d ON d.documento_id = e.documento_id
        WHERE d.empresa_id = %(empresa_id)s AND d.activo = TRUE
        ORDER BY e.embedding::halfvec(2048) <=> %(query)s::halfvec(2048)
        LIMIT %(top_k)s
        """,
        {"query": query, "empresa_id": empresa_id, "top_k": top_k},
    )
