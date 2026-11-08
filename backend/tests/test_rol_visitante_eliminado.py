"""El perfil «visitante» ya no existe: ni en el código, ni en la API, ni en la base (migración 0013).

Estas pruebas no escriben datos: lo que intentan crear lo rechaza el backend o la base antes de insertar.
"""
from __future__ import annotations

import psycopg.errors
import pytest
from fastapi import HTTPException

from barb.core.db import execute, fetch_one
from barb.core.permissions import ACCIONES, ROLES, ROLES_GESTIONABLES_POR_ADMIN, RUTAS, puede_ejecutar_accion

ADMIN_E1 = {"email": "admin@barb.com", "password": "admin123"}
SUPER = {"email": "super@barb.com", "password": "super123"}

ROLES_VIGENTES = {"operador", "tecnico", "supervisor", "engineer", "gerente", "admin", "super_usuario"}


async def _headers(client, creds: dict) -> dict:
    r = await client.post("/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


# --- código -------------------------------------------------------------------------------------------------------

def test_los_roles_vigentes_son_siete_y_sin_visitante():
    assert set(ROLES) == ROLES_VIGENTES
    assert len(ROLES) == len(ROLES_VIGENTES)


def test_ninguna_matriz_menciona_al_visitante():
    for nombre, matriz in (("RUTAS", RUTAS), ("ACCIONES", ACCIONES)):
        for clave, por_rol in matriz.items():
            assert set(por_rol) == ROLES_VIGENTES, f"{nombre}[{clave}] debe tener exactamente los 7 roles"
    assert "visitante" not in ROLES_GESTIONABLES_POR_ADMIN


@pytest.mark.parametrize("accion", sorted(ACCIONES))
def test_un_rol_visitante_es_un_rol_desconocido(accion):
    """Si un token con ese rol existiera, la matriz lo trata como rol desconocido: 403, sin permiso para nada."""
    with pytest.raises(HTTPException) as e:
        puede_ejecutar_accion("visitante", accion)
    assert e.value.status_code == 403


# --- API ----------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("creds", [ADMIN_E1, SUPER])
async def test_la_api_rechaza_crear_un_usuario_visitante(client, creds):
    resp = await client.post(
        "/api/usuarios",
        json={"nombre": "Intento", "email": "intento.visitante@planta.com", "password": "secreto123", "rol": "visitante"},
        headers=await _headers(client, creds),
    )
    assert resp.status_code == 422
    assert "visitante" in resp.json()["detail"]
    assert "Permitidos" in resp.json()["detail"]


async def test_el_formulario_de_roles_del_backend_no_ofrece_visitante(client):
    resp = await client.get("/api/transacciones/filtros", headers=await _headers(client, SUPER))
    assert resp.status_code == 200, resp.text
    assert "visitante" not in resp.json()["roles"]


# --- base de datos ------------------------------------------------------------------------------------------------

async def test_no_queda_ningun_usuario_visitante(db_pool):
    fila = await fetch_one("SELECT count(*) AS n FROM usuario WHERE rol = 'visitante'")
    assert fila["n"] == 0


async def test_la_base_rechaza_el_rol_visitante(db_pool):
    """`ck_usuario_rol_valido` (migración 0013): la base misma impide volver a crear un visitante."""
    with pytest.raises(psycopg.errors.CheckViolation):
        await execute(
            "INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol) "
            "VALUES (1, 'Intento', 'no-debe-existir@planta.com', 'x', 'visitante')"
        )
    assert (await fetch_one("SELECT count(*) AS n FROM usuario WHERE email = 'no-debe-existir@planta.com'"))["n"] == 0


async def test_la_restriccion_admite_los_siete_roles_vigentes(db_pool):
    fila = await fetch_one("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'ck_usuario_rol_valido'")
    assert fila is not None
    for rol in ROLES_VIGENTES:
        assert f"'{rol}'" in fila["d"]
    assert "visitante" not in fila["d"]
