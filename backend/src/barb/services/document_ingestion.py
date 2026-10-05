"""Ingesta de documentos para RAG (HU-04) — CGBIDA-238/239.

Extracción de texto de PDFs (pypdf) y chunking (RecursiveCharacterTextSplitter).
Las embeddings y el guardado en pgvector/Supabase llegan con CGBIDA-242;
el diseño completo está en docs/RAG_ARCHITECTURE.md.
"""

from __future__ import annotations

import io

from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from barb.core.config import settings

# Techo defensivo de extracción (~500 páginas de texto denso). Los mensajes de
# ValueError son aptos para el cliente: los endpoints (CGBIDA-234) los mapean
# directamente a respuestas 400/422.
_MAX_EXTRACTION_CHARS = 2_000_000


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extrae el texto de un PDF en memoria (CGBIDA-238).

    Raises:
        ValueError: PDF inválido/corrupto, protegido con contraseña, sin texto
            extraíble (escaneado) o que excede el límite de extracción.
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as e:  # pypdf puede lanzar varias clases según el daño del archivo
        raise ValueError("El archivo no es un PDF válido o está corrupto.") from e

    if reader.is_encrypted:
        raise ValueError("El PDF está protegido con contraseña.")

    pages: list[str] = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")

    text = "\n".join(pages).strip()

    if not text:
        raise ValueError("El PDF no contiene texto extraíble (¿es un documento escaneado?).")
    if len(text) > _MAX_EXTRACTION_CHARS:
        raise ValueError(
            f"El PDF excede el límite de extracción de {_MAX_EXTRACTION_CHARS} caracteres."
        )
    return text


def chunk_text(text: str) -> list[str]:
    """Divide el texto en chunks para indexar (CGBIDA-239, D4 del diseño)."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.rag_chunk_size,
        chunk_overlap=settings.rag_chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return splitter.split_text(text)
