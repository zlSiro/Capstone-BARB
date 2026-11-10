"""Tests unitarios de la máquina de estados de OT y de sus permisos por rol (sin BD ni HTTP)."""
from __future__ import annotations

import pytest

from barb.core.permissions import ROLES, puede_ejecutar_accion
from barb.core.work_order_states import (
    ACCION_POR_DESTINO,
    ESTADOS_FINALES,
    ETIQUETA_ES,
    TRANSICIONES,
    exige_comentario,
    rol_puede_ir_a,
    transiciones_permitidas,
    transiciones_posibles,
)

ESTADOS_DB = {"pending", "assigned", "in_progress", "por_validar", "completed", "cancelled", "overdue"}


def test_todos_los_estados_estan_definidos():
    assert set(TRANSICIONES) == ESTADOS_DB


def test_flujo_principal_pendiente_en_curso_por_validar_cerrada():
    assert "in_progress" in transiciones_posibles("pending")
    assert "por_validar" in transiciones_posibles("in_progress")
    assert "completed" in transiciones_posibles("por_validar")


def test_en_curso_ya_no_se_cierra_directo():
    assert "completed" not in transiciones_posibles("in_progress")


def test_por_validar_se_puede_devolver_validar_o_cancelar():
    assert transiciones_posibles("por_validar") == ("completed", "in_progress", "cancelled")


def test_por_validar_es_un_estado_activo_con_etiqueta():
    assert "por_validar" not in ESTADOS_FINALES
    assert ETIQUETA_ES["por_validar"] == "Por validar"
    assert ACCION_POR_DESTINO["por_validar"] == "enviar_a_validacion"
    assert ACCION_POR_DESTINO["completed"] == "validar_ot"


@pytest.mark.parametrize(
    ("origen", "destino", "esperado"),
    [
        ("pending", "cancelled", True),
        ("in_progress", "cancelled", True),
        ("por_validar", "cancelled", True),
        ("por_validar", "in_progress", True),  # devolución
        ("pending", "in_progress", False),
        ("in_progress", "por_validar", False),
        ("por_validar", "completed", False),
    ],
)
def test_cancelar_y_devolver_exigen_comentario(origen, destino, esperado):
    assert exige_comentario(origen, destino) is esperado


def test_no_se_puede_cerrar_sin_pasar_por_en_curso():
    assert "completed" not in transiciones_posibles("pending")


def test_no_se_puede_volver_atras():
    assert "pending" not in transiciones_posibles("in_progress")


@pytest.mark.parametrize("estado", ["pending", "assigned", "overdue", "in_progress", "por_validar"])
def test_estados_activos_se_pueden_cancelar(estado):
    assert "cancelled" in transiciones_posibles(estado)


@pytest.mark.parametrize("estado", ["completed", "cancelled"])
def test_estados_finales_no_tienen_salida(estado):
    assert estado in ESTADOS_FINALES
    assert transiciones_posibles(estado) == ()


def test_estado_desconocido_no_tiene_transiciones():
    assert transiciones_posibles("inventado") == ()


@pytest.mark.parametrize("rol", ["tecnico", "operador"])
def test_roles_sin_permiso_no_cambian_estado(rol):
    assert puede_ejecutar_accion(rol, "cambiar_estado_ot") is False
    assert transiciones_permitidas("pending", rol) == []
    assert transiciones_permitidas("in_progress", rol) == []


def test_supervisor_puede_avanzar_y_cancelar():
    assert transiciones_permitidas("pending", "supervisor") == ["in_progress", "cancelled"]
    assert transiciones_permitidas("in_progress", "supervisor") == ["por_validar", "cancelled"]
    assert transiciones_permitidas("por_validar", "supervisor") == ["completed", "in_progress", "cancelled"]


def test_quien_envio_a_validacion_si_puede_validarla():
    """Sin bloqueo de autovalidación: el supervisor que envió la OT también puede cerrarla."""
    assert rol_puede_ir_a("supervisor", "completed", origen="por_validar") is True
    assert transiciones_permitidas("por_validar", "supervisor") == ["completed", "in_progress", "cancelled"]


@pytest.mark.parametrize("rol", ["engineer", "gerente", "admin"])
def test_engineer_gerente_y_admin_consultan_pero_no_cambian_estados(rol):
    for estado in ("pending", "assigned", "overdue", "in_progress", "por_validar"):
        assert transiciones_permitidas(estado, rol) == [], (rol, estado)
    for destino in ("in_progress", "por_validar", "completed", "cancelled"):
        assert rol_puede_ir_a(rol, destino) is False, (rol, destino)


def test_sin_rol_no_hay_transiciones():
    assert transiciones_permitidas("pending", None) == []


def test_destino_manual_no_soportado_se_rechaza():
    # `overdue`/`pending` no son destinos que un usuario pueda elegir.
    for rol in ROLES:
        assert rol_puede_ir_a(rol, "overdue") is False
        assert rol_puede_ir_a(rol, "pending") is False


def test_el_tecnico_responsable_puede_iniciar_pero_no_cerrar_ni_cancelar():
    assert rol_puede_ir_a("tecnico", "in_progress", es_responsable=True) is True
    assert rol_puede_ir_a("tecnico", "completed", es_responsable=True) is False
    assert rol_puede_ir_a("tecnico", "cancelled", es_responsable=True) is False
    assert transiciones_permitidas("pending", "tecnico", es_responsable=True) == ["in_progress"]
    assert transiciones_permitidas("in_progress", "tecnico", es_responsable=True) == ["por_validar"]
    assert transiciones_permitidas("por_validar", "tecnico", es_responsable=True) == []  # no valida ni devuelve


def test_el_tecnico_solo_envia_a_validacion_su_propia_ot():
    assert rol_puede_ir_a("tecnico", "por_validar", es_responsable=True) is True
    assert rol_puede_ir_a("tecnico", "por_validar", es_responsable=False) is False
    assert transiciones_permitidas("in_progress", "tecnico", es_responsable=False) == []


def test_el_supervisor_envia_a_validacion_aunque_no_sea_el_asignado():
    assert rol_puede_ir_a("supervisor", "por_validar", es_responsable=False) is True


def test_el_tecnico_que_no_es_responsable_no_puede_iniciar():
    assert rol_puede_ir_a("tecnico", "in_progress", es_responsable=False) is False
    assert transiciones_permitidas("pending", "tecnico") == []


@pytest.mark.parametrize("rol", ["operador", "admin", "engineer", "gerente"])
def test_ser_responsable_no_da_permiso_a_otros_roles(rol):
    assert transiciones_permitidas("pending", rol, es_responsable=True) == []
    assert transiciones_permitidas("in_progress", rol, es_responsable=True) == []


def test_el_admin_ya_no_cambia_estados():
    assert transiciones_permitidas("pending", "admin") == []
    assert transiciones_permitidas("in_progress", "admin") == []
