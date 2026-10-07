"""Máquina de estados de las órdenes de trabajo (OT).

Única fuente de verdad de qué transiciones existen y qué acción de `ACCIONES`
exige cada estado destino. El frontend no duplica estas reglas: el backend
entrega en cada OT la lista `allowed_transitions` ya filtrada por rol.

    pending ──► in_progress ──► completed (cerrada)
       │             │
       └─────────────┴────────► cancelled

`assigned` y `overdue` son estados heredados del esquema: se tratan como
«pendiente» (pueden iniciarse o cancelarse). `completed` y `cancelled` son
finales: no admiten más cambios.
"""

from __future__ import annotations

from barb.core.permissions import puede_ejecutar_accion

ESTADO_PENDIENTE = "pending"
ESTADO_EN_CURSO = "in_progress"
ESTADO_CERRADA = "completed"
ESTADO_CANCELADA = "cancelled"

TRANSICIONES: dict[str, tuple[str, ...]] = {
    "pending": (ESTADO_EN_CURSO, ESTADO_CANCELADA),
    "assigned": (ESTADO_EN_CURSO, ESTADO_CANCELADA),
    "overdue": (ESTADO_EN_CURSO, ESTADO_CANCELADA),
    "in_progress": (ESTADO_CERRADA, ESTADO_CANCELADA),
    "completed": (),
    "cancelled": (),
}

ESTADOS_FINALES = frozenset(e for e, destinos in TRANSICIONES.items() if not destinos)

ETIQUETA_ES: dict[str, str] = {
    "pending": "Pendiente",
    "assigned": "Asignada",
    "in_progress": "En curso",
    "completed": "Cerrada",
    "cancelled": "Cancelada",
    "overdue": "Vencida",
}

# Acción de ACCIONES exigida para entrar a cada estado destino.
# Cancelar es más restrictivo que avanzar el trabajo.
ACCION_POR_DESTINO: dict[str, str] = {
    ESTADO_EN_CURSO: "cambiar_estado_ot",
    ESTADO_CERRADA: "cambiar_estado_ot",
    ESTADO_CANCELADA: "cancelar_ot",
}


def transiciones_posibles(estado_actual: str) -> tuple[str, ...]:
    """Destinos válidos según la máquina de estados, sin considerar roles."""
    return TRANSICIONES.get(estado_actual, ())


def rol_puede_ir_a(rol: str, destino: str) -> bool:
    accion = ACCION_POR_DESTINO.get(destino)
    return accion is not None and puede_ejecutar_accion(rol, accion)


def transiciones_permitidas(estado_actual: str, rol: str | None) -> list[str]:
    """Destinos válidos que además el rol puede ejecutar."""
    if rol is None:
        return []
    return [d for d in transiciones_posibles(estado_actual) if rol_puede_ir_a(rol, d)]
