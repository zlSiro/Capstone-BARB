from __future__ import annotations

import pytest
from fastapi import HTTPException

from barb.core.permissions import (
    ACCIONES,
    ROLES,
    ROLES_GESTIONABLES_POR_ADMIN,
    ROLES_GESTIONABLES_POR_GERENTE,
    ROLES_REPOSITORIO_AVISOS,
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
    """El admin accede a las pantallas de gobierno; no a la bitácora, a los avisos, al dashboard ni al historial."""
    sin_acceso = RUTAS_SOLO_SUPER | RUTAS_SOLO_GERENTE | {"avisos", "dashboard", "history"}
    for ruta in RUTAS:
        assert RUTAS[ruta]["admin"] is (ruta not in sin_acceso), ruta


def test_el_gerente_consulta_pero_no_opera_ni_configura():
    """Gerente: ve OT, dashboard, historial, avisos, usuarios y su bitácora; documentos solo en lectura; sin mantenedores."""
    assert RUTAS["documentos"]["gerente"] == "ver"
    assert RUTAS["plantas"]["gerente"] is False
    assert RUTAS["notificaciones"]["gerente"] is False
    for ruta in ("menu", "dashboard", "history", "avisos", "usuarios", "transacciones_empresa"):
        assert RUTAS[ruta]["gerente"] is True, ruta
    for accion in ("cambiar_estado_ot", "cancelar_ot", "eliminar_ot", "gestionar_avisos", "asignar_ot", "subir_documentos",
                   "eliminar_documentos", "configurar_notificaciones"):
        assert ACCIONES[accion]["gerente"] is False, accion
    # Sí reporta fallas y gestiona (a los administradores) usuarios.
    assert ACCIONES["reportar_falla"]["gerente"] is True
    assert ACCIONES["gestionar_usuarios"]["gerente"] is True and ACCIONES["ver_usuarios"]["gerente"] is True


def test_el_ingeniero_no_cambia_estados_pero_si_gestiona_documentos():
    assert ACCIONES["cambiar_estado_ot"]["engineer"] is False
    assert ACCIONES["subir_documentos"]["engineer"] is True and ACCIONES["eliminar_documentos"]["engineer"] is True
    assert RUTAS["history"]["engineer"] is True and RUTAS["dashboard"]["engineer"] is True


def test_documentos_los_suben_solo_ingeniero_y_admin():
    for accion in ("subir_documentos", "eliminar_documentos"):
        assert {r for r in ROLES if puede_ejecutar_accion(r, accion)} == {"engineer", "admin"}, accion


def test_notificaciones_las_configuran_supervisor_y_admin():
    assert {r for r in ROLES if puede_ejecutar_accion(r, "configurar_notificaciones")} == {"supervisor", "admin"}
    assert {r for r in ROLES if puede_acceder_ruta(r, "notificaciones") is True} == {"supervisor", "admin"}


def test_gestion_de_usuarios_en_cascada():
    """super_usuario -> gerente -> admin -> operativos: cada perfil gestiona solo al nivel siguiente."""
    assert ROLES_GESTIONABLES_POR_GERENTE == {"admin"}
    assert ROLES_GESTIONABLES_POR_ADMIN == {"operador", "tecnico", "supervisor", "engineer"}
    assert ROLES_GESTIONABLES_POR_GERENTE.isdisjoint(ROLES_GESTIONABLES_POR_ADMIN)
    assert {r for r in ROLES if puede_ejecutar_accion(r, "gestionar_usuarios")} == {"gerente", "admin", "super_usuario"}


def test_el_repositorio_de_avisos_lo_ven_supervisor_y_gerente_pero_solo_el_supervisor_decide():
    assert ROLES_REPOSITORIO_AVISOS == {"supervisor", "gerente"}
    assert {r for r in ROLES if puede_ejecutar_accion(r, "gestionar_avisos")} == {"supervisor"}


ACCIONES_ESPERADAS = {
    "crear_ot": {"supervisor"},
    "cambiar_estado_ot": {"supervisor"},
    "cancelar_ot": {"supervisor"},
    "eliminar_ot": set(),
    "reportar_falla": {"operador", "tecnico", "supervisor", "engineer", "gerente"},
    "gestionar_avisos": {"supervisor"},
    "asignar_ot": {"supervisor"},
    "iniciar_ot_asignada": {"tecnico"},
    "enviar_a_validacion": {"tecnico", "supervisor"},
    "validar_ot": {"supervisor"},
    "ver_kpis_financieros": {"gerente"},
}


@pytest.mark.parametrize("accion", sorted(ACCIONES_ESPERADAS))
def test_acciones_del_ciclo_de_la_ot_por_rol(accion):
    con_permiso = {rol for rol in ROLES if puede_ejecutar_accion(rol, accion)}
    assert con_permiso == ACCIONES_ESPERADAS[accion], accion


def test_admin_no_opera_ordenes_de_trabajo():
    for accion in ACCIONES_ESPERADAS:
        assert puede_ejecutar_accion("admin", accion) is False, accion


def test_ningun_perfil_elimina_ot():
    """D1: el endpoint DELETE se mantiene pero responde 403 por permisos para todos los roles."""
    assert [r for r in ROLES if puede_ejecutar_accion(r, "eliminar_ot")] == []


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
