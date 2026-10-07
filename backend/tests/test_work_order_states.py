"""Tests unitarios de la máquina de estados de OT y de sus permisos por rol (sin BD ni HTTP)."""
from __future__ import annotations

import pytest

from barb.core.permissions import ROLES, puede_ejecutar_accion
from barb.core.work_order_states import (
    ESTADOS_FINALES,
    TRANSICIONES,
    rol_puede_ir_a,
    transiciones_permitidas,
    transiciones_posibles,
)

ESTADOS_DB = {"pending", "assigned", "in_progress", "completed", "cancelled", "overdue"}


def test_todos_los_estados_estan_definidos():
    assert set(TRANSICIONES) == ESTADOS_DB


def test_flujo_principal_pendiente_en_curso_cerrada():
    assert "in_progress" in transiciones_posibles("pending")
    assert "completed" in transiciones_posibles("in_progress")


def test_no_se_puede_cerrar_sin_pasar_por_en_curso():
    assert "completed" not in transiciones_posibles("pending")


def test_no_se_puede_volver_atras():
    assert "pending" not in transiciones_posibles("in_progress")


@pytest.mark.parametrize("estado", ["pending", "assigned", "overdue", "in_progress"])
def test_estados_activos_se_pueden_cancelar(estado):
    assert "cancelled" in transiciones_posibles(estado)


@pytest.mark.parametrize("estado", ["completed", "cancelled"])
def test_estados_finales_no_tienen_salida(estado):
    assert estado in ESTADOS_FINALES
    assert transiciones_posibles(estado) == ()


def test_estado_desconocido_no_tiene_transiciones():
    assert transiciones_posibles("inventado") == ()


@pytest.mark.parametrize("rol", ["tecnico", "operador", "visitante"])
def test_roles_sin_permiso_no_cambian_estado(rol):
    assert puede_ejecutar_accion(rol, "cambiar_estado_ot") is False
    assert transiciones_permitidas("pending", rol) == []
    assert transiciones_permitidas("in_progress", rol) == []


def test_supervisor_puede_avanzar_y_cancelar():
    assert transiciones_permitidas("pending", "supervisor") == ["in_progress", "cancelled"]
    assert transiciones_permitidas("in_progress", "supervisor") == ["completed", "cancelled"]


def test_engineer_avanza_pero_no_cancela():
    assert rol_puede_ir_a("engineer", "in_progress") is True
    assert rol_puede_ir_a("engineer", "completed") is True
    assert rol_puede_ir_a("engineer", "cancelled") is False
    assert transiciones_permitidas("pending", "engineer") == ["in_progress"]


def test_sin_rol_no_hay_transiciones():
    assert transiciones_permitidas("pending", None) == []


def test_destino_manual_no_soportado_se_rechaza():
    # `overdue`/`pending` no son destinos que un usuario pueda elegir.
    for rol in ROLES:
        assert rol_puede_ir_a(rol, "overdue") is False
        assert rol_puede_ir_a(rol, "pending") is False
