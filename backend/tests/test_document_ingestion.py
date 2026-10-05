"""Tests unitarios de la ingesta de documentos (CGBIDA-238/239).

No requieren BD: operan sobre PDFs generados en memoria (pypdf) y texto
sintético. La extracción de un manual real se valida en la verificación
end-to-end (CGBIDA-251).
"""

from __future__ import annotations

import io

import pytest
from pypdf import PdfWriter

from barb.core.config import settings
from barb.services.document_ingestion import chunk_text, extract_pdf_text


def _pdf_en_blanco(paginas: int = 1) -> bytes:
    """PDF válido pero sin texto (simula un documento escaneado)."""
    writer = PdfWriter()
    for _ in range(paginas):
        writer.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# CGBIDA-238: extracción de texto
# ---------------------------------------------------------------------------


def test_extract_rechaza_bytes_que_no_son_pdf() -> None:
    with pytest.raises(ValueError, match="no es un PDF válido"):
        extract_pdf_text(b"esto claramente no es un pdf")


def test_extract_rechaza_pdf_truncado() -> None:
    # Empieza con la firma de PDF pero el contenido está cortado.
    with pytest.raises(ValueError, match="no es un PDF válido|corrupto"):
        extract_pdf_text(b"%PDF-1.7\n%corrupto\n")


def test_extract_rechaza_pdf_sin_texto_extraible() -> None:
    # Un PDF válido de páginas en blanco se lee bien, pero no tiene texto:
    # equivale a un manual escaneado como imagen.
    with pytest.raises(ValueError, match="no contiene texto extraíble"):
        extract_pdf_text(_pdf_en_blanco(paginas=2))


# ---------------------------------------------------------------------------
# CGBIDA-239: chunking
# ---------------------------------------------------------------------------


def test_chunk_texto_corto_queda_en_un_chunk() -> None:
    texto = "Manual de mantenimiento preventivo de la celda A-3."
    chunks = chunk_text(texto)
    assert chunks == [texto]


def test_chunk_texto_largo_genera_chunks_dentro_del_limite() -> None:
    parrafo = (
        "La celda robotizada A-3 requiere engrasado de la torreta cada 500 horas. "
        "Verificar el nivel de aceite del reductor antes de cada turno. "
    )
    texto = parrafo * 80  # ~7 000 caracteres

    chunks = chunk_text(texto)

    assert len(chunks) > 1, "un texto largo debe dividirse en varios chunks"
    for chunk in chunks:
        # El splitter respeta chunk_size salvo tokens indivisibles; margen holgado.
        assert len(chunk) <= settings.rag_chunk_size + 50
    # El contenido completo queda cubierto (el overlap hace que los chunks
    # sumen más que el texto original, nunca menos).
    assert sum(len(c) for c in chunks) >= len(texto)
