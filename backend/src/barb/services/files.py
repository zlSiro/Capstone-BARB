from __future__ import annotations

import uuid
from pathlib import Path

import anyio
from fastapi import HTTPException, UploadFile

from barb.core.db import fetch_all, transaction

ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


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
