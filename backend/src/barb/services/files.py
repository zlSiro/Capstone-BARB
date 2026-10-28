from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path

import anyio
from fastapi import HTTPException, UploadFile

from barb.core.db import fetch_all, transaction

logger = logging.getLogger("barb.files")

ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def is_valid_image(content: bytes, content_type: str) -> bool:
    """
    La imagen declarada coincide con su contenido (firma del archivo). El `Content-Type` lo manda el cliente: sin esta
    comprobación se podría subir cualquier cosa etiquetada como imagen.
    """
    content_type = (content_type or "").strip().lower()
    if content_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return False


async def store_upload_file(file: UploadFile, destination_dir: Path, prefix: str) -> dict:
    original_name = Path(file.filename or "file").name
    suffix = Path(original_name).suffix.lower() or ".bin"
    file_id = uuid.uuid4().hex
    stored_name = f"{prefix}_{file_id}{suffix}"
    stored_path = destination_dir / stored_name

    content = await file.read()

    def _write() -> None:
        with stored_path.open("wb") as buffer:
            buffer.write(content)

    await anyio.to_thread.run_sync(_write)

    return {
        "file_id": file_id,
        "stored_name": stored_name,
        "stored_path": stored_path,
        "original_name": original_name,
    }


async def save_ot_photos(numero_ot: str, ot_id: int, images: list[UploadFile], upload_dir: Path) -> list[dict]:
    saved_photos: list[dict] = []
    if not images:
        return saved_photos

    ot_dir = upload_dir / "work-orders" / numero_ot
    ot_dir.mkdir(parents=True, exist_ok=True)

    try:
        async with transaction() as cur:
            for image in images:
                content_type = (image.content_type or "").strip().lower()
                if content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
                    raise HTTPException(status_code=415, detail="Solo se permiten imágenes JPEG, PNG o WEBP.")

                stored = await store_upload_file(image, ot_dir, "ot")
                await cur.execute(
                    """
                    INSERT INTO ot_foto (ot_id, file_name, original_name, content_type, file_path)
                    VALUES (%(ot_id)s, %(file_name)s, %(original_name)s, %(content_type)s, %(file_path)s)
                    RETURNING ot_foto_id, created_at
                    """,
                    {
                        "ot_id": ot_id,
                        "file_name": stored["stored_name"],
                        "original_name": stored["original_name"],
                        "content_type": content_type,
                        "file_path": str(stored["stored_path"]),
                    },
                )
                row = await cur.fetchone()
                saved_photos.append({
                    "id": int(row["ot_foto_id"]),
                    "ot_id": ot_id,
                    "file_name": stored["stored_name"],
                    "original_name": stored["original_name"],
                    "content_type": content_type,
                    "file_path": str(stored["stored_path"]),
                    "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
                })
    except Exception:
        for photo in saved_photos:
            try:
                Path(photo["file_path"]).unlink(missing_ok=True)
            except Exception:
                pass
        raise

    return saved_photos


async def attach_existing_photo_to_ot(
    numero_ot: str, ot_id: int, source: Path, original_name: str, content_type: str, upload_dir: Path
) -> dict | None:
    """
    Copia una foto ya guardada (la de un aviso de falla) a la carpeta de la OT y la registra en `ot_foto`, para que la OT
    nazca con la evidencia que reportó la planta. Devuelve la foto registrada, o None si el archivo de origen ya no existe.
    """
    if not source.is_file():
        logger.warning("La foto del aviso ya no está en disco (%s); la OT %s se crea sin ella.", source, numero_ot)
        return None

    ot_dir = upload_dir / "work-orders" / numero_ot
    ot_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"ot_{uuid.uuid4().hex}{source.suffix.lower() or '.bin'}"
    destination = ot_dir / stored_name
    await anyio.to_thread.run_sync(shutil.copyfile, source, destination)

    try:
        async with transaction() as cur:
            await cur.execute(
                """
                INSERT INTO ot_foto (ot_id, file_name, original_name, content_type, file_path)
                VALUES (%(ot_id)s, %(file_name)s, %(original_name)s, %(content_type)s, %(file_path)s)
                RETURNING ot_foto_id
                """,
                {
                    "ot_id": ot_id,
                    "file_name": stored_name,
                    "original_name": original_name,
                    "content_type": content_type,
                    "file_path": str(destination),
                },
            )
            row = await cur.fetchone()
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return {"id": int(row["ot_foto_id"]), "file_name": stored_name, "file_path": str(destination)}


async def delete_ot_files(ot_id: int, upload_dir: Path) -> None:
    rows = await fetch_all(
        "SELECT file_path FROM ot_foto WHERE ot_id = %(ot_id)s",
        {"ot_id": ot_id},
    )
    for row in rows:
        path = row.get("file_path")
        if not path:
            continue
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:
            continue

    ot_dir = upload_dir / "work-orders"
    if ot_dir.exists():
        for child in ot_dir.iterdir():
            if child.is_dir() and not any(child.iterdir()):
                try:
                    child.rmdir()
                except Exception:
                    pass
