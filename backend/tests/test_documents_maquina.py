"""HU-23 (spec 02, paso 2): documentos ligados opcionalmente a una máquina del catálogo de la empresa."""

from __future__ import annotations

import io
import uuid

from barb.core.db import fetch_one

ENGINEER_E1 = ("engineer1@planta.com", "engineer123")
ADMIN_E2 = ("admin@mineranorte.cl", "minera123")


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _maquina_id(client, headers) -> int:
    r = await client.get("/api/machines", headers=headers)
    assert r.status_code == 200 and r.json()
    return int(r.json()[0]["id"])


async def _subir(client, headers, **data):
    contenido = f"Documento de prueba {uuid.uuid4().hex}".encode()
    return await client.post(
        "/api/documents",
        headers=headers,
        data={"title": "Doc maquina test", **{k: str(v) for k, v in data.items() if v is not None}},
        files={"file": ("m.txt", io.BytesIO(contenido), "text/plain")},
    )


async def _borrar(client, headers, doc_id) -> None:
    await client.delete(f"/api/documents/{doc_id}", headers=headers)


async def _contar_docs(titulo: str) -> int:
    row = await fetch_one("SELECT COUNT(*) AS n FROM documento WHERE title = %(t)s", {"t": titulo})
    return int(row["n"])


async def test_subir_documento_con_maquina_propia_lo_guarda_y_lo_lista(client):
    h = await _login(client, ENGINEER_E1)
    mid = await _maquina_id(client, h)
    r = await _subir(client, h, maquina_id=mid)
    assert r.status_code == 201, r.text
    doc = r.json()
    try:
        assert doc["maquina_id"] == mid
        assert doc["maquina_nombre"] and doc["maquina_codigo"]
        listado = (await client.get("/api/documents", headers=h)).json()
        assert next(d for d in listado if d["id"] == doc["id"])["maquina_id"] == mid
    finally:
        await _borrar(client, h, doc["id"])


async def test_subir_documento_sin_maquina_sigue_funcionando(client):
    h = await _login(client, ENGINEER_E1)
    r = await _subir(client, h)
    assert r.status_code == 201, r.text
    try:
        assert r.json()["maquina_id"] is None
        assert r.json()["maquina_nombre"] is None
    finally:
        await _borrar(client, h, r.json()["id"])


async def test_subir_documento_con_maquina_de_otra_empresa_da_404_y_no_guarda_nada(client):
    h1, h2 = await _login(client, ENGINEER_E1), await _login(client, ADMIN_E2)
    mid_otra = await _maquina_id(client, h2)
    antes = await _contar_docs("Doc maquina test")
    r = await _subir(client, h1, maquina_id=mid_otra)
    assert r.status_code == 404
    assert await _contar_docs("Doc maquina test") == antes


async def test_subir_documento_con_maquina_inexistente_da_404(client):
    h = await _login(client, ENGINEER_E1)
    assert (await _subir(client, h, maquina_id=2_000_000_000)).status_code == 404


async def test_editar_documento_asigna_cambia_y_desvincula_maquina(client):
    h = await _login(client, ENGINEER_E1)
    mid = await _maquina_id(client, h)
    doc = (await _subir(client, h)).json()
    try:
        r = await client.patch(f"/api/documents/{doc['id']}", headers=h, json={"maquina_id": mid})
        assert r.status_code == 200 and r.json()["maquina_id"] == mid
        # Ausente = conserva
        r = await client.patch(f"/api/documents/{doc['id']}", headers=h, json={"notes": "x"})
        assert r.status_code == 200 and r.json()["maquina_id"] == mid
        # null = desvincula
        r = await client.patch(f"/api/documents/{doc['id']}", headers=h, json={"maquina_id": None})
        assert r.status_code == 200 and r.json()["maquina_id"] is None
    finally:
        await _borrar(client, h, doc["id"])


async def test_editar_documento_con_maquina_de_otra_empresa_da_404_y_no_modifica(client):
    h1, h2 = await _login(client, ENGINEER_E1), await _login(client, ADMIN_E2)
    mid_otra = await _maquina_id(client, h2)
    doc = (await _subir(client, h1)).json()
    try:
        r = await client.patch(
            f"/api/documents/{doc['id']}", headers=h1, json={"maquina_id": mid_otra, "notes": "no debe guardarse"}
        )
        assert r.status_code == 404
        listado = (await client.get("/api/documents", headers=h1)).json()
        actual = next(d for d in listado if d["id"] == doc["id"])
        assert actual["maquina_id"] is None and actual["notes"] != "no debe guardarse"
    finally:
        await _borrar(client, h1, doc["id"])
