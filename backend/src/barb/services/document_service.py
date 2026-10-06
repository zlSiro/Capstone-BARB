"""
Documentación por empresa para el chat IA (RAG).

Flujo:
  1. `extract_text`  : archivo subido -> texto plano (pdf, docx, txt, md, csv, json, log).
  2. `split_chunks`  : texto -> fragmentos de ~1000 caracteres con solape.
  3. `index_document`: guarda los fragmentos en `documento_chunk` (con tsvector generado).
  4. `search_chunks` : dado un mensaje del usuario, devuelve los fragmentos más
                       relevantes de LA EMPRESA indicada (full-text search 'spanish').

El aislamiento es estricto: `search_chunks` exige `empresa_id` y filtra por él en
SQL, de modo que la IA jamás recibe texto de otra empresa. Solo se consideran
documentos con `activo = TRUE`.
"""

from __future__ import annotations

import io
import logging
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from fastapi import HTTPException

from barb.core.db import fetch_all

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

async def index_chunks(cur, documento_id: int, empresa_id: int, chunks: list[str]) -> None:
    await cur.executemany(
        "INSERT INTO documento_chunk (documento_id, empresa_id, orden, contenido) VALUES (%s, %s, %s, %s)",
        [(documento_id, empresa_id, i, c) for i, c in enumerate(chunks)],
    )


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


async def search_chunks(empresa_id: int, *query_texts: str, limit: int = TOP_K) -> list[dict]:
    """Fragmentos más relevantes de documentos ACTIVOS de la empresa, ordenados por ranking."""
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
