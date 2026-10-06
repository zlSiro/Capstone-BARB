"""
Gestión de la documentación de cada empresa (fuente única de conocimiento del chat IA).

- Cada documento pertenece a UNA empresa (documento.empresa_id).
- Un usuario de empresa solo lista/sube/edita/elimina documentos de su empresa.
- El super_usuario puede operar sobre cualquier empresa (?empresa_id= / campo del form).
- Al subir un archivo se extrae su texto y se indexa en `documento_chunk`; el chat
  solo consulta documentos con `activo = TRUE`.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from barb.core.config import settings
from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import (
    ROL_SUPER,
    empresa_obligatoria,
    get_sesion_actual,
    require_action,
    require_route,
    resolver_empresa,
)
from barb.services import document_service as docs

logger = logging.getLogger("barb.documents_router")

router = APIRouter()

_DOC_SELECT = """
    SELECT d.documento_id, d.empresa_id, e.nombre AS empresa_nombre, d.title, d.notes, d.original_name,
           d.content_type, d.size_bytes, d.chunks_indexed, d.activo, d.created_at,
           u.nombre AS subido_por
    FROM documento d
    JOIN empresa e ON e.empresa_id = d.empresa_id
    LEFT JOIN usuario u ON u.usuario_id = d.usuario_id
"""


def _serialize(r: dict) -> dict:
    return {
        "id": int(r["documento_id"]),
        "empresa_id": int(r["empresa_id"]),
        "empresa_nombre": r["empresa_nombre"],
        "title": r["title"],
        "notes": r["notes"],
        "original_name": r["original_name"],
        "content_type": r["content_type"],
        "size_bytes": int(r["size_bytes"] or 0),
        "chunks_indexed": int(r["chunks_indexed"] or 0),
        "activo": bool(r["activo"]),
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "subido_por": r["subido_por"],
    }


class DocumentUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = None
    activo: bool | None = None


async def _documento_visible(documento_id: int, sesion: dict) -> dict:
    """Carga el documento; 404 si no existe o es de otra empresa (no se revela su existencia)."""
    row = await fetch_one(_DOC_SELECT + " WHERE d.documento_id = %(id)s", {"id": documento_id})
    if not row or (sesion["rol"] != ROL_SUPER and row["empresa_id"] != sesion["empresa_id"]):
        raise HTTPException(status_code=404, detail="Documento no encontrado.")
    return row


@router.get("/api/documents", dependencies=[Depends(require_route("documentos", solo_lectura=True))])
@router.get("/api/documentos", dependencies=[Depends(require_route("documentos", solo_lectura=True))])
async def list_documents(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    scope = resolver_empresa(sesion, empresa_id)
    rows = await fetch_all(
        _DOC_SELECT
        + " WHERE (%(empresa_id)s::int IS NULL OR d.empresa_id = %(empresa_id)s)"
        + " ORDER BY d.created_at DESC, d.documento_id DESC",
        {"empresa_id": scope},
    )
    return [_serialize(r) for r in rows]


@router.post("/api/documents", status_code=201, dependencies=[Depends(require_action("subir_documentos"))])
@router.post("/api/documentos", status_code=201, dependencies=[Depends(require_action("subir_documentos"))])
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    notes: str = Form(default=""),
    empresa_id: int | None = Form(default=None),  # solo lo respeta el super_usuario
    sesion: dict = Depends(get_sesion_actual),
):
    empresa = empresa_obligatoria(sesion, empresa_id)
    original_name = Path(file.filename or "documento").name  # sin rutas del cliente

    data = await file.read(docs.MAX_BYTES + 1)
    if len(data) > docs.MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"El archivo supera el máximo de {docs.MAX_BYTES // (1024 * 1024)} MB.")
    if not data:
        raise HTTPException(status_code=422, detail="El archivo está vacío.")

    # Extracción/fragmentación son CPU-bound: fuera del event loop.
    text = await asyncio.to_thread(docs.extract_text, original_name, data)
    chunks = await asyncio.to_thread(docs.split_chunks, text)

    existe = await fetch_one("SELECT empresa_id FROM empresa WHERE empresa_id = %(id)s", {"id": empresa})
    if not existe:
        raise HTTPException(status_code=404, detail="La empresa indicada no existe.")

    file_id = uuid.uuid4().hex
    stored_name = f"{file_id}{Path(original_name).suffix.lower()}"
    target_dir = settings.upload_dir / "documentos" / str(empresa)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / stored_name

    try:
        await asyncio.to_thread(target.write_bytes, data)
        async with transaction() as cur:
            await cur.execute(
                """
                INSERT INTO documento (empresa_id, usuario_id, title, notes, original_name, stored_name, file_id,
                                       content_type, size_bytes, chunks_indexed)
                VALUES (%(empresa_id)s, %(usuario_id)s, %(title)s, %(notes)s, %(original_name)s, %(stored_name)s,
                        %(file_id)s, %(content_type)s, %(size)s, %(chunks)s)
                RETURNING documento_id
                """,
                {
                    "empresa_id": empresa,
                    "usuario_id": sesion["usuario_id"],
                    "title": (title or "").strip() or Path(original_name).stem,
                    "notes": (notes or "").strip() or None,
                    "original_name": original_name,
                    "stored_name": stored_name,
                    "file_id": file_id,
                    "content_type": file.content_type,
                    "size": len(data),
                    "chunks": len(chunks),
                },
            )
            documento_id = int((await cur.fetchone())["documento_id"])
            await docs.index_chunks(cur, documento_id, empresa, chunks)
    except Exception as e:
        target.unlink(missing_ok=True)  # no dejar archivos huérfanos si falla la BD
        logger.exception("Error al guardar documento")
        raise HTTPException(status_code=500, detail="Error interno al guardar el documento.") from e

    return _serialize(await fetch_one(_DOC_SELECT + " WHERE d.documento_id = %(id)s", {"id": documento_id}))


@router.patch("/api/documents/{documento_id}", dependencies=[Depends(require_action("subir_documentos"))])
@router.patch("/api/documentos/{documento_id}", dependencies=[Depends(require_action("subir_documentos"))])
async def update_document(documento_id: int, payload: DocumentUpdateRequest, sesion: dict = Depends(get_sesion_actual)):
    await _documento_visible(documento_id, sesion)
    changes = payload.model_dump(exclude_unset=True)
    if changes:
        sets = ", ".join(f"{col} = %({col})s" for col in changes)  # columnas: lista cerrada del modelo
        async with transaction() as cur:
            await cur.execute(f"UPDATE documento SET {sets} WHERE documento_id = %(_id)s", {**changes, "_id": documento_id})
    return _serialize(await fetch_one(_DOC_SELECT + " WHERE d.documento_id = %(id)s", {"id": documento_id}))


@router.delete("/api/documents/{documento_id}", status_code=204, dependencies=[Depends(require_action("eliminar_documentos"))])
@router.delete("/api/documentos/{documento_id}", status_code=204, dependencies=[Depends(require_action("eliminar_documentos"))])
async def delete_document(documento_id: int, sesion: dict = Depends(get_sesion_actual)):
    row = await _documento_visible(documento_id, sesion)
    stored = await fetch_one("SELECT stored_name FROM documento WHERE documento_id = %(id)s", {"id": documento_id})
    async with transaction() as cur:
        # documento_chunk se elimina en cascada.
        await cur.execute("DELETE FROM documento WHERE documento_id = %(id)s", {"id": documento_id})
    if stored:
        path = settings.upload_dir / "documentos" / str(row["empresa_id"]) / stored["stored_name"]
        await asyncio.to_thread(path.unlink, True)
    return None
