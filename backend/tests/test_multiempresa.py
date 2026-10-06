"""
Pruebas multi-empresa: aislamiento de datos, super_usuario, mantenedores y RAG por empresa.

Requieren la BD migrada (0004) y sembrada (`scripts/seed.py` aplica seed_multiempresa.sql).
Las pruebas que crean datos los eliminan al terminar.
"""

from __future__ import annotations

import io
import json
import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from barb.core.permissions import ACCIONES, RUTAS, puede_acceder_ruta, puede_ejecutar_accion, resolver_empresa
from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import token_limiter
from barb.main import app
from barb.services import document_service as docs
from barb.services.llm_service import NO_DOCS_ANSWER

# Credenciales del seed ficticio (seeds/seed_multiempresa.sql)
SUPER = ("super@barb.com", "super123")
ADMIN_E1 = ("admin@barb.com", "admin123")
ADMIN_E2 = ("admin@mineranorte.cl", "minera123")
TECNICO_E2 = ("pedro@mineranorte.cl", "minera123")
ENGINEER_E1 = ("engineer1@planta.com", "engineer123")
OPERADOR_E1 = ("operador1@planta.com", "operador123")
ADMIN_SUSPENDIDA = ("admin@constructorasur.cl", "sur12345")


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _empresa_id(client, headers, nombre) -> int:
    r = await client.get("/api/empresas", headers=headers)
    return next(e["empresa_id"] for e in r.json() if e["nombre"] == nombre)


# =============================================================================
# Permisos (unitarias)
# =============================================================================

def test_super_usuario_accede_a_todas_las_rutas_y_acciones():
    assert all(puede_acceder_ruta("super_usuario", r) is True for r in RUTAS)
    assert all(puede_ejecutar_accion("super_usuario", a) for a in ACCIONES)


def test_solo_super_usuario_gestiona_empresas():
    for rol, permitido in ACCIONES["gestionar_empresas"].items():
        assert permitido == (rol == "super_usuario")
    for rol, permiso in RUTAS["empresas"].items():
        assert (permiso is True) == (rol == "super_usuario")


def test_resolver_empresa_ignora_la_solicitud_de_usuarios_de_empresa():
    assert resolver_empresa({"rol": "admin", "empresa_id": 1}, 2) == 1
    assert resolver_empresa({"rol": "super_usuario", "empresa_id": None}, 2) == 2
    assert resolver_empresa({"rol": "super_usuario", "empresa_id": None}) is None


# =============================================================================
# Servicio de documentos (unitarias)
# =============================================================================

def test_build_tsquery_solo_deja_terminos_seguros():
    q = docs.build_tsquery("¿Cuál es el torque? '); DROP TABLE x; -- & | !")
    assert q
    assert all(ch not in q.replace(" | ", "") for ch in "&!'();:*<>-")  # sin operadores de tsquery
    assert "torque" in q


def test_split_chunks_respeta_tamano_y_no_pierde_texto():
    texto = "\n\n".join(f"Párrafo {i} " + "palabra " * 60 for i in range(10))
    chunks = docs.split_chunks(texto)
    assert len(chunks) > 1
    assert all(len(c) <= docs.CHUNK_SIZE + 2 for c in chunks)
    assert "Párrafo 9" in chunks[-1]


def test_extract_text_rechaza_extension_no_soportada_y_vacios():
    with pytest.raises(HTTPException) as e:
        docs.extract_text("virus.exe", b"MZ")
    assert e.value.status_code == 415
    with pytest.raises(HTTPException) as e:
        docs.extract_text("vacio.txt", b"   \n ")
    assert e.value.status_code == 422
    assert docs.extract_text("a.txt", b"hola mundo") == "hola mundo"


# =============================================================================
# Aislamiento de datos entre empresas (integración)
# =============================================================================

async def test_ots_solo_de_la_propia_empresa(client):
    h1, h2 = await _login(client, ADMIN_E1), await _login(client, ADMIN_E2)
    ots1 = (await client.get("/api/work-orders", headers=h1)).json()
    ots2 = (await client.get("/api/work-orders", headers=h2)).json()

    assert ots1 and ots2
    assert {o["empresa_nombre"] for o in ots1} == {"Planta Demo BARB"}
    assert {o["empresa_nombre"] for o in ots2} == {"Minera Norte S.A."}
    assert not {o["numero_ot"] for o in ots1} & {o["numero_ot"] for o in ots2}


async def test_no_se_puede_ver_ni_modificar_una_ot_de_otra_empresa(client):
    h1 = await _login(client, ADMIN_E1)
    r = await client.get("/api/work-orders/OT-2026-101", headers=h1)  # OT de Minera Norte
    assert r.status_code == 404
    r = await client.put("/api/work-orders/OT-2026-101/status", headers=h1, json={"status": "completed"})
    assert r.status_code == 404
    r = await client.delete("/api/work-orders/OT-2026-101", headers=h1)
    assert r.status_code == 404


async def test_parametro_empresa_id_es_ignorado_por_usuarios_de_empresa(client):
    h1 = await _login(client, ADMIN_E1)
    e2 = await _empresa_id(client, await _login(client, SUPER), "Minera Norte S.A.")
    ots = (await client.get(f"/api/work-orders?empresa_id={e2}", headers=h1)).json()
    assert {o["empresa_nombre"] for o in ots} == {"Planta Demo BARB"}


async def test_catalogos_filtrados_por_empresa(client):
    h2 = await _login(client, ADMIN_E2)
    plantas = (await client.get("/api/plants", headers=h2)).json()
    maquinas = (await client.get("/api/machines", headers=h2)).json()
    tecnicos = (await client.get("/api/technicians", headers=h2)).json()
    assert {p["name"] for p in plantas} == {"Planta Concentradora Calama", "Faena Chancado Norte"}
    assert len(maquinas) == 7
    assert {t["email"] for t in tecnicos} == {"pedro@mineranorte.cl", "marta@mineranorte.cl"}


async def test_no_se_puede_crear_ot_con_maquina_o_tecnico_de_otra_empresa(client):
    # Gerente de empresa 2 con la máquina de la empresa 1 (id 1 = Compressor A1).
    h = await _login(client, ("gerente@mineranorte.cl", "minera123"))
    r = await client.post(
        "/api/work-orders",
        headers=h,
        json={"maquina_id": 1, "tecnico_id": 4, "descripcion_problema": "x", "tipo": "corrective"},
    )
    assert r.status_code == 422


async def test_stats_y_topologia_solo_de_la_empresa(client):
    h2 = await _login(client, ADMIN_E2)
    stats = (await client.get("/api/stats/financial-impact", headers=h2)).json()
    assert {m["name"] for m in stats["machines"]} <= {
        "Molino SAG 1", "Bomba de Pulpa BP-3", "Celda de Flotación CF-2", "Sistema Lubricación Molino",
        "Chancador Primario CH-01", "Correa Overland CV-12", "Subestación Eléctrica SE-4",
    }
    topo = (await client.get("/api/topology", headers=h2)).json()
    nombres = {n["nombre_visual"] for n in topo["nodos"]}
    assert "Chancador Primario CH-01" in nombres
    assert "Compressor A1" not in nombres


# =============================================================================
# super_usuario
# =============================================================================

async def test_super_usuario_ve_todas_las_empresas_y_puede_filtrar(client):
    hs = await _login(client, SUPER)
    todas = (await client.get("/api/work-orders", headers=hs)).json()
    assert {o["empresa_nombre"] for o in todas} >= {"Planta Demo BARB", "Minera Norte S.A.", "Demo Trial Corp"}

    e2 = await _empresa_id(client, hs, "Minera Norte S.A.")
    solo2 = (await client.get(f"/api/work-orders?empresa_id={e2}", headers=hs)).json()
    assert {o["empresa_nombre"] for o in solo2} == {"Minera Norte S.A."}


async def test_login_devuelve_empresa_y_super_no_tiene(client):
    r = await client.post("/api/auth/login", json={"email": ADMIN_E2[0], "password": ADMIN_E2[1]})
    assert r.json()["user"]["empresa_nombre"] == "Minera Norte S.A."
    r = await client.post("/api/auth/login", json={"email": SUPER[0], "password": SUPER[1]})
    user = r.json()["user"]
    assert user["role"] == "super_usuario" and user["empresa_id"] is None


async def test_empresa_suspendida_no_puede_iniciar_sesion(client):
    r = await client.post("/api/auth/login", json={"email": ADMIN_SUSPENDIDA[0], "password": ADMIN_SUSPENDIDA[1]})
    assert r.status_code == 403


async def test_mantenedor_de_empresas_es_exclusivo_del_super(client):
    for creds in (ADMIN_E1, ADMIN_E2, ENGINEER_E1, OPERADOR_E1):
        h = await _login(client, creds)
        assert (await client.get("/api/empresas", headers=h)).status_code == 403
        assert (await client.post("/api/empresas", headers=h, json={"nombre": "Hack"})).status_code == 403
    hs = await _login(client, SUPER)
    assert (await client.get("/api/empresas", headers=hs)).status_code == 200


async def test_super_crea_edita_suspende_y_elimina_empresa_con_admin_inicial(client):
    hs = await _login(client, SUPER)
    sufijo = uuid.uuid4().hex[:6]
    email_admin = f"admin-{sufijo}@test.cl"
    r = await client.post(
        "/api/empresas",
        headers=hs,
        json={
            "nombre": f"Empresa Test {sufijo}",
            "rut": f"99.{sufijo}-K",
            "plan": "starter",
            "max_usuarios": 2,
            "admin": {"nombre": "Admin Test", "email": email_admin, "password": "secreto123"},
        },
    )
    assert r.status_code == 201, r.text
    empresa = r.json()
    eid = empresa["empresa_id"]
    try:
        assert empresa["usuarios_total"] == 1

        # RUT duplicado -> 409
        dup = await client.post("/api/empresas", headers=hs, json={"nombre": "Otra", "rut": empresa["rut"]})
        assert dup.status_code == 409

        # El admin recién creado entra y solo ve su empresa (sin OTs)
        h_admin = await _login(client, (email_admin, "secreto123"))
        assert (await client.get("/api/work-orders", headers=h_admin)).json() == []

        # Límite de licencia: max_usuarios=2 -> segundo usuario ok, tercero 409
        ok = await client.post(
            "/api/usuarios", headers=h_admin,
            json={"nombre": "Tec Uno", "email": f"t1-{sufijo}@test.cl", "password": "secreto123", "rol": "tecnico"},
        )
        assert ok.status_code == 201 and ok.json()["empresa_id"] == eid
        lleno = await client.post(
            "/api/usuarios", headers=h_admin,
            json={"nombre": "Tec Dos", "email": f"t2-{sufijo}@test.cl", "password": "secreto123", "rol": "tecnico"},
        )
        assert lleno.status_code == 409

        # Suspender cierra la sesión abierta y bloquea nuevos logins
        upd = await client.put(f"/api/empresas/{eid}", headers=hs, json={"estado": "suspended"})
        assert upd.json()["estado"] == "suspended"
        assert (await client.get("/api/work-orders", headers=h_admin)).status_code in (401, 403)
        relogin = await client.post("/api/auth/login", json={"email": email_admin, "password": "secreto123"})
        assert relogin.status_code == 403

        # Con usuarios asociados no se puede eliminar
        assert (await client.delete(f"/api/empresas/{eid}", headers=hs)).status_code == 409
    finally:
        for u in (await client.get(f"/api/usuarios?empresa_id={eid}", headers=hs)).json():
            await client.delete(f"/api/usuarios/{u['usuario_id']}", headers=hs)
        assert (await client.delete(f"/api/empresas/{eid}", headers=hs)).status_code == 204


# =============================================================================
# Mantenedor de usuarios
# =============================================================================

async def test_admin_solo_ve_usuarios_de_su_empresa(client):
    h2 = await _login(client, ADMIN_E2)
    usuarios = (await client.get("/api/usuarios", headers=h2)).json()
    assert usuarios and {u["empresa_nombre"] for u in usuarios} == {"Minera Norte S.A."}
    assert "super_usuario" not in {u["rol"] for u in usuarios}


async def test_admin_no_puede_tocar_usuarios_de_otra_empresa_ni_crear_super(client):
    h1, hs = await _login(client, ADMIN_E1), await _login(client, SUPER)
    pedro = next(u for u in (await client.get("/api/usuarios", headers=hs)).json() if u["email"] == TECNICO_E2[0])

    assert (await client.put(f"/api/usuarios/{pedro['usuario_id']}", headers=h1, json={"nombre": "X Y"})).status_code == 404
    assert (await client.delete(f"/api/usuarios/{pedro['usuario_id']}", headers=h1)).status_code == 404

    r = await client.post(
        "/api/usuarios", headers=h1,
        json={
            "nombre": "Falso Super",
            "email": f"fs-{uuid.uuid4().hex[:6]}@x.cl",
            "password": "secreto123",
            "rol": "super_usuario",
        },
    )
    assert r.status_code == 403


async def test_admin_no_puede_asignar_otra_empresa_al_crear_usuario(client):
    h1, hs = await _login(client, ADMIN_E1), await _login(client, SUPER)
    e2 = await _empresa_id(client, hs, "Minera Norte S.A.")
    email = f"cruce-{uuid.uuid4().hex[:6]}@x.cl"
    r = await client.post(
        "/api/usuarios", headers=h1,
        json={"nombre": "Cruce Empresa", "email": email, "password": "secreto123", "rol": "operador", "empresa_id": e2},
    )
    try:
        assert r.status_code == 201
        assert r.json()["empresa_nombre"] == "Planta Demo BARB"  # se ignora el empresa_id enviado
    finally:
        if r.status_code == 201:
            await client.delete(f"/api/usuarios/{r.json()['usuario_id']}", headers=h1)


async def test_no_puede_eliminarse_ni_desactivarse_a_si_mismo(client):
    h1 = await _login(client, ADMIN_E1)
    yo = next(u for u in (await client.get("/api/usuarios", headers=h1)).json() if u["email"] == ADMIN_E1[0])
    assert (await client.delete(f"/api/usuarios/{yo['usuario_id']}", headers=h1)).status_code == 409
    assert (await client.put(f"/api/usuarios/{yo['usuario_id']}", headers=h1, json={"activo": False})).status_code == 409


async def test_email_duplicado_devuelve_409(client):
    h1 = await _login(client, ADMIN_E1)
    r = await client.post(
        "/api/usuarios", headers=h1,
        json={"nombre": "Duplicado", "email": ADMIN_E1[0], "password": "secreto123", "rol": "operador"},
    )
    assert r.status_code == 409


async def test_roles_sin_permiso_no_gestionan_usuarios(client):
    for creds in (ENGINEER_E1, OPERADOR_E1, TECNICO_E2):
        h = await _login(client, creds)
        assert (await client.get("/api/usuarios", headers=h)).status_code == 403


# =============================================================================
# Documentos por empresa
# =============================================================================

async def test_cada_empresa_solo_ve_sus_documentos(client):
    h1, h2 = await _login(client, ENGINEER_E1), await _login(client, ADMIN_E2)
    d1 = (await client.get("/api/documents", headers=h1)).json()
    d2 = (await client.get("/api/documents", headers=h2)).json()
    assert {d["empresa_nombre"] for d in d1} == {"Planta Demo BARB"}
    assert {d["empresa_nombre"] for d in d2} == {"Minera Norte S.A."}
    assert any(d["title"] == "Manual Chancador Primario CH-01" for d in d2)
    assert not any(d["title"] == "Manual Chancador Primario CH-01" for d in d1)


async def test_operador_ve_documentos_pero_no_sube_ni_elimina(client):
    h = await _login(client, OPERADOR_E1)
    assert (await client.get("/api/documents", headers=h)).status_code == 200
    files = {"file": ("a.txt", io.BytesIO(b"hola"), "text/plain")}
    assert (await client.post("/api/documents", headers=h, files=files)).status_code == 403
    assert (await client.delete("/api/documents/1", headers=h)).status_code == 403


async def test_no_se_puede_eliminar_documento_de_otra_empresa(client):
    h1, h2 = await _login(client, ENGINEER_E1), await _login(client, ADMIN_E2)
    doc2 = (await client.get("/api/documents", headers=h2)).json()[0]
    assert (await client.delete(f"/api/documents/{doc2['id']}", headers=h1)).status_code == 404
    assert (await client.patch(f"/api/documents/{doc2['id']}", headers=h1, json={"activo": False})).status_code == 404


async def test_subir_documento_lo_indexa_y_la_ia_lo_encuentra_solo_en_su_empresa(client):
    h1, hs = await _login(client, ENGINEER_E1), await _login(client, SUPER)
    clave = f"zorbulonium{uuid.uuid4().hex[:8]}"
    contenido = f"Procedimiento especial. El parámetro {clave} debe mantenerse en 42 unidades.".encode()
    r = await client.post(
        "/api/documents", headers=h1, data={"title": "Doc de prueba"},
        files={"file": ("prueba.txt", io.BytesIO(contenido), "text/plain")},
    )
    assert r.status_code == 201, r.text
    doc = r.json()
    try:
        assert doc["chunks_indexed"] == 1 and doc["activo"] is True
        e1 = doc["empresa_id"]
        e2 = await _empresa_id(client, hs, "Minera Norte S.A.")

        assert [c["title"] for c in await docs.search_chunks(e1, clave)] == ["Doc de prueba"]
        assert await docs.search_chunks(e2, clave) == []  # otra empresa: nada

        # Desactivado => la IA deja de usarlo, sin borrarlo
        await client.patch(f"/api/documents/{doc['id']}", headers=h1, json={"activo": False})
        assert await docs.search_chunks(e1, clave) == []
    finally:
        assert (await client.delete(f"/api/documents/{doc['id']}", headers=h1)).status_code == 204
    assert (await client.get("/api/documents", headers=h1)).json()  # sigue funcionando


async def test_subida_rechaza_tipo_vacio_y_super_requiere_empresa(client):
    h1, hs = await _login(client, ENGINEER_E1), await _login(client, SUPER)
    exe = {"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")}
    assert (await client.post("/api/documents", headers=h1, files=exe)).status_code == 415
    vacio = {"file": ("v.txt", io.BytesIO(b""), "text/plain")}
    assert (await client.post("/api/documents", headers=h1, files=vacio)).status_code == 422
    ok = {"file": ("a.txt", io.BytesIO(b"hola mundo"), "text/plain")}
    assert (await client.post("/api/documents", headers=hs, files=ok)).status_code == 422  # falta empresa_id


async def test_busqueda_rag_con_datos_semilla_respeta_empresa_y_estado(client, db_pool):
    # empresa 1: 'torque' de la prensa; el manual obsoleto del generador está inactivo.
    r1 = await docs.search_chunks(1, "¿Cuál es el torque de los pernos de la tapa del cilindro de la prensa?")
    assert r1 and r1[0]["title"] == "Procedimiento Prensa Hidráulica B3"
    generador = await docs.search_chunks(1, "generador frecuencia AVR")
    assert all(c["title"] != "Manual Generador G1 (versión obsoleta)" for c in generador)

    # empresa 2 jamás recibe contenido de la 1 y viceversa
    r2 = await docs.search_chunks(2, "torque pernos blindajes chancador")
    assert r2 and all(c["title"].startswith(("Manual Chancador", "Procedimiento Molino")) for c in r2)
    assert all("Chancador" not in c["title"] for c in await docs.search_chunks(1, "chancador blindajes torque"))


# =============================================================================
# Chat IA: solo responde con la documentación de la empresa
# =============================================================================

class _Chain:
    def __init__(self):
        self.payload = None

    async def astream(self, payload):
        self.payload = payload
        yield "respuesta basada en docs"


@pytest.fixture
def user_chat():
    # Los limitadores del chat son globales en memoria: se limpian para no afectar a otras pruebas.
    chat_rate_limiter._hits.clear()
    token_limiter._usage.clear()

    def _set(**over):
        user = {"id": 1, "empresa_id": 1, "name": "T", "email": "t@x.cl", "role": "admin", **over}
        app.dependency_overrides[get_current_user] = lambda: user

    yield _set
    app.dependency_overrides.pop(get_current_user, None)
    chat_rate_limiter._hits.clear()
    token_limiter._usage.clear()


@pytest.fixture
def repo_mock():
    with patch("barb.routers.chat.chat_repository.create_session", return_value="11111111-1111-1111-1111-111111111111"), \
         patch("barb.routers.chat.chat_repository.append_messages", return_value=True) as app_msgs:
        yield app_msgs


async def _stream(client, body):
    async with client.stream("POST", "/api/chat/stream", json=body) as resp:
        raw = "".join([c async for c in resp.aiter_text()])
        return resp.status_code, raw


async def test_chat_sin_documentacion_no_invoca_al_llm(client, user_chat, repo_mock):
    user_chat()
    with patch("barb.routers.chat.search_chunks", return_value=[]), \
         patch("barb.routers.chat.create_conversation_chain") as chain:
        status, raw = await _stream(client, {"message": "¿Cuál es la capital de Francia?"})
    assert status == 200
    chain.assert_not_called()
    textos = [json.loads(ln[5:])["text"] for ln in raw.splitlines() if ln.startswith("data:") and "text" in ln]
    assert "".join(textos) == NO_DOCS_ANSWER
    # la respuesta fija también queda persistida en el historial
    guardados = repo_mock.call_args.args[2]
    assert guardados[1]["content"] == NO_DOCS_ANSWER


async def test_chat_con_documentacion_pasa_contexto_de_su_empresa(client, user_chat, repo_mock):
    user_chat(empresa_id=2)
    chain = _Chain()
    chunks = [{"title": "Manual Chancador", "contenido": "Setting 150 mm"}]
    with patch("barb.routers.chat.search_chunks", return_value=chunks) as search, \
         patch("barb.routers.chat.create_conversation_chain", return_value=chain):
        status, raw = await _stream(client, {"message": "setting del chancador", "empresa_id": 1})
    assert status == 200 and "respuesta basada en docs" in raw
    assert search.call_args.args[0] == 2  # usa SU empresa; el empresa_id del body se ignora
    assert "[Documento: Manual Chancador]" in chain.payload["context"]
    assert "Setting 150 mm" in chain.payload["context"]


async def test_chat_super_usuario_debe_indicar_empresa(client, user_chat, repo_mock):
    user_chat(role="super_usuario", empresa_id=None)
    with patch("barb.routers.chat.search_chunks", return_value=[]) as search:
        status, _ = await _stream(client, {"message": "hola"})
        assert status == 422
        status, _ = await _stream(client, {"message": "hola", "empresa_id": 2})
        assert status == 200
    assert search.call_args.args[0] == 2
