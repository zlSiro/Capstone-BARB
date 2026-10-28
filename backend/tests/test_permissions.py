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
RUTAS_SOLO_SUPER = {"empresas", "transacciones"}
# Rutas exclusivas del gerente (su bitácora de empresa): tampoco las tiene el admin.
RUTAS_SOLO_GERENTE = {"transacciones_empresa"}


def test_super_usuario_solo_tiene_empresas_usuarios_y_transacciones():
    assert {r for r in RUTAS if puede_acceder_ruta("super_usuario", r)} == {"empresas", "usuarios", "transacciones"}


def test_admin_gobierna_el_sistema_pero_no_opera_el_mantenimiento():
    """El admin accede a las pantallas de gobierno; no a la bitácora, a los avisos ni (salvo lectura) al historial."""
    sin_acceso = RUTAS_SOLO_SUPER | RUTAS_SOLO_GERENTE | {"avisos"}
    for ruta in RUTAS:
        permiso = RUTAS[ruta]["admin"]
        if ruta in sin_acceso:
            assert permiso is False, ruta
        elif ruta == "history":
            assert permiso == "ver"
        else:
            assert permiso is True, ruta


def test_visitante_no_puede_crear_ot():
    assert puede_ejecutar_accion("visitante", "crear_ot") is False


def test_visitante_no_gana_ninguna_accion_nueva():
    for accion in ACCIONES_ESPERADAS:
        assert puede_ejecutar_accion("visitante", accion) is False, accion


# Quién puede ejecutar cada acción del ciclo de la OT (matriz de roles y privilegios).
ACCIONES_ESPERADAS = {
    "crear_ot": {"supervisor", "gerente"},
    "cambiar_estado_ot": {"supervisor", "engineer", "gerente"},
    "cancelar_ot": {"supervisor", "gerente"},
    "eliminar_ot": {"gerente"},
    "reportar_falla": {"operador", "tecnico", "supervisor", "engineer", "gerente"},
    "gestionar_avisos": {"supervisor", "gerente"},
    "asignar_ot": {"supervisor", "gerente"},
    "iniciar_ot_asignada": {"tecnico"},
}


@pytest.mark.parametrize("accion", sorted(ACCIONES_ESPERADAS))
def test_acciones_del_ciclo_de_la_ot_por_rol(accion):
    con_permiso = {rol for rol in ROLES if puede_ejecutar_accion(rol, accion)}
    assert con_permiso == ACCIONES_ESPERADAS[accion], accion


def test_admin_no_opera_ordenes_de_trabajo():
    for accion in ACCIONES_ESPERADAS:
        assert puede_ejecutar_accion("admin", accion) is False, accion


def test_solo_el_gerente_elimina_ot():
    assert [r for r in ROLES if puede_ejecutar_accion(r, "eliminar_ot")] == ["gerente"]


def test_avisos_los_ven_quienes_reportan_y_no_el_admin_ni_el_super():
    for rol in ROLES:
        esperado = rol in {"operador", "tecnico", "supervisor", "engineer", "gerente"}
        assert puede_acceder_ruta(rol, "avisos") is esperado, rol


def test_rol_desconocido_lanza_403():
    with pytest.raises(HTTPException) as exc_info:
        puede_acceder_ruta("hacker", "dashboard")
    assert exc_info.value.status_code == 403


def test_ruta_no_definida_lanza_500():
    with pytest.raises(HTTPException) as exc_info:
        puede_acceder_ruta("admin", "ruta-inexistente")
    assert exc_info.value.status_code == 500
