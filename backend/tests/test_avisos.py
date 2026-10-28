"""
Avisos de falla: del reporte en planta a la decisión del supervisor (GET/POST /api/avisos).

Los avisos viven en la tabla `aviso_falla` (migración 0012) y la OT que originan guarda su id en `orden_trabajo.aviso_falla_id`.
Cada prueba crea sus avisos con un marcador en la descripción y los elimina al terminar (primero las OT
generadas, que referencian al aviso, y luego los avisos). Requiere la BD migrada (hasta 0012) y sembrada.
"""

from __future__ import annotations

import re

import pytest

from barb.core.db import execute, fetch_one

MARCA = "Test AVISOS"

OPERADOR = {"email": "operador1@planta.com", "password": "operador123"}
OPERADOR_2 = {"email": "operador2@planta.com", "password": "operador123"}
TECNICO = {"email": "carlos@planta.com", "password": "tecnico123"}
TECNICO_AJENO = {"email": "ana@planta.com", "password": "tecnico123"}
SUPERVISOR = {"email": "supervisor1@planta.com", "password": "super123"}
ENGINEER = {"email": "engineer1@planta.com", "password": "engineer123"}
GERENTE = {"email": "gerente1@planta.com", "password": "gerente123"}
ADMIN = {"email": "admin@barb.com", "password": "admin123"}
VISITANTE = {"email": "visitante@planta.com", "password": "visitante123"}
SUPER = {"email": "super@barb.com", "password": "super123"}
GERENTE_E2 = {"email": "gerente@mineranorte.cl", "password": "minera123"}


async def _login(client, creds: dict) -> dict:
    resp = await client.post("/api/auth/login", json=creds)
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


async def _usuario_id(email: str) -> int:
    return int((await fetch_one("SELECT usuario_id FROM usuario WHERE email = %(e)s", {"e": email}))["usuario_id"])


@pytest.fixture
async def limpieza(db_pool):
    yield
    # Las OT generadas heredan la descripción del aviso y lo referencian: se borran primero.
    await execute("DELETE FROM orden_trabajo WHERE descripcion_problema LIKE %(p)s", {"p": f"{MARCA}%"})
    await execute("DELETE FROM aviso_falla WHERE descripcion LIKE %(p)s", {"p": f"{MARCA}%"})


@pytest.fixture
async def maquina_id(db_pool) -> int:
    return int((await fetch_one("SELECT maquina_id FROM maquina ORDER BY maquina_id LIMIT 1"))["maquina_id"])


async def _reportar(client, creds, maquina_id, texto="vibración anormal", **extra) -> dict:
    resp = await client.post(
        "/api/avisos",
        json={"maquina_id": maquina_id, "descripcion": f"{MARCA}: {texto}", **extra},
        headers=await _login(client, creds),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# --- Reportar ---------------------------------------------------------------

async def test_el_operador_reporta_una_falla_y_queda_pendiente(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id, severidad="high")
    assert re.fullmatch(r"AV-\d{4}-\d{4,}", aviso["numero_aviso"])
    assert aviso["estado"] == "pendiente" and aviso["status"] == "Pendiente"
    assert aviso["severidad"] == "high"
    assert aviso["reportado_por"]["rol"] == "operador"
    assert aviso["numero_ot"] is None and aviso["resuelto_por"] is None and aviso["motivo_descarte"] is None
    assert aviso["machine_name"] and aviso["plant_name"]


@pytest.mark.parametrize("creds", [OPERADOR, TECNICO, SUPERVISOR, ENGINEER, GERENTE])
async def test_pueden_reportar_quienes_trabajan_en_planta(client, maquina_id, limpieza, creds):
    assert (await _reportar(client, creds, maquina_id))["estado"] == "pendiente"


@pytest.mark.parametrize("creds", [ADMIN, SUPER, VISITANTE])
async def test_admin_super_y_visitante_no_reportan(client, maquina_id, creds):
    resp = await client.post(
        "/api/avisos", json={"maquina_id": maquina_id, "descripcion": f"{MARCA}: x"}, headers=await _login(client, creds)
    )
    assert resp.status_code == 403


async def test_validaciones_al_reportar(client, maquina_id):
    h = await _login(client, OPERADOR)
    base = {"maquina_id": maquina_id, "descripcion": f"{MARCA}: x"}
    assert (await client.post("/api/avisos", json={**base, "descripcion": "   "}, headers=h)).status_code == 422
    assert (await client.post("/api/avisos", json={**base, "descripcion": "x" * 5001}, headers=h)).status_code == 422
    assert (await client.post("/api/avisos", json={**base, "severidad": "grave"}, headers=h)).status_code == 422
    assert (await client.post("/api/avisos", json={**base, "maquina_id": 999999}, headers=h)).status_code == 422
    assert (await client.post("/api/avisos", json=base)).status_code == 422  # sin Authorization


async def test_no_se_reporta_sobre_una_maquina_de_otra_empresa(client, limpieza):
    otra = await fetch_one(
        "SELECT m.maquina_id FROM maquina m JOIN planta p ON p.planta_id = m.planta_id WHERE p.empresa_id = 2 LIMIT 1"
    )
    resp = await client.post(
        "/api/avisos",
        json={"maquina_id": otra["maquina_id"], "descripcion": f"{MARCA}: cruce"},
        headers=await _login(client, OPERADOR),  # operador de la empresa 1
    )
    assert resp.status_code == 422


# --- Repositorio: quién ve qué ----------------------------------------------

async def _ids(client, creds, **params) -> set[int]:
    resp = await client.get("/api/avisos", params=params, headers=await _login(client, creds))
    assert resp.status_code == 200, resp.text
    return {a["aviso_id"] for a in resp.json()}


async def test_supervisor_y_gerente_ven_el_repositorio_completo(client, maquina_id, limpieza):
    a1 = await _reportar(client, OPERADOR, maquina_id, "aviso del operador 1")
    a2 = await _reportar(client, OPERADOR_2, maquina_id, "aviso del operador 2")
    for creds in (SUPERVISOR, GERENTE):
        assert {a1["aviso_id"], a2["aviso_id"]} <= await _ids(client, creds)


async def test_quien_reporta_solo_ve_sus_propios_avisos(client, maquina_id, limpieza):
    suyo = await _reportar(client, OPERADOR, maquina_id, "mío")
    ajeno = await _reportar(client, OPERADOR_2, maquina_id, "de otro")
    ids = await _ids(client, OPERADOR)
    assert suyo["aviso_id"] in ids and ajeno["aviso_id"] not in ids
    # El detalle de uno ajeno responde 404 (no se revela que existe).
    resp = await client.get(f"/api/avisos/{ajeno['aviso_id']}", headers=await _login(client, OPERADOR))
    assert resp.status_code == 404
    # Un ingeniero reporta pero no administra el repositorio: solo ve lo suyo.
    assert ajeno["aviso_id"] not in await _ids(client, ENGINEER)


async def test_otra_empresa_no_ve_los_avisos(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    assert aviso["aviso_id"] not in await _ids(client, GERENTE_E2)
    resp = await client.get(f"/api/avisos/{aviso['aviso_id']}", headers=await _login(client, GERENTE_E2))
    assert resp.status_code == 404


async def test_los_avisos_no_tocan_la_tabla_reporte_del_seed(client, maquina_id, limpieza):
    antes = await fetch_one("SELECT COUNT(*) AS n FROM reporte")
    await _reportar(client, OPERADOR, maquina_id)
    despues = await fetch_one("SELECT COUNT(*) AS n FROM reporte")
    assert antes["n"] == despues["n"]


async def test_filtro_por_estado_y_orden_pendientes_primero(client, maquina_id, limpieza):
    pendiente = await _reportar(client, OPERADOR, maquina_id, "pendiente")
    descartado = await _reportar(client, OPERADOR, maquina_id, "descartado")
    hs = await _login(client, SUPERVISOR)
    await client.post(f"/api/avisos/{descartado['aviso_id']}/descartar", json={"motivo": "Duplicado"}, headers=hs)

    assert pendiente["aviso_id"] in await _ids(client, SUPERVISOR, estado="pendiente")
    assert descartado["aviso_id"] not in await _ids(client, SUPERVISOR, estado="pendiente")
    assert descartado["aviso_id"] in await _ids(client, SUPERVISOR, estado="descartado")
    assert (await client.get("/api/avisos", params={"estado": "inventado"}, headers=hs)).status_code == 422

    todos = (await client.get("/api/avisos", headers=hs)).json()
    estados = [a["estado"] for a in todos]
    assert estados == sorted(estados, key=lambda e: e != "pendiente")  # los pendientes van primero


# --- Decidir: generar OT -----------------------------------------------------

async def test_el_supervisor_genera_una_ot_desde_el_aviso(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id, "falla en el motor", severidad="high")
    tecnico_id = await _usuario_id(TECNICO["email"])
    hs = await _login(client, SUPERVISOR)

    resp = await client.post(
        f"/api/avisos/{aviso['aviso_id']}/generar-ot", json={"tecnico_id": tecnico_id, "priority": "urgent"}, headers=hs
    )
    assert resp.status_code == 200, resp.text
    cuerpo = resp.json()
    ot, resultado = cuerpo["ot"], cuerpo["aviso"]

    # La OT hereda la descripción y la severidad del aviso, queda asignada y enlazada a él.
    assert ot["numero_ot"].startswith("OT-") and ot["estado"] == "pending"
    assert ot["description"] == aviso["descripcion"]
    assert ot["severity"] == "high" and ot["priority"] == "urgent"
    assert ot["tecnico_id"] == tecnico_id
    # La OT guarda el id del aviso que la originó y expone su número (se muestra en el modal de la OT).
    assert ot["aviso_falla_id"] == aviso["aviso_id"] and ot["numero_aviso"] == aviso["numero_aviso"]
    # El aviso queda «con OT», con quién decidió y cuándo.
    assert resultado["estado"] == "con_ot" and resultado["numero_ot"] == ot["numero_ot"]
    assert resultado["resuelto_por"] and resultado["resuelto_en"]
    creada_por = await fetch_one("SELECT creado_por FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": ot["numero_ot"]})
    assert creada_por["creado_por"] == await _usuario_id(SUPERVISOR["email"])


async def test_quien_reporto_ve_la_ot_que_nacio_de_su_aviso(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    tecnico_id = await _usuario_id(TECNICO["email"])
    resp = await client.post(
        f"/api/avisos/{aviso['aviso_id']}/generar-ot", json={"tecnico_id": tecnico_id}, headers=await _login(client, SUPERVISOR)
    )
    numero = resp.json()["ot"]["numero_ot"]

    ho = await _login(client, OPERADOR)
    assert numero in [o["numero_ot"] for o in (await client.get("/api/work-orders", headers=ho)).json()]
    assert (await client.get(f"/api/work-orders/{numero}", headers=ho)).status_code == 200
    # Y el aviso, ahora, le muestra el número de la OT.
    assert (await client.get(f"/api/avisos/{aviso['aviso_id']}", headers=ho)).json()["numero_ot"] == numero
    # Otro operador no la ve.
    h2 = await _login(client, OPERADOR_2)
    assert numero not in [o["numero_ot"] for o in (await client.get("/api/work-orders", headers=h2)).json()]


async def test_el_gerente_tambien_puede_decidir(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    resp = await client.post(
        f"/api/avisos/{aviso['aviso_id']}/generar-ot",
        json={"tecnico_id": await _usuario_id(TECNICO["email"])},
        headers=await _login(client, GERENTE),
    )
    assert resp.status_code == 200, resp.text


async def test_un_aviso_no_se_convierte_dos_veces(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    hs = await _login(client, SUPERVISOR)
    cuerpo = {"tecnico_id": await _usuario_id(TECNICO["email"])}
    assert (await client.post(f"/api/avisos/{aviso['aviso_id']}/generar-ot", json=cuerpo, headers=hs)).status_code == 200
    segunda = await client.post(f"/api/avisos/{aviso['aviso_id']}/generar-ot", json=cuerpo, headers=hs)
    assert segunda.status_code == 409
    n = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo WHERE aviso_falla_id = %(r)s", {"r": aviso["aviso_id"]})
    assert n["n"] == 1


async def test_generar_ot_valida_al_tecnico(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    hs = await _login(client, SUPERVISOR)
    url = f"/api/avisos/{aviso['aviso_id']}/generar-ot"
    assert (await client.post(url, json={"tecnico_id": 999999}, headers=hs)).status_code == 422
    # Un usuario que no es técnico tampoco sirve.
    assert (await client.post(url, json={"tecnico_id": await _usuario_id(ENGINEER["email"])}, headers=hs)).status_code == 422
    assert (await client.post(url, json={"tecnico_id": 4, "priority": "extrema"}, headers=hs)).status_code == 422
    # Los intentos fallidos no consumen el aviso.
    assert (await client.get(f"/api/avisos/{aviso['aviso_id']}", headers=hs)).json()["estado"] == "pendiente"


@pytest.mark.parametrize("creds", [OPERADOR, TECNICO, ENGINEER, ADMIN])
async def test_solo_supervisor_y_gerente_deciden(client, maquina_id, limpieza, creds):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    h = await _login(client, creds)
    url = f"/api/avisos/{aviso['aviso_id']}"
    assert (await client.post(f"{url}/generar-ot", json={"tecnico_id": 4}, headers=h)).status_code == 403
    assert (await client.post(f"{url}/descartar", json={"motivo": "no"}, headers=h)).status_code == 403


# --- Decidir: descartar ------------------------------------------------------

async def test_descartar_exige_motivo_y_se_lo_muestra_a_quien_reporto(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    hs = await _login(client, SUPERVISOR)
    url = f"/api/avisos/{aviso['aviso_id']}/descartar"
    assert (await client.post(url, json={"motivo": "  "}, headers=hs)).status_code == 422
    assert (await client.post(url, json={"motivo": "ab"}, headers=hs)).status_code == 422
    assert (await client.post(url, json={}, headers=hs)).status_code == 422

    resp = await client.post(url, json={"motivo": "Ya estaba en la OT-2026-0012"}, headers=hs)
    assert resp.status_code == 200, resp.text
    assert resp.json()["estado"] == "descartado" and resp.json()["resuelto_por"]

    visto = (await client.get(f"/api/avisos/{aviso['aviso_id']}", headers=await _login(client, OPERADOR))).json()
    assert visto["estado"] == "descartado"
    assert visto["motivo_descarte"] == "Ya estaba en la OT-2026-0012"
    assert visto["numero_ot"] is None
    n = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo WHERE aviso_falla_id = %(r)s", {"r": aviso["aviso_id"]})
    assert n["n"] == 0


async def test_un_aviso_descartado_no_se_puede_volver_a_decidir(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    hs = await _login(client, SUPERVISOR)
    await client.post(f"/api/avisos/{aviso['aviso_id']}/descartar", json={"motivo": "Falsa alarma"}, headers=hs)
    url = f"/api/avisos/{aviso['aviso_id']}"
    assert (await client.post(f"{url}/descartar", json={"motivo": "otra vez"}, headers=hs)).status_code == 409
    assert (await client.post(f"{url}/generar-ot", json={"tecnico_id": 4}, headers=hs)).status_code == 409


async def test_decidir_sobre_un_aviso_inexistente_o_de_otra_empresa_es_404(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    hs = await _login(client, SUPERVISOR)
    assert (await client.post("/api/avisos/999999/descartar", json={"motivo": "xxx"}, headers=hs)).status_code == 404
    hg2 = await _login(client, GERENTE_E2)
    url = f"/api/avisos/{aviso['aviso_id']}"
    assert (await client.post(f"{url}/descartar", json={"motivo": "xxx"}, headers=hg2)).status_code == 404
    assert (await client.get(url, headers=hs)).json()["estado"] == "pendiente"


# --- Foto de la falla ---------------------------------------------------------

# PNG de 1x1 píxel (válido). Para JPEG y WEBP basta la firma del archivo.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005840180b1"
    "a98c210000000049454e44ae426082"
)
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    """Las fotos de las pruebas van a una carpeta temporal, no a `uploads/` del proyecto."""
    from barb.core.config import settings

    monkeypatch.setattr(settings, "upload_dir", tmp_path)
    return tmp_path


async def _reportar_con_foto(client, creds, maquina_id, contenido=PNG, nombre="falla.png", tipo="image/png", texto="con foto"):
    return await client.post(
        "/api/avisos",
        data={"maquina_id": str(maquina_id), "descripcion": f"{MARCA}: {texto}", "severidad": "high"},
        files={"foto": (nombre, contenido, tipo)},
        headers=await _login(client, creds),
    )


async def test_el_operador_reporta_una_falla_con_foto(client, maquina_id, limpieza, uploads):
    resp = await _reportar_con_foto(client, OPERADOR, maquina_id)
    assert resp.status_code == 201, resp.text
    aviso = resp.json()
    assert aviso["foto"] == {"original_name": "falla.png", "content_type": "image/png"}
    assert aviso["severidad"] == "high" and aviso["estado"] == "pendiente"
    guardadas = list((uploads / "avisos" / str(aviso["aviso_id"])).iterdir())
    assert len(guardadas) == 1 and guardadas[0].read_bytes() == PNG


@pytest.mark.parametrize("contenido,nombre,tipo", [(JPEG, "falla.jpg", "image/jpeg"), (WEBP, "falla.webp", "image/webp")])
async def test_acepta_jpeg_y_webp(client, maquina_id, limpieza, uploads, contenido, nombre, tipo):
    resp = await _reportar_con_foto(client, OPERADOR, maquina_id, contenido, nombre, tipo)
    assert resp.status_code == 201, resp.text
    assert resp.json()["foto"]["content_type"] == tipo


async def test_sin_foto_el_aviso_sigue_funcionando(client, maquina_id, limpieza, uploads):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    assert aviso["foto"] is None
    resp = await client.get(f"/api/avisos/{aviso['aviso_id']}/foto", headers=await _login(client, OPERADOR))
    assert resp.status_code == 404 and "no tiene foto" in resp.json()["detail"]


async def test_la_foto_se_descarga_con_la_misma_visibilidad_que_el_aviso(client, maquina_id, limpieza, uploads):
    aviso = (await _reportar_con_foto(client, OPERADOR, maquina_id)).json()
    url = f"/api/avisos/{aviso['aviso_id']}/foto"

    resp = await client.get(url, headers=await _login(client, OPERADOR))
    assert resp.status_code == 200
    assert resp.content == PNG and resp.headers["content-type"] == "image/png"
    assert resp.headers["x-content-type-options"] == "nosniff"

    assert (await client.get(url, headers=await _login(client, SUPERVISOR))).status_code == 200
    assert (await client.get(url, headers=await _login(client, GERENTE))).status_code == 200
    # Otro operador, otra empresa o un rol sin acceso no la ven.
    assert (await client.get(url, headers=await _login(client, OPERADOR_2))).status_code == 404
    assert (await client.get(url, headers=await _login(client, GERENTE_E2))).status_code == 404
    assert (await client.get(url, headers=await _login(client, ADMIN))).status_code == 403
    assert (await client.get(url)).status_code == 422


async def test_rechaza_lo_que_no_es_una_imagen_valida(client, maquina_id, limpieza, uploads):
    # Tipo no permitido.
    r = await _reportar_con_foto(client, OPERADOR, maquina_id, b"hola", "nota.txt", "text/plain")
    assert r.status_code == 415
    # Dice ser PNG pero el contenido no lo es.
    r = await _reportar_con_foto(client, OPERADOR, maquina_id, b"<script>alert(1)</script>", "falso.png", "image/png")
    assert r.status_code == 415 and "no es una imagen válida" in r.json()["detail"]
    # Demasiado grande (5 MB es el máximo).
    r = await _reportar_con_foto(client, OPERADOR, maquina_id, PNG + b"\x00" * (5 * 1024 * 1024), "grande.png", "image/png")
    assert r.status_code == 413
    # Nada de lo rechazado dejó avisos ni archivos.
    assert not (uploads / "avisos").exists() or not any((uploads / "avisos").iterdir())
    n = await fetch_one("SELECT COUNT(*) AS n FROM aviso_falla WHERE descripcion LIKE %(p)s", {"p": f"{MARCA}%"})
    assert n["n"] == 0


async def test_un_aviso_invalido_con_foto_no_guarda_nada(client, maquina_id, limpieza, uploads):
    resp = await client.post(
        "/api/avisos",
        data={"maquina_id": str(maquina_id), "descripcion": "   "},
        files={"foto": ("falla.png", PNG, "image/png")},
        headers=await _login(client, OPERADOR),
    )
    assert resp.status_code == 422
    resp = await client.post(
        "/api/avisos",
        data={"maquina_id": "999999", "descripcion": f"{MARCA}: máquina inexistente"},
        files={"foto": ("falla.png", PNG, "image/png")},
        headers=await _login(client, OPERADOR),
    )
    assert resp.status_code == 422
    assert not (uploads / "avisos").exists() or not any((uploads / "avisos").iterdir())


async def test_la_foto_pasa_a_la_ot_al_generarla(client, maquina_id, limpieza, uploads):
    aviso = (await _reportar_con_foto(client, OPERADOR, maquina_id)).json()
    resp = await client.post(
        f"/api/avisos/{aviso['aviso_id']}/generar-ot",
        json={"tecnico_id": await _usuario_id(TECNICO["email"])},
        headers=await _login(client, SUPERVISOR),
    )
    assert resp.status_code == 200, resp.text
    ot = resp.json()["ot"]
    assert ot["photo_count"] == 1 and ot["photos"][0]["original_name"] == "falla.png"
    en_ot = uploads / "work-orders" / ot["numero_ot"]
    assert [p.read_bytes() for p in en_ot.iterdir()] == [PNG]
    # La del aviso sigue disponible.
    assert (uploads / "avisos" / str(aviso["aviso_id"])).exists()


async def test_si_la_foto_ya_no_esta_en_disco_la_ot_se_crea_igual(client, maquina_id, limpieza, uploads):
    aviso = (await _reportar_con_foto(client, OPERADOR, maquina_id)).json()
    for archivo in (uploads / "avisos" / str(aviso["aviso_id"])).iterdir():
        archivo.unlink()  # el disco de Render es efímero
    hs = await _login(client, SUPERVISOR)
    resp = await client.get(f"/api/avisos/{aviso['aviso_id']}/foto", headers=hs)
    assert resp.status_code == 404 and "ya no está disponible" in resp.json()["detail"]

    resp = await client.post(
        f"/api/avisos/{aviso['aviso_id']}/generar-ot", json={"tecnico_id": await _usuario_id(TECNICO["email"])}, headers=hs
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ot"]["photo_count"] == 0


def test_la_ruta_de_la_foto_no_puede_escapar_de_uploads(uploads):
    from fastapi import HTTPException

    from barb.routers.avisos import _ruta_de_foto

    assert _ruta_de_foto({"ruta": "avisos/1/a.png"}) == (uploads / "avisos" / "1" / "a.png").resolve()
    for maliciosa in ("../secreto.txt", "avisos/../../secreto.txt", "/etc/passwd"):
        with pytest.raises(HTTPException) as e:
            _ruta_de_foto({"ruta": maliciosa})
        assert e.value.status_code == 404


# --- La tabla `aviso_falla` y su relación con `orden_trabajo` -------------------------------------------------------

async def test_el_formulario_queda_guardado_en_aviso_falla(client, maquina_id, limpieza, uploads):
    aviso = (await _reportar_con_foto(client, OPERADOR, maquina_id, texto="vibración", tipo="image/png")).json()
    fila = await fetch_one("SELECT * FROM aviso_falla WHERE aviso_falla_id = %(i)s", {"i": aviso["aviso_id"]})
    assert fila["numero_aviso"] == aviso["numero_aviso"]
    assert fila["maquina_id"] == maquina_id
    assert fila["reportado_por"] == await _usuario_id(OPERADOR["email"])
    assert fila["descripcion"] == f"{MARCA}: vibración" and fila["severidad"] == "high"
    assert fila["estado"] == "pendiente"
    assert fila["resuelto_por"] is None and fila["resuelto_en"] is None and fila["motivo_descarte"] is None
    # La foto: metadata en columnas y ruta relativa a la carpeta de subidas.
    assert fila["foto_nombre"] == "falla.png" and fila["foto_content_type"] == "image/png"
    assert fila["foto_ruta"] == f"avisos/{aviso['aviso_id']}/{fila['foto_archivo']}"
    assert (uploads / fila["foto_ruta"]).read_bytes() == PNG


async def test_un_aviso_sin_foto_deja_las_columnas_de_foto_vacias(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id)
    fila = await fetch_one("SELECT * FROM aviso_falla WHERE aviso_falla_id = %(i)s", {"i": aviso["aviso_id"]})
    assert fila["foto_nombre"] is fila["foto_archivo"] is fila["foto_content_type"] is fila["foto_ruta"] is None


async def test_la_ot_guarda_el_id_del_aviso_que_la_origino(client, maquina_id, limpieza):
    aviso = await _reportar(client, OPERADOR, maquina_id, "origen de la OT")
    resp = await client.post(
        f"/api/avisos/{aviso['aviso_id']}/generar-ot",
        json={"tecnico_id": await _usuario_id(TECNICO["email"])},
        headers=await _login(client, SUPERVISOR),
    )
    numero = resp.json()["ot"]["numero_ot"]

    # En la base: la OT apunta al aviso.
    fila = await fetch_one("SELECT aviso_falla_id FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": numero})
    assert fila["aviso_falla_id"] == aviso["aviso_id"]
    # En la API (lo que muestra el modal de la OT): detalle y listado.
    for credenciales in (SUPERVISOR, OPERADOR):  # el operador la ve porque nació de su aviso
        h = await _login(client, credenciales)
        detalle = (await client.get(f"/api/work-orders/{numero}", headers=h)).json()
        assert detalle["aviso_falla_id"] == aviso["aviso_id"] and detalle["numero_aviso"] == aviso["numero_aviso"]
        en_lista = next(o for o in (await client.get("/api/work-orders", headers=h)).json() if o["numero_ot"] == numero)
        assert en_lista["numero_aviso"] == aviso["numero_aviso"]


async def test_una_ot_creada_directamente_no_tiene_aviso(client, maquina_id, limpieza):
    resp = await client.post(
        "/api/work-orders",
        json={
            "maquina_id": maquina_id,
            "tecnico_id": await _usuario_id(TECNICO["email"]),
            "descripcion_problema": f"{MARCA}: directa",
        },
        headers=await _login(client, GERENTE),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["aviso_falla_id"] is None and resp.json()["numero_aviso"] is None


async def test_la_decision_queda_registrada_en_la_tabla(client, maquina_id, limpieza):
    uid = await _usuario_id(SUPERVISOR["email"])
    con_ot = await _reportar(client, OPERADOR, maquina_id, "para OT")
    descartado = await _reportar(client, OPERADOR, maquina_id, "para descartar")
    hs = await _login(client, SUPERVISOR)
    tecnico_id = await _usuario_id(TECNICO["email"])
    await client.post(f"/api/avisos/{con_ot['aviso_id']}/generar-ot", json={"tecnico_id": tecnico_id}, headers=hs)
    await client.post(f"/api/avisos/{descartado['aviso_id']}/descartar", json={"motivo": "Duplicado"}, headers=hs)

    a = await fetch_one("SELECT * FROM aviso_falla WHERE aviso_falla_id = %(i)s", {"i": con_ot["aviso_id"]})
    assert a["estado"] == "con_ot" and a["resuelto_por"] == uid and a["resuelto_en"] is not None and a["motivo_descarte"] is None
    d = await fetch_one("SELECT * FROM aviso_falla WHERE aviso_falla_id = %(i)s", {"i": descartado["aviso_id"]})
    assert d["estado"] == "descartado" and d["resuelto_por"] == uid and d["motivo_descarte"] == "Duplicado"


async def test_la_base_impide_que_un_aviso_origine_dos_ot(client, maquina_id, limpieza):
    import psycopg

    aviso = await _reportar(client, OPERADOR, maquina_id)
    hs = await _login(client, SUPERVISOR)
    tecnico_id = await _usuario_id(TECNICO["email"])
    url = f"/api/avisos/{aviso['aviso_id']}/generar-ot"
    assert (await client.post(url, json={"tecnico_id": tecnico_id}, headers=hs)).status_code == 200
    with pytest.raises(psycopg.errors.UniqueViolation):
        await execute(
            """
            INSERT INTO orden_trabajo
                (numero_ot, maquina_id, tecnico_id, creado_por, tipo, descripcion_problema, priority, aviso_falla_id)
            VALUES ('OT-TEST-DUP', %(m)s, %(t)s, %(t)s, 'corrective', %(d)s, 'low', %(a)s)
            """,
            {"m": maquina_id, "t": tecnico_id, "d": f"{MARCA}: duplicada", "a": aviso["aviso_id"]},
        )


async def test_la_base_exige_el_motivo_al_descartar_y_estados_validos(client, maquina_id, limpieza):
    import psycopg

    aviso = await _reportar(client, OPERADOR, maquina_id)
    uid = await _usuario_id(SUPERVISOR["email"])
    for sql in (
        # descartar sin motivo
        "UPDATE aviso_falla SET estado='descartado', resuelto_por=%(u)s, resuelto_en=NOW() WHERE aviso_falla_id=%(i)s",
        # estado inventado
        "UPDATE aviso_falla SET estado='inventado' WHERE aviso_falla_id=%(i)s",
        # decidido sin quién ni cuándo
        "UPDATE aviso_falla SET estado='con_ot' WHERE aviso_falla_id=%(i)s",
    ):
        with pytest.raises(psycopg.errors.CheckViolation):
            await execute(sql, {"u": uid, "i": aviso["aviso_id"]})
