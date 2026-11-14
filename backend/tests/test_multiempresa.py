"""
Pruebas multi-empresa: aislamiento de datos, super_usuario, mantenedores y RAG por empresa.

Requieren la BD migrada y sembrada (`scripts/seed.py` aplica los tres seeds realistas).
Las pruebas que crean datos los eliminan al terminar.
"""

from __future__ import annotations

import io
import json
import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from barb.core.db import fetch_all, fetch_one
from barb.core.permissions import ACCIONES, RUTAS, puede_acceder_ruta, puede_ejecutar_accion, resolver_empresa
from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import token_limiter
from barb.main import app
from barb.services import document_service as docs
from barb.services.llm_service import NO_DOCS_ANSWER

# Credenciales del seed ficticio (seeds/seed_multiempresa.sql)
SUPER = ("super@barb.com", "super123")
ADMIN_E1 = ("admin@mineradelnorte.cl", "mineria123")
ADMIN_E2 = ("admin@alimentos.cl", "alimentos123")
GERENTE_E1 = ("gerente@mineradelnorte.cl", "mineria123")
SUPERVISOR_E1 = ("supervisor@mineradelnorte.cl", "mineria123")
SUPERVISOR_E2 = ("supervisor@alimentos.cl", "alimentos123")
GERENTE_E2 = ("gerente@alimentos.cl", "alimentos123")
TECNICO_E2 = ("tecnico1@alimentos.cl", "alimentos123")
ENGINEER_E1 = ("engineer@mineradelnorte.cl", "mineria123")
OPERADOR_E1 = ("operador@mineradelnorte.cl", "mineria123")
ADMIN_E3 = ("admin@automotriz.cl", "automotriz123")


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

RUTAS_SUPER = {"empresas", "usuarios", "transacciones"}
ACCIONES_SUPER = {"gestionar_empresas", "gestionar_usuarios", "ver_usuarios"}


def test_super_usuario_solo_accede_a_empresas_y_usuarios():
    assert {r for r in RUTAS if puede_acceder_ruta("super_usuario", r)} == RUTAS_SUPER
    assert {a for a in ACCIONES if puede_ejecutar_accion("super_usuario", a)} == ACCIONES_SUPER
    for ruta in ("dashboard", "menu", "topology", "docchat", "documentos", "history", "notificaciones"):
        assert puede_acceder_ruta("super_usuario", ruta) is False


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
    assert {o["empresa_nombre"] for o in ots1} == {"Minera del Norte"}
    assert {o["empresa_nombre"] for o in ots2} == {"Planta de Alimentos"}
    assert not {o["numero_ot"] for o in ots1} & {o["numero_ot"] for o in ots2}


async def test_no_se_puede_ver_ni_modificar_una_ot_de_otra_empresa(client):
    h1 = await _login(client, SUPERVISOR_E1)
    r = await client.get("/api/work-orders/OT-2026-101", headers=h1)  # OT de Minera Norte
    assert r.status_code == 404
    r = await client.put("/api/work-orders/OT-2026-101/status", headers=h1, json={"status": "in_progress"})
    assert r.status_code == 404
    # Eliminar OT está prohibido para todos los perfiles (D1): 403 por permisos, aunque la OT sea de otra empresa.
    r = await client.delete("/api/work-orders/OT-2026-101", headers=h1)
    assert r.status_code == 403


async def test_parametro_empresa_id_es_ignorado_por_usuarios_de_empresa(client):
    h1 = await _login(client, ADMIN_E1)
    e2 = await _empresa_id(client, await _login(client, SUPER), "Planta de Alimentos")
    ots = (await client.get(f"/api/work-orders?empresa_id={e2}", headers=h1)).json()
    assert {o["empresa_nombre"] for o in ots} == {"Minera del Norte"}


async def test_catalogos_filtrados_por_empresa(client):
    h2 = await _login(client, ADMIN_E2)
    plantas = (await client.get("/api/plants", headers=h2)).json()
    maquinas = (await client.get("/api/machines", headers=h2)).json()
    tecnicos = (await client.get("/api/technicians", headers=h2)).json()
    assert {p["name"] for p in plantas} == {"Molienda SAG", "Chancado Primario"}
    assert len(maquinas) == 7
    assert {t["email"] for t in tecnicos} == {"tecnico1@alimentos.cl", "tecnico2@alimentos.cl"}


async def test_no_se_puede_crear_ot_con_maquina_o_tecnico_de_otra_empresa(client):
    # Supervisor de empresa 2 (el único rol que crea OT directas) con la máquina de la empresa 1 (id 1 = Chancador de cono Sandvik H8800).
    h = await _login(client, ("supervisor@alimentos.cl", "alimentos123"))
    r = await client.post(
        "/api/work-orders",
        headers=h,
        json={"maquina_id": 1, "tecnico_id": 4, "descripcion_problema": "x", "tipo": "corrective"},
    )
    assert r.status_code == 422


async def test_stats_y_topologia_solo_de_la_empresa(client):
    h2 = await _login(client, GERENTE_E2)
    stats = (await client.get("/api/stats/financial-impact", headers=h2)).json()
    assert {m["name"] for m in stats["machines"]} <= {
        "Molino SAG con motor Siemens", "Bomba de pulpa KSB", "Bomba de pulpa KSB", "Chancador de cono Sandvik H8800",
        "Chancador de cono Sandvik H8800", "Correa Overland", "Molino SAG con motor Siemens",
    }
    topo = (await client.get("/api/topology", headers=h2)).json()
    nombres = {n["nombre_visual"] for n in topo["nodos"]}
    assert "Chancador de cono Sandvik H8800" in nombres
    assert "Chancador de cono Sandvik H8800" not in nombres


# =============================================================================
# super_usuario
# =============================================================================

async def test_super_usuario_no_accede_a_datos_operativos(client):
    hs = await _login(client, SUPER)
    for url in (
        "/api/work-orders", "/api/work-orders/OT-2026-101", "/api/machines", "/api/plants", "/api/disciplines",
        "/api/technicians", "/api/topology", "/api/stats/financial-impact", "/api/documents",
    ):
        assert (await client.get(url, headers=hs)).status_code == 403, url
    assert (await client.post("/api/work-orders/stream/ticket", headers=hs)).status_code == 403
    assert (await client.post("/api/chat/stream", headers=hs, json={"message": "hola"})).status_code == 403
    ok = {"file": ("a.txt", io.BytesIO(b"hola mundo"), "text/plain")}
    assert (await client.post("/api/documents", headers=hs, files=ok)).status_code == 403


async def test_login_devuelve_empresa_y_super_no_tiene(client):
    r = await client.post("/api/auth/login", json={"email": ADMIN_E2[0], "password": ADMIN_E2[1]})
    assert r.json()["user"]["empresa_nombre"] == "Planta de Alimentos"
    r = await client.post("/api/auth/login", json={"email": SUPER[0], "password": SUPER[1]})
    user = r.json()["user"]
    assert user["role"] == "super_usuario" and user["empresa_id"] is None


async def test_empresa_suspendida_no_puede_iniciar_sesion(client):
    """Suspender la empresa debe cortar el login de sus usuarios.

    Se arma el escenario en la base (el seed crea las tres empresas activas) y se
    restaura en el `finally` para no contaminar el resto de la suite.
    """
    from barb.core.db import execute as _execute

    try:
        await _execute(
            "UPDATE empresa SET estado = 'suspended' WHERE rut = '77.333.333-3'"
        )
        r = await client.post(
            "/api/auth/login", json={"email": ADMIN_E3[0], "password": ADMIN_E3[1]}
        )
        assert r.status_code == 403, r.text
    finally:
        await _execute("UPDATE empresa SET estado = 'active' WHERE rut = '77.333.333-3'")


CAMPOS_ELIMINADOS = {"plan", "max_plantas", "licencia_inicio", "licencia_fin"}


async def test_la_api_de_empresas_ya_no_expone_plan_max_plantas_ni_licencias(client):
    """Esos datos no tenían lógica asociada: el formulario y la API dejaron de pedirlos y devolverlos."""
    hs = await _login(client, SUPER)
    empresas = (await client.get("/api/empresas", headers=hs)).json()
    assert empresas
    for e in empresas:
        assert not (CAMPOS_ELIMINADOS & set(e)), e
        assert {"empresa_id", "nombre", "estado", "max_usuarios"} <= set(e)


def test_los_esquemas_de_empresa_ignoran_los_campos_eliminados():
    from barb.schemas.empresas import EmpresaCreateRequest, EmpresaUpdateRequest

    crear = EmpresaCreateRequest(nombre="Acme", plan="starter", max_plantas=9, licencia_fin="2030-01-01")  # type: ignore[call-arg]
    assert not (CAMPOS_ELIMINADOS & set(crear.model_dump()))
    assert not (CAMPOS_ELIMINADOS & set(EmpresaUpdateRequest(plan="enterprise").model_dump(exclude_unset=True)))  # type: ignore[call-arg]


async def test_el_estado_demo_ya_no_existe(client, db_pool):
    hs = await _login(client, SUPER)
    empresa_id = (await client.get("/api/empresas", headers=hs)).json()[0]["empresa_id"]
    for estado in ("demo", "Demo"):
        r = await client.put(f"/api/empresas/{empresa_id}", headers=hs, json={"estado": estado})
        assert r.status_code == 422, estado
    r = await client.post("/api/empresas", headers=hs, json={"nombre": "No debe crearse", "estado": "demo"})
    assert r.status_code == 422
    # Tampoco queda como valor del tipo en la base (migración 0015).
    valores = {f["enumlabel"] for f in await fetch_all(
        "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'estado_empresa'")}
    assert valores == {"active", "suspended", "cancelled"}
    assert (await fetch_one("SELECT COUNT(*) AS n FROM empresa WHERE estado::text = 'demo'"))["n"] == 0


async def test_mantenedor_de_empresas_es_exclusivo_del_super(client):
    for creds in (ADMIN_E1, ADMIN_E2, ENGINEER_E1, OPERADOR_E1):
        h = await _login(client, creds)
        assert (await client.get("/api/empresas", headers=h)).status_code == 403
        assert (await client.post("/api/empresas", headers=h, json={"nombre": "Hack"})).status_code == 403
    hs = await _login(client, SUPER)
    assert (await client.get("/api/empresas", headers=hs)).status_code == 200


async def test_super_crea_edita_suspende_y_elimina_empresa_con_gerente_inicial(client):
    hs = await _login(client, SUPER)
    sufijo = uuid.uuid4().hex[:6]
    email_admin = f"gerente-{sufijo}@test.cl"
    r = await client.post(
        "/api/empresas",
        headers=hs,
        json={
            "nombre": f"Empresa Test {sufijo}",
            "rut": f"99.{sufijo}-K",
            "max_usuarios": 2,
            "gerente": {"nombre": "Gerente Test", "email": email_admin, "password": "secreto123"},
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

        # El gerente recién creado entra y solo ve su empresa (sin OTs)
        h_admin = await _login(client, (email_admin, "secreto123"))
        assert (await client.get("/api/work-orders", headers=h_admin)).json() == []

        # Límite de licencia: max_usuarios=2 -> segundo usuario ok, tercero 409 (el gerente solo crea administradores)
        ok = await client.post(
            "/api/usuarios", headers=h_admin,
            json={"nombre": "Admin Uno", "email": f"a1-{sufijo}@test.cl", "password": "secreto123", "rol": "admin"},
        )
        assert ok.status_code == 201 and ok.json()["empresa_id"] == eid
        lleno = await client.post(
            "/api/usuarios", headers=h_admin,
            json={"nombre": "Admin Dos", "email": f"a2-{sufijo}@test.cl", "password": "secreto123", "rol": "admin"},
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
        # Limpieza: el super_usuario solo gestiona gerentes, así que el gerente (reactivada la empresa)
        # elimina a los administradores y luego el super elimina al gerente y la empresa.
        await client.put(f"/api/empresas/{eid}", headers=hs, json={"estado": "active"})
        h_gerente = await _login(client, (email_admin, "secreto123"))
        for u in (await client.get("/api/usuarios", headers=h_gerente)).json():
            if u["email"] != email_admin:
                await client.delete(f"/api/usuarios/{u['usuario_id']}", headers=h_gerente)
        for u in (await client.get(f"/api/usuarios?empresa_id={eid}", headers=hs)).json():
            await client.delete(f"/api/usuarios/{u['usuario_id']}", headers=hs)
        assert (await client.delete(f"/api/empresas/{eid}", headers=hs)).status_code == 204


# =============================================================================
# Mantenedor de usuarios
# =============================================================================

async def test_admin_solo_ve_usuarios_de_su_empresa(client):
    h2 = await _login(client, ADMIN_E2)
    usuarios = (await client.get("/api/usuarios", headers=h2)).json()
    assert usuarios and {u["empresa_nombre"] for u in usuarios} == {"Planta de Alimentos"}
    assert "super_usuario" not in {u["rol"] for u in usuarios}


async def test_admin_no_puede_tocar_usuarios_de_otra_empresa_ni_crear_super(client):
    h1, h2 = await _login(client, ADMIN_E1), await _login(client, ADMIN_E2)
    pedro = next(u for u in (await client.get("/api/usuarios", headers=h2)).json() if u["email"] == TECNICO_E2[0])

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


async def test_super_solo_crea_y_gestiona_gerentes(client):
    hs = await _login(client, SUPER)
    e2 = await _empresa_id(client, hs, "Planta de Alimentos")
    base = {"nombre": "Gerente Nuevo", "password": "secreto123", "empresa_id": e2}

    # Otros perfiles (incluido otro super_usuario) -> 403
    for rol in ("admin", "tecnico", "supervisor", "super_usuario"):
        r = await client.post("/api/usuarios", headers=hs, json={**base, "email": f"x-{uuid.uuid4().hex[:6]}@x.cl", "rol": rol})
        assert r.status_code == 403, rol
    # Sin empresa -> 422
    sin_empresa = {k: v for k, v in base.items() if k != "empresa_id"}
    email = f"y-{uuid.uuid4().hex[:6]}@x.cl"
    r = await client.post("/api/usuarios", headers=hs, json={**sin_empresa, "email": email, "rol": "gerente"})
    assert r.status_code == 422

    r = await client.post("/api/usuarios", headers=hs, json={**base, "email": f"g-{uuid.uuid4().hex[:6]}@x.cl", "rol": "gerente"})
    assert r.status_code == 201, r.text
    nuevo = r.json()
    try:
        assert nuevo["rol"] == "gerente" and nuevo["empresa_id"] == e2
        # El aviso de bienvenida necesita quién creó el usuario y cuándo
        assert nuevo["creado_por"]["email"] == SUPER[0] and nuevo["creado_por"]["nombre"]
        assert nuevo["created_at"]
        # Solo ve gerentes; no puede editar a un técnico de la empresa
        assert {u["rol"] for u in (await client.get("/api/usuarios", headers=hs)).json()} == {"gerente"}
        h2 = await _login(client, ADMIN_E2)
        pedro = next(u for u in (await client.get("/api/usuarios", headers=h2)).json() if u["email"] == TECNICO_E2[0])
        assert (await client.put(f"/api/usuarios/{pedro['usuario_id']}", headers=hs, json={"nombre": "X Y"})).status_code == 404
        # No puede ascenderlo a otro perfil
        assert (await client.put(f"/api/usuarios/{nuevo['usuario_id']}", headers=hs, json={"rol": "admin"})).status_code == 403
    finally:
        await client.delete(f"/api/usuarios/{nuevo['usuario_id']}", headers=hs)


async def test_gerente_puede_gestionar_usuarios_de_su_empresa(client):
    hg = await _login(client, ("gerente@alimentos.cl", "alimentos123"))
    usuarios = (await client.get("/api/usuarios", headers=hg)).json()
    assert usuarios and {u["empresa_nombre"] for u in usuarios} == {"Planta de Alimentos"}
    assert {u["rol"] for u in usuarios} == {"admin"}
    r = await client.post(
        "/api/usuarios", headers=hg,
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
    e2 = await _empresa_id(client, hs, "Planta de Alimentos")
    email = f"cruce-{uuid.uuid4().hex[:6]}@x.cl"
    r = await client.post(
        "/api/usuarios", headers=h1,
        json={"nombre": "Cruce Empresa", "email": email, "password": "secreto123", "rol": "operador", "empresa_id": e2},
    )
    try:
        assert r.status_code == 201
        assert r.json()["empresa_nombre"] == "Minera del Norte"  # se ignora el empresa_id enviado
    finally:
        if r.status_code == 201:
            await client.delete(f"/api/usuarios/{r.json()['usuario_id']}", headers=h1)


async def test_nadie_se_modifica_a_si_mismo(client):
    """Con la gestión en cascada nadie alcanza su propio registro: se responde 404 (como a cualquier usuario fuera de alcance)."""
    for creds in (GERENTE_E1, ADMIN_E1):
        h = await _login(client, creds)
        yo = await fetch_one("SELECT usuario_id FROM usuario WHERE email = %(e)s", {"e": creds[0]})
        assert (await client.delete(f"/api/usuarios/{yo['usuario_id']}", headers=h)).status_code in (404, 409), creds[0]
        baja = await client.put(f"/api/usuarios/{yo['usuario_id']}", headers=h, json={"activo": False})
        assert baja.status_code in (404, 409)
        assert (await fetch_one("SELECT activo FROM usuario WHERE email = %(e)s", {"e": creds[0]}))["activo"] is True


async def test_admin_solo_gestiona_usuarios_operativos(client):
    """El admin gestiona los roles operativos; no a gerentes ni a otros administradores."""
    h = await _login(client, ADMIN_E1)
    roles_visibles = {u["rol"] for u in (await client.get("/api/usuarios", headers=h)).json()}
    assert roles_visibles <= {"operador", "tecnico", "supervisor", "engineer"}
    assert "gerente" not in roles_visibles and "admin" not in roles_visibles

    base = {"nombre": "Intento", "password": "secreto123"}
    for rol in ("gerente", "admin"):
        r = await client.post("/api/usuarios", headers=h, json={**base, "email": f"x-{uuid.uuid4().hex[:6]}@x.cl", "rol": rol})
        assert r.status_code == 403, rol

    # No toca a un gerente existente: 404, como si no existiera.
    gerente = await fetch_one("SELECT usuario_id FROM usuario WHERE email = %(e)s", {"e": GERENTE_E1[0]})
    assert (await client.put(f"/api/usuarios/{gerente['usuario_id']}", headers=h, json={"nombre": "X Y"})).status_code == 404
    assert (await client.delete(f"/api/usuarios/{gerente['usuario_id']}", headers=h)).status_code == 404


async def test_gerente_solo_gestiona_administradores(client):
    """Cascada: el gerente crea, ve, edita y elimina únicamente administradores de su empresa."""
    hg = await _login(client, GERENTE_E1)
    roles = {u["rol"] for u in (await client.get("/api/usuarios", headers=hg)).json()}
    assert roles == {"admin"}

    base = {"nombre": "Intento", "password": "secreto123"}
    for rol in ("operador", "tecnico", "supervisor", "engineer", "gerente", "super_usuario"):
        r = await client.post("/api/usuarios", headers=hg, json={**base, "email": f"x-{uuid.uuid4().hex[:6]}@x.cl", "rol": rol})
        assert r.status_code == 403, rol

    # No ve ni toca a un usuario operativo ni a otro gerente: 404, como si no existiera.
    operativo = await fetch_one("SELECT usuario_id FROM usuario WHERE email = %(e)s", {"e": OPERADOR_E1[0]})
    assert (await client.put(f"/api/usuarios/{operativo['usuario_id']}", headers=hg, json={"nombre": "X Y"})).status_code == 404
    assert (await client.delete(f"/api/usuarios/{operativo['usuario_id']}", headers=hg)).status_code == 404

    # Sí crea, edita y elimina un administrador.
    r = await client.post("/api/usuarios", headers=hg, json={**base, "email": f"adm-{uuid.uuid4().hex[:6]}@x.cl", "rol": "admin"})
    assert r.status_code == 201, r.text
    nuevo = r.json()
    try:
        assert nuevo["rol"] == "admin"
        r = await client.put(f"/api/usuarios/{nuevo['usuario_id']}", headers=hg, json={"nombre": "Admin Renombrado"})
        assert r.status_code == 200 and r.json()["nombre"] == "Admin Renombrado"
        # No puede ascender al administrador a otro perfil.
        assert (await client.put(f"/api/usuarios/{nuevo['usuario_id']}", headers=hg, json={"rol": "gerente"})).status_code == 403
    finally:
        assert (await client.delete(f"/api/usuarios/{nuevo['usuario_id']}", headers=hg)).status_code == 204


async def test_no_se_pierde_al_ultimo_supervisor_activo_de_la_empresa(client):
    """Minera Norte tiene un único supervisor: no se puede desactivar, eliminar ni cambiarle el rol (409)."""
    h = await _login(client, ADMIN_E2)
    unico = await fetch_one("SELECT usuario_id FROM usuario WHERE email = %(e)s", {"e": SUPERVISOR_E2[0]})
    url = f"/api/usuarios/{unico['usuario_id']}"
    assert (await fetch_one("SELECT COUNT(*) AS n FROM usuario WHERE rol = 'supervisor' AND activo AND empresa_id = "
                            "(SELECT empresa_id FROM usuario WHERE usuario_id = %(i)s)", {"i": unico["usuario_id"]}))["n"] == 1
    for cambio in ({"activo": False}, {"rol": "tecnico"}):
        r = await client.put(url, headers=h, json=cambio)
        assert r.status_code == 409, cambio
        assert "último supervisor" in r.json()["detail"]
    assert (await client.delete(url, headers=h)).status_code == 409
    fila = await fetch_one("SELECT rol, activo FROM usuario WHERE usuario_id = %(i)s", {"i": unico["usuario_id"]})
    assert (fila["rol"], fila["activo"]) == ("supervisor", True)
    # Editar otros datos del supervisor sí se puede.
    assert (await client.put(url, headers=h, json={"nombre": "Diego Fuentes"})).status_code == 200


async def test_con_otro_supervisor_activo_se_puede_desactivar_y_eliminar(client):
    h = await _login(client, ADMIN_E1)
    r = await client.post(
        "/api/usuarios", headers=h,
        json={
            "nombre": "Supervisor Temporal",
            "email": f"sup-{uuid.uuid4().hex[:6]}@x.cl",
            "password": "secreto123",
            "rol": "supervisor",
        },
    )
    assert r.status_code == 201, r.text
    nuevo = r.json()
    try:
        assert (await client.put(f"/api/usuarios/{nuevo['usuario_id']}", headers=h, json={"activo": False})).status_code == 200
    finally:
        assert (await client.delete(f"/api/usuarios/{nuevo['usuario_id']}", headers=h)).status_code == 204


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
    assert {d["empresa_nombre"] for d in d1} == {"Minera del Norte"}
    assert {d["empresa_nombre"] for d in d2} == {"Planta de Alimentos"}
    assert any(d["title"] == "Manual Chancador de cono Sandvik H8800" for d in d2)
    assert not any(d["title"] == "Manual Chancador de cono Sandvik H8800" for d in d1)


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
        e2 = await _empresa_id(client, hs, "Planta de Alimentos")

        assert [c["title"] for c in await docs.search_chunks(e1, clave)] == ["Doc de prueba"]
        assert await docs.search_chunks(e2, clave) == []  # otra empresa: nada

        # Desactivado => la IA deja de usarlo, sin borrarlo
        await client.patch(f"/api/documents/{doc['id']}", headers=h1, json={"activo": False})
        assert await docs.search_chunks(e1, clave) == []
    finally:
        assert (await client.delete(f"/api/documents/{doc['id']}", headers=h1)).status_code == 204
    assert (await client.get("/api/documents", headers=h1)).json()  # sigue funcionando


async def test_subida_rechaza_tipo_y_archivo_vacio(client):
    h1 = await _login(client, ENGINEER_E1)
    exe = {"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")}
    assert (await client.post("/api/documents", headers=h1, files=exe)).status_code == 415
    vacio = {"file": ("v.txt", io.BytesIO(b""), "text/plain")}
    assert (await client.post("/api/documents", headers=h1, files=vacio)).status_code == 422


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
    """Sustituto de `chat.astream_respuesta` (HU-04 Fase 2).

    Antes se parcheaba `create_conversation_chain`; ahora el router invoca una función
    que devuelve el generador, así que el doble registra los kwargs y se puede iterar.
    """

    def __init__(self, textos: list[str] | None = None):
        self.payload = None
        self.textos = textos if textos is not None else ["respuesta basada en docs"]

    def __call__(self, **kwargs):
        self.payload = kwargs
        return self._generar()

    async def _generar(self):
        for texto in self.textos:
            yield texto


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


async def test_chat_sin_documentacion_responde_la_frase_fija(client, user_chat, repo_mock):
    """
    Sin documentación y sin herramienta aplicable, el usuario NO recibe una invención.

    Cambio de contrato (HU-04 Fase 2): antes, «sin documentos» cortaba antes de llamar al
    LLM. Con las Skills eso ya no puede ser así — una pregunta sobre OTs reales no tiene
    por qué tener un manual que la respalde. La garantía se movió: el grafo SÍ se invoca,
    pero si no produce texto (el modelo no encontró respaldo documental ni de herramientas)
    el router responde la frase fija. Este test cubre esa red de seguridad.
    """
    user_chat()
    with patch("barb.routers.chat.astream_respuesta", new=_Chain(textos=[])):
        status, raw = await _stream(client, {"message": "¿Cuál es la capital de Francia?"})
    assert status == 200
    textos = [json.loads(ln[5:])["text"] for ln in raw.splitlines() if ln.startswith("data:") and "text" in ln]
    assert "".join(textos) == NO_DOCS_ANSWER
    # la respuesta fija también queda persistida en el historial
    guardados = repo_mock.call_args.args[2]
    assert guardados[1]["content"] == NO_DOCS_ANSWER


async def test_chat_usa_la_empresa_de_la_sesion_para_el_rag(client, user_chat, repo_mock):
    """Aislamiento multi-empresa: el grafo recibe la empresa del usuario, no la del body."""
    user_chat(empresa_id=2)
    chain = _Chain()
    with patch("barb.routers.chat.astream_respuesta", new=chain):
        status, raw = await _stream(client, {"message": "setting del chancador", "empresa_id": 1})
    assert status == 200 and "respuesta basada en docs" in raw
    # La empresa viaja al grafo, que es quien hace ahora el retrieval.
    assert chain.payload["empresa_id"] == 2
    # Y el mensaje va como primera pista de búsqueda.
    assert chain.payload["pistas"][0] == "setting del chancador"


async def test_chat_super_usuario_no_tiene_acceso(client, user_chat, repo_mock):
    user_chat(role="super_usuario", empresa_id=None)
    with patch("barb.routers.chat.search_chunks", return_value=[]) as search:
        status, _ = await _stream(client, {"message": "hola", "empresa_id": 2})
    assert status == 403
    search.assert_not_called()
