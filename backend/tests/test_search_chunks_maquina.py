"""HU-23 (spec 02, paso 3): `search_chunks(..., maquina_id=)` — máquina primero + relleno con docs generales.

Integración contra Postgres (como `test_document_repository.py`). El proveedor de embeddings se simula: la
consulta se vectoriza como `_vec(1.0)` y todos los chunks de prueba usan ese mismo vector (similitud 1), así que
el orden dentro de cada pasada no importa; lo que se verifica es la composición (propios primero, relleno
después, nunca de otra empresa).
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from barb.core.db import execute, fetch_all, transaction
from barb.services import document_repository as repo
from barb.services import document_service as docs
from barb.services.document_repository import EMBEDDING_DIM

EMPRESA_1 = 1
EMPRESA_2 = 2


def _vec(valor: float) -> list[float]:
    return [valor] * EMBEDDING_DIM


@pytest_asyncio.fixture
async def creados(db_pool):
    ids: list[int] = []
    yield ids
    for did in ids:
        await execute("DELETE FROM documento WHERE documento_id = %(id)s", {"id": did})


async def _maquinas_de(empresa_id: int, n: int) -> list[int]:
    rows = await fetch_all(
        "SELECT m.maquina_id FROM maquina m JOIN planta p ON p.planta_id = m.planta_id"
        " WHERE p.empresa_id = %(e)s ORDER BY m.maquina_id LIMIT %(n)s",
        {"e": empresa_id, "n": n},
    )
    assert len(rows) >= n
    return [int(r["maquina_id"]) for r in rows]


async def _doc(creados, title, empresa_id=EMPRESA_1, maquina_id=None, *, vector=True, texto=None) -> int:
    did = await repo.create_documento(
        empresa_id=empresa_id,
        title=title,
        original_name=f"{title}.txt",
        stored_name=f"{title}.bin",
        file_id=f"file-{uuid.uuid4().hex}",
        maquina_id=maquina_id,
    )
    creados.append(did)
    if vector:
        await repo.set_chunks(did, [(0, texto or f"chunk 0 de {title}", _vec(1.0))])
    else:
        async with transaction() as cur:
            await docs.index_chunks(cur, did, empresa_id, [texto or f"chunk 0 de {title}"], embeber=False)
    return did


@pytest.fixture
def embeddings_simulados(monkeypatch):
    llamadas = {"embed": 0}

    async def embed(_texto):
        llamadas["embed"] += 1
        return _vec(1.0)

    monkeypatch.setattr(docs, "embeddings_disponibles", lambda: True)
    monkeypatch.setattr(docs, "embed_texto", embed)
    return llamadas


async def test_docs_de_la_maquina_salen_primero_y_se_completa_con_generales(creados, embeddings_simulados):
    mid = (await _maquinas_de(EMPRESA_1, 1))[0]
    propio = await _doc(creados, f"Manual propio {uuid.uuid4().hex[:6]}", maquina_id=mid)
    for i in range(3):
        await _doc(creados, f"General {i} {uuid.uuid4().hex[:6]}")

    r = await docs.search_chunks(EMPRESA_1, "consulta", limit=3, maquina_id=mid)

    assert len(r) == 3
    assert r[0]["documento_id"] == propio and r[0]["de_maquina"] is True
    assert all(c["de_maquina"] is False for c in r[1:])
    assert propio not in [c["documento_id"] for c in r[1:]]  # sin repetir


async def test_maquina_sin_docs_propios_se_completa_con_generales(creados, embeddings_simulados):
    mid = (await _maquinas_de(EMPRESA_1, 1))[0]
    for i in range(3):
        await _doc(creados, f"General {i} {uuid.uuid4().hex[:6]}")

    r = await docs.search_chunks(EMPRESA_1, "consulta", limit=3, maquina_id=mid)

    assert len(r) == 3
    assert all(c["de_maquina"] is False for c in r)


async def test_doc_de_otra_maquina_no_cuenta_como_propio(creados, embeddings_simulados):
    m1, m2 = await _maquinas_de(EMPRESA_1, 2)
    ajena = await _doc(creados, f"De otra maquina {uuid.uuid4().hex[:6]}", maquina_id=m2)

    r = await docs.search_chunks(EMPRESA_1, "consulta", limit=6, maquina_id=m1)

    esta = [c for c in r if c["documento_id"] == ajena]
    assert esta and esta[0]["de_maquina"] is False  # entra solo como relleno


async def test_nunca_cruza_de_empresa(creados, embeddings_simulados):
    mid = (await _maquinas_de(EMPRESA_1, 1))[0]
    ajeno = await _doc(creados, f"Doc empresa 2 {uuid.uuid4().hex[:6]}", empresa_id=EMPRESA_2)

    r = await docs.search_chunks(EMPRESA_1, "consulta", limit=50, maquina_id=mid)

    assert ajeno not in [c["documento_id"] for c in r]


async def test_embebe_la_consulta_una_sola_vez_con_dos_pasadas(creados, embeddings_simulados):
    mid = (await _maquinas_de(EMPRESA_1, 1))[0]
    await _doc(creados, f"Manual propio {uuid.uuid4().hex[:6]}", maquina_id=mid)
    await _doc(creados, f"General {uuid.uuid4().hex[:6]}")

    await docs.search_chunks(EMPRESA_1, "consulta", limit=3, maquina_id=mid)

    assert embeddings_simulados["embed"] == 1


async def test_sin_maquina_no_agrega_de_maquina(creados, embeddings_simulados):
    await _doc(creados, f"General {uuid.uuid4().hex[:6]}")

    r = await docs.search_chunks(EMPRESA_1, "consulta", limit=3)

    assert r and all("de_maquina" not in c for c in r)


async def test_camino_lexico_respeta_la_prioridad_de_la_maquina(creados, monkeypatch):
    monkeypatch.setattr(docs, "embeddings_disponibles", lambda: False)
    mid = (await _maquinas_de(EMPRESA_1, 1))[0]
    clave = f"zorbulonium{uuid.uuid4().hex[:8]}"
    propio = await _doc(creados, "Propio", maquina_id=mid, vector=False, texto=f"procedimiento {clave} propio")
    general = await _doc(creados, "General", vector=False, texto=f"procedimiento {clave} general")
    ajeno = await _doc(creados, "Ajeno", empresa_id=EMPRESA_2, vector=False, texto=f"procedimiento {clave} ajeno")

    r = await docs.search_chunks(EMPRESA_1, clave, limit=3, maquina_id=mid)

    assert [c["documento_id"] for c in r] == [propio, general]
    assert [c["de_maquina"] for c in r] == [True, False]
    assert ajeno not in [c["documento_id"] for c in r]


async def test_si_falla_el_embedding_cae_a_lexico_con_maquina(creados, monkeypatch):
    async def falla(_t):
        raise RuntimeError("proveedor caído")

    monkeypatch.setattr(docs, "embeddings_disponibles", lambda: True)
    monkeypatch.setattr(docs, "embed_texto", falla)
    mid = (await _maquinas_de(EMPRESA_1, 1))[0]
    clave = f"zorbulonium{uuid.uuid4().hex[:8]}"
    propio = await _doc(creados, "Propio", maquina_id=mid, vector=False, texto=f"procedimiento {clave} propio")

    r = await docs.search_chunks(EMPRESA_1, clave, limit=3, maquina_id=mid)

    assert [c["documento_id"] for c in r] == [propio]
    assert r[0]["de_maquina"] is True


async def test_repositorio_filtra_por_maquina(creados):
    m1, m2 = await _maquinas_de(EMPRESA_1, 2)
    d1 = await _doc(creados, f"Rep m1 {uuid.uuid4().hex[:6]}", maquina_id=m1)
    d2 = await _doc(creados, f"Rep m2 {uuid.uuid4().hex[:6]}", maquina_id=m2)

    r = await repo.search_similar_chunks(_vec(1.0), empresa_id=EMPRESA_1, top_k=50, maquina_id=m1)
    ids = [x["documento_id"] for x in r]
    assert d1 in ids and d2 not in ids

    sin_filtro = [x["documento_id"] for x in await repo.search_similar_chunks(_vec(1.0), EMPRESA_1, top_k=50)]
    assert d1 in sin_filtro and d2 in sin_filtro

