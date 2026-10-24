"""
Documentación por empresa para el chat IA (RAG).

Flujo:
  1. `extract_text`  : archivo subido -> texto plano (pdf, docx, txt, md, csv, json, log).
  2. `split_chunks`  : texto -> fragmentos de ~1000 caracteres con solape.
  3. `index_document`: guarda los fragmentos en `documento_chunk` (con tsvector generado).
  4. `search_chunks` : dado un mensaje del usuario, devuelve los fragmentos más
                       relevantes de LA EMPRESA indicada.

Búsqueda (HU-04, Fase 1): `search_chunks` es **semántica** — embebe la pregunta y ordena
por distancia coseno en pgvector (`search_similar_chunks`). Antes era solo full-text, y
eso dejaba fuera el caso que más importa: si el usuario escribe «torque» y el manual dice
«par de apriete», `to_tsquery` no los relaciona y los embeddings sí.

Si el proveedor de embeddings no está configurado, falla o la tabla está vacía, se cae a
`search_chunks_lexical` (el comportamiento anterior). El chat nunca se queda sin
recuperación por un problema del proveedor.

El aislamiento es estricto: ambas búsquedas exigen `empresa_id` y filtran por él en SQL,
de modo que la IA jamás recibe texto de otra empresa. Solo se consideran documentos con
`activo = TRUE`.
"""

from __future__ import annotations

import io
import logging
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from fastapi import HTTPException

from barb.core.config import settings
from barb.core.db import fetch_all
from barb.services.document_repository import insert_embeddings, search_similar_chunks
from barb.services.embeddings import embed_lote, embed_texto, embeddings_disponibles

logger = logging.getLogger("barb.documents")

EXTENSIONES_TEXTO = {".txt", ".md", ".csv", ".json", ".log"}
EXTENSIONES_PERMITIDAS = EXTENSIONES_TEXTO | {".pdf", ".docx"}
MAX_BYTES = 15 * 1024 * 1024  # 15 MB por documento

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
MAX_CHUNKS_POR_DOCUMENTO = 2000  # tope de seguridad (documentos enormes)
TOP_K = 6


# ---------------------------------------------------------------------------
# 1. Extracción de texto
# ---------------------------------------------------------------------------

def _extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader  # import perezoso: solo se usa al subir PDFs

    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages)


def _extract_docx(data: bytes) -> str:
    # Un .docx es un zip; el texto vive en word/document.xml (<w:p> = párrafo).
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        root = ElementTree.fromstring(zf.read("word/document.xml"))
    paragraphs = ["".join(t.text or "" for t in p.iter(f"{ns}t")) for p in root.iter(f"{ns}p")]
    return "\n\n".join(p for p in paragraphs if p.strip())


def extract_text(filename: str, data: bytes) -> str:
    """Convierte el archivo a texto. Lanza HTTPException 422 si no se puede leer."""
    ext = Path(filename).suffix.lower()
    if ext not in EXTENSIONES_PERMITIDAS:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Tipo de archivo '{ext or 'desconocido'}' no soportado. "
                f"Permitidos: {', '.join(sorted(EXTENSIONES_PERMITIDAS))}."
            ),
        )
    try:
        if ext == ".pdf":
            text = _extract_pdf(data)
        elif ext == ".docx":
            text = _extract_docx(data)
        else:
            text = data.decode("utf-8", errors="replace")
    except Exception as e:
        logger.warning("No se pudo leer %s: %s", filename, e)
        raise HTTPException(status_code=422, detail="No se pudo leer el archivo (¿está dañado o protegido?).") from e

    text = text.replace("\x00", "")  # PostgreSQL rechaza NUL en TEXT
    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="El archivo no contiene texto extraíble (si es un PDF escaneado, súbelo con texto/OCR).",
        )
    return text


# ---------------------------------------------------------------------------
# 2. Fragmentación
# ---------------------------------------------------------------------------

def split_chunks(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Agrupa párrafos hasta ~`size` caracteres; parte los párrafos gigantes con solape."""
    paragraphs = [re.sub(r"[ \t]+", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    pieces: list[str] = []
    for p in paragraphs:
        if not p:
            continue
        if len(p) <= size:
            pieces.append(p)
            continue
        step = size - overlap
        pieces.extend(p[i : i + size] for i in range(0, len(p), step))

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + len(piece) + 2 > size:
            chunks.append(current)
            current = piece
        else:
            current = f"{current}\n\n{piece}" if current else piece
    if current:
        chunks.append(current)
    return chunks[:MAX_CHUNKS_POR_DOCUMENTO]


# ---------------------------------------------------------------------------
# 3. Indexación (se ejecuta dentro de la transacción del router)
# ---------------------------------------------------------------------------

async def index_chunks(
    cur, documento_id: int, empresa_id: int, chunks: list[str], *, embeber: bool = True
) -> None:
    """
    Indexa los fragmentos y, si se puede, sus vectores.

    Se llama dentro de la transacción del POST de subida (D5), así que usa el cursor que
    recibe en vez de abrir una transacción propia.

    Los embeddings son best-effort a propósito: si el proveedor falla, el documento queda
    indexado igual para full-text y el error se registra. Rechazar la subida del usuario
    porque un servicio externo tuvo un mal minuto sería peor que tener un documento que
    se puede encontrar por texto hasta que el backfill lo complete.

    Coste asumido: la llamada de red ocurre con la transacción abierta (una o dos
    peticiones por documento). Con el volumen de esta pantalla es aceptable; si algún día
    la ingesta crece, hay que mover el embedding antes de abrir la transacción.
    """
    await cur.executemany(
        "INSERT INTO documento_chunk (documento_id, empresa_id, orden, contenido) VALUES (%s, %s, %s, %s)",
        [(documento_id, empresa_id, i, c) for i, c in enumerate(chunks)],
    )

    if not embeber or not chunks:
        return

    try:
        vectores = await embed_lote(chunks)
    except Exception as e:  # noqa: BLE001 — un proveedor caído no debe tumbar la ingesta
        logger.warning(
            "Ingesta sin vectores para el documento %s (%s: %s). Queda indexado para "
            "full-text; el backfill lo completará.",
            documento_id,
            type(e).__name__,
            e,
        )
        return

    escritos = await insert_embeddings(
        cur, documento_id, list(zip(range(len(chunks)), chunks, vectores, strict=True))
    )
    logger.info("Documento %s indexado con %d chunks y %d vectores.", documento_id, len(chunks), escritos)


# ---------------------------------------------------------------------------
# 4. Búsqueda (RAG)
# ---------------------------------------------------------------------------

def build_tsquery(*texts: str, max_terms: int = 12) -> str:
    """
    Convierte texto libre en una consulta tsquery con OR entre términos
    ('torque | rodamiento | motor'). Solo se conservan letras/dígitos, por lo que
    el resultado nunca contiene operadores de tsquery inyectados por el usuario.
    """
    seen: dict[str, None] = {}
    for text in texts:
        for token in re.findall(r"[^\W_]{3,}", (text or "").lower()):
            seen.setdefault(token, None)
    return " | ".join(list(seen)[:max_terms])


async def search_chunks_lexical(
    empresa_id: int, *query_texts: str, limit: int = TOP_K
) -> list[dict]:
    """
    Búsqueda full-text (comportamiento previo a la Fase 1).

    Se conserva por dos motivos: es el fallback cuando los embeddings no están
    disponibles, y sigue siendo mejor que nada para coincidencias exactas de siglas o
    códigos («FAG 6308», «CH-01») que un modelo semántico puede diluir.
    """
    tsquery = build_tsquery(*query_texts)
    if not tsquery:
        return []
    return await fetch_all(
        """
        SELECT c.chunk_id, c.documento_id, d.title, c.contenido, ts_rank(c.tsv, q.query) AS rank
        FROM documento_chunk c
        JOIN documento d ON d.documento_id = c.documento_id AND d.activo
        CROSS JOIN to_tsquery('spanish', %(tsquery)s) AS q(query)
        WHERE c.empresa_id = %(empresa_id)s
          AND c.tsv @@ q.query
        ORDER BY rank DESC, c.chunk_id
        LIMIT %(limit)s
        """,
        {"tsquery": tsquery, "empresa_id": empresa_id, "limit": limit},
    )


def format_context(chunks: list[dict]) -> str:
    """Arma el bloque de contexto que se inyecta en el prompt, citando el documento de origen."""
    return "\n\n".join(f"[Documento: {c['title']}]\n{c['contenido']}" for c in chunks)


async def search_chunks_semantic(
    empresa_id: int, *query_texts: str, limit: int = TOP_K
) -> list[dict]:
    """
    Búsqueda vectorial: embebe la consulta y ordena por distancia coseno en pgvector.

    Devuelve el mismo contrato que `search_chunks_lexical` (`chunk_id`, `documento_id`,
    `title`, `contenido`, `rank`), para que `format_context` y el prompt no cambien.
    El `rank` es la similitud (1 - distancia), así que mayor es mejor en ambos caminos.

    Lanza si el proveedor no está configurado o falla: decidir el fallback es de
    `search_chunks`, no de esta función.
    """
    consulta = " ".join(t for t in query_texts if (t or "").strip()).strip()
    if not consulta:
        return []

    vector = await embed_texto(consulta)
    filas = await search_similar_chunks(vector, empresa_id=empresa_id, top_k=limit)
    # `search_similar_chunks` devuelve SIEMPRE los más cercanos, aunque no vengan al caso:
    # sin este filtro, «que hora es» inyectaría un manual. El umbral está medido, no
    # elegido a ojo (ver `rag_min_similarity` en config.py).
    return [
        {
            "chunk_id": None,
            "documento_id": f["documento_id"],
            "title": f["documento"],
            "contenido": f["content"],
            "rank": 1.0 - float(f["distancia"]),
        }
        for f in filas
        if (1.0 - float(f["distancia"])) >= settings.rag_min_similarity
    ]


async def search_chunks(empresa_id: int, *query_texts: str, limit: int = TOP_K) -> list[dict]:
    """
    Fragmentos más relevantes de la empresa: primero semántico, con fallback léxico.

    El fallback cubre tres casos reales: (a) no hay key de embeddings en el entorno,
    (b) el proveedor responde con error o timeout, (c) la tabla `documento_embedding`
    está vacía porque el backfill todavía no se corrió. En los tres, el chat sigue
    funcionando como antes en vez de quedarse sin contexto o romperse.
    """
    if embeddings_disponibles():
        try:
            chunks = await search_chunks_semantic(empresa_id, *query_texts, limit=limit)
        except Exception as e:  # noqa: BLE001 — el proveedor externo no debe tumbar el chat
            logger.warning("RAG: búsqueda semántica falló (%s); se usa full-text.", e)
            return await search_chunks_lexical(empresa_id, *query_texts, limit=limit)
        if chunks:
            logger.info("RAG: %d fragmento(s) por similitud semántica.", len(chunks))
            return chunks
        logger.info("RAG: sin fragmentos sobre el umbral %.2f; se intenta full-text.", settings.rag_min_similarity)
    else:
        logger.info("RAG: sin proveedor de embeddings configurado; búsqueda full-text.")
    return await search_chunks_lexical(empresa_id, *query_texts, limit=limit)
