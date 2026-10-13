"""Tests del almacenamiento de documentos (CGBIDA-233).

Unitarios con mocks para la API REST de Supabase (sin red) y con tmp_path
para el fallback a disco. La E2E real contra Supabase se hace al configurar
las credenciales en el .env (ver PR).
"""

from __future__ import annotations

import httpx
import pytest
import pytest_asyncio

from barb.core.config import settings
from barb.services import document_storage as storage
from barb.services.document_storage import StorageError, delete_document_file, save_document_file


@pytest_asyncio.fixture
async def sin_supabase(monkeypatch, tmp_path):
    """Fuerza el fallback a disco apuntando upload_dir a un directorio temporal."""
    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_service_role_key", "")
    return tmp_path


@pytest_asyncio.fixture
async def con_supabase_falso(monkeypatch):
    """Configura credenciales fake y captura las llamadas a la API REST."""
    llamadas: list[dict] = []

    async def _fake_request(method, object_path, *, content=None, content_type=None):
        llamadas.append(
            {"method": method, "path": object_path, "content": content, "content_type": content_type}
        )
        return httpx.Response(200)

    monkeypatch.setattr(settings, "supabase_url", "https://fake.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_role_key", "fake-service-role")
    monkeypatch.setattr(storage, "_supabase_request", _fake_request)
    return llamadas


# =============================================================================
# Fallback a disco (desarrollo sin credenciales)
# =============================================================================


@pytest.mark.asyncio
async def test_save_sin_config_guarda_en_disco(sin_supabase):
    await save_document_file(1, "abc123.pdf", b"contenido-pdf", content_type="application/pdf")
    archivo = sin_supabase / "documentos" / "1" / "abc123.pdf"
    assert archivo.read_bytes() == b"contenido-pdf"


@pytest.mark.asyncio
async def test_delete_sin_config_borra_el_archivo(sin_supabase):
    await save_document_file(2, "xyz.pdf", b"data")
    await delete_document_file(2, "xyz.pdf")
    assert not (sin_supabase / "documentos" / "2" / "xyz.pdf").exists()


@pytest.mark.asyncio
async def test_delete_disco_tolerante_si_no_existe(sin_supabase):
    await delete_document_file(3, "nunca-subido.pdf")  # no debe lanzar


# =============================================================================
# Supabase Storage configurado
# =============================================================================


@pytest.mark.asyncio
async def test_save_con_config_sube_a_supabase(con_supabase_falso):
    await save_document_file(5, "doc.txt", b"hola", content_type="text/plain")

    assert len(con_supabase_falso) == 1
    llamada = con_supabase_falso[0]
    assert llamada["method"] == "POST"
    assert llamada["path"] == "documentos/5/doc.txt", "layout: documentos/{empresa}/{stored_name}"
    assert llamada["content"] == b"hola"


@pytest.mark.asyncio
async def test_delete_con_config_llama_a_supabase(con_supabase_falso):
    await delete_document_file(5, "doc.txt")

    assert con_supabase_falso[0]["method"] == "DELETE"
    assert con_supabase_falso[0]["path"] == "documentos/5/doc.txt"


@pytest.mark.asyncio
async def test_save_supabase_error_lanza_storage_error(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://fake.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_role_key", "fake")
    monkeypatch.setattr(storage, "_supabase_request", _respuesta_http(404))

    with pytest.raises(StorageError, match="bucket"):
        await save_document_file(1, "doc.pdf", b"x")


@pytest.mark.asyncio
async def test_delete_supabase_404_es_tolerado(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://fake.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_role_key", "fake")
    monkeypatch.setattr(storage, "_supabase_request", _respuesta_http(404))

    await delete_document_file(1, "ya-no-existe.pdf")  # no debe lanzar


@pytest.mark.asyncio
async def test_delete_supabase_500_lanza_storage_error(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://fake.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_role_key", "fake")
    monkeypatch.setattr(storage, "_supabase_request", _respuesta_http(500))

    with pytest.raises(StorageError, match="HTTP 500"):
        await delete_document_file(1, "doc.pdf")


def _respuesta_http(status: int):
    async def _fake_request(method, object_path, *, content=None, content_type=None):
        return httpx.Response(status)
    return _fake_request
