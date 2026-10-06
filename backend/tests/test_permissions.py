from __future__ import annotations

import pytest
from fastapi import HTTPException

from barb.core.permissions import (
    ACCIONES,
    ROLES,
    RUTAS,
    puede_acceder_ruta,
    puede_ejecutar_accion,
)


def test_todas_las_rutas_cubren_todos_los_roles():
    for ruta, matriz in RUTAS.items():
        assert set(matriz.keys()) == set(ROLES), f"Ruta '{ruta}' no cubre todos los roles"


def test_todas_las_acciones_cubren_todos_los_roles():
    for accion, matriz in ACCIONES.items():
        assert set(matriz.keys()) == set(ROLES), f"Acción '{accion}' no cubre todos los roles"


# Rutas de administración de la plataforma: exclusivas del super_usuario (ver test_multiempresa.py).
RUTAS_SOLO_SUPER = {"empresas"}


def test_admin_tiene_acceso_total_a_rutas():
    for ruta in RUTAS:
        esperado = ruta not in RUTAS_SOLO_SUPER
        assert puede_acceder_ruta("admin", ruta) is esperado


def test_visitante_no_puede_crear_ot():
    assert puede_ejecutar_accion("visitante", "crear_ot") is False


def test_solo_gerente_y_admin_crean_ot():
    for rol, esperado in ACCIONES["crear_ot"].items():
        assert puede_ejecutar_accion(rol, "crear_ot") == esperado


def test_rol_desconocido_lanza_403():
    with pytest.raises(HTTPException) as exc_info:
        puede_acceder_ruta("hacker", "dashboard")
    assert exc_info.value.status_code == 403


def test_ruta_no_definida_lanza_500():
    with pytest.raises(HTTPException) as exc_info:
        puede_acceder_ruta("admin", "ruta-inexistente")
    assert exc_info.value.status_code == 500
