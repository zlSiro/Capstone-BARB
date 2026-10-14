# backend/src/barb/services/document_storage.py
"""
Almacenamiento de los archivos de documentación (HU-04 — CGBIDA-233).

Guarda los archivos subidos en **Supabase Storage** (bucket privado, ver
docs/RAG_ARCHITECTURE.md D3) para que sobrevivan a los redeploys de Render.
Si Supabase no está configurado (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`),
degrada a disco local (`./uploads/documentos/...`) — el flujo sigue
funcionando en desarrollo sin credenciales (patrón tolerante a fallos).

Layout (idéntico en ambos backends): `documentos/{empresa_id}/{stored_name}`.
La ruta se reconstruye desde `documento.empresa_id` + `stored_name`; no hace
falta columna adicional.
"""

from __future__ import annotations

import logging
from pathlib import Path

import httpx

from barb.core.config import settings

logger = logging.getLogger("barb.document_storage")

_STORAGE_TIMEOUT = 30.0


class StorageError(RuntimeError):
    """Fallo al leer/escribir el almacenamiento externo."""


def _object_path(empresa_id: int, stored_name: str) -> str:
    return f"documentos/{empresa_id}/{stored_name}"


def _disk_path(empresa_id: int, stored_name: str) -> Path:
    return settings.upload_dir / "documentos" / str(empresa_id) / stored_name


# ---------------------------------------------------------------------------
# Supabase Storage (API REST con service_role — server-to-server)
# ---------------------------------------------------------------------------


async def _supabase_request(method: str, object_path: str, *, content: bytes | None = None,
                            content_type: str | None = None) -> httpx.Response:
    """Llama al Storage API de Supabase con la service_role key."""
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{settings.supabase_bucket}/{object_path}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if content is not None:
        headers["x-upsert"] = "true"  # permitir reemplazo del mismo file_id (re-subida)

    async with httpx.AsyncClient(timeout=_STORAGE_TIMEOUT) as client:
        return await client.request(method, url, headers=headers, content=content)


async def _save_to_supabase(empresa_id: int, stored_name: str, data: bytes, content_type: str | None) -> None:
    resp = await _supabase_request(
        "POST", _object_path(empresa_id, stored_name), content=data, content_type=content_type
    )
    if resp.status_code >= 400:
        # 404 en el POST normalmente significa que el bucket no existe.
        raise StorageError(
            f"Supabase Storage rechazó el archivo (HTTP {resp.status_code}). "
            "Verifica que el bucket '"
            + settings.supabase_bucket
            + "' exista en el panel de Supabase."
        )


async def _delete_from_supabase(empresa_id: int, stored_name: str) -> None:
    resp = await _supabase_request("DELETE", _object_path(empresa_id, stored_name))
    # 404 ("Object not found") es aceptable: no debe fallar el borrado del
    # documento si el archivo ya no está (p. ej. tras un redeploy con disco).
    if resp.status_code >= 400 and resp.status_code != 404:
        raise StorageError(f"Supabase Storage no pudo eliminar el archivo (HTTP {resp.status_code}).")


# ---------------------------------------------------------------------------
# Disco local (fallback sin credenciales — desarrollo)
# ---------------------------------------------------------------------------


async def _save_to_disk(empresa_id: int, stored_name: str, data: bytes) -> None:
    import asyncio

    target = _disk_path(empresa_id, stored_name)
    target.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(target.write_bytes, data)


async def _delete_from_disk(empresa_id: int, stored_name: str) -> None:
    import asyncio

    await asyncio.to_thread(_disk_path(empresa_id, stored_name).unlink, True)


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------


async def save_document_file(
    empresa_id: int,
    stored_name: str,
    data: bytes,
    content_type: str | None = None,
) -> None:
    """Guarda el archivo del documento en el backend activo.

    Storage configurado → Supabase Storage (persistente en producción).
    Sin configurar → disco local (desarrollo), con warning en el log.
    """
    if settings.storage_configurado:
        await _save_to_supabase(empresa_id, stored_name, data, content_type)
    else:
        logger.warning(
            "SUPABASE_URL/SERVICE_ROLE_KEY sin configurar: guardando en disco local "
            "(efímero en Render). Documento empresa=%s archivo=%s",
            empresa_id, stored_name,
        )
        await _save_to_disk(empresa_id, stored_name, data)


async def delete_document_file(empresa_id: int, stored_name: str) -> None:
    """Elimina el archivo del documento; tolerante si ya no existe."""
    if settings.storage_configurado:
        await _delete_from_supabase(empresa_id, stored_name)
    else:
        await _delete_from_disk(empresa_id, stored_name)
