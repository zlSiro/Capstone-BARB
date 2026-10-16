"""Máquina de estados de los tickets conversacionales (HU-06).

Única fuente de verdad de qué transiciones existen y qué acción de `ACCIONES`
exige cada estado destino. Espejo de `core/work_order_states.py` (las OT), con
la regla propia de HU-06: el dueño puede avanzar su ticket sin la acción
general, pero NUNCA cancelarlo (cancelar es más restrictivo, como en OT).

    open ──► in_progress ──► resolved (final)
      │             │
      └─────────────┴────────► cancelled (final)

El frontend no duplica estas reglas: el backend entrega en cada respuesta
`allowed_transitions` ya filtrado por rol y dueñez.
"""

from __future__ import annotations

from barb.core.permissions import puede_ejecutar_accion

ESTADO_ABIERTO = "open"
ESTADO_EN_CURSO = "in_progress"
ESTADO_RESUELTO = "resolved"
ESTADO_CANCELADO = "cancelled"

TRANSICIONES: dict[str, tuple[str, ...]] = {
    ESTADO_ABIERTO: (ESTADO_EN_CURSO, ESTADO_CANCELADO),
    ESTADO_EN_CURSO: (ESTADO_RESUELTO, ESTADO_CANCELADO),
    ESTADO_RESUELTO: (),
    ESTADO_CANCELADO: (),
}

ESTADOS_FINALES = frozenset(e for e, destinos in TRANSICIONES.items() if not destinos)

# Todos los valores aceptados de `estado` (para validar query params y payloads).
ESTADOS_VALIDOS = tuple(TRANSICIONES)

ETIQUETA_ES: dict[str, str] = {
    "open": "Abierto",
    "in_progress": "En curso",
    "resolved": "Resuelto",
    "cancelled": "Cancelado",
}

# Acción de ACCIONES exigida para entrar a cada estado destino (patrón OT:
# cancelar es más restrictivo que avanzar el trabajo).
ACCION_POR_DESTINO: dict[str, str] = {
    ESTADO_EN_CURSO: "cambiar_estado_ticket",
    ESTADO_RESUELTO: "cambiar_estado_ticket",
    ESTADO_CANCELADO: "cancelar_ticket",
}


def transiciones_posibles(estado_actual: str) -> tuple[str, ...]:
    """Destinos válidos según la máquina de estados, sin considerar roles."""
    return TRANSICIONES.get(estado_actual, ())


def rol_puede_ir_a(rol: str, destino: str, es_dueño: bool = False) -> bool:
    """
    El rol puede entrar al destino. La dueñez habilita a AVANZAR el propio
    ticket (in_progress/resolved), nunca a cancelarlo.
    """
    accion = ACCION_POR_DESTINO.get(destino)
    if accion is None:
        return False
    if puede_ejecutar_accion(rol, accion):
        return True
    return es_dueño and accion == "cambiar_estado_ticket"


def transiciones_permitidas(estado_actual: str, rol: str | None, es_dueño: bool = False) -> list[str]:
    """Destinos válidos que además el rol (y la dueñez) pueden ejecutar."""
    if rol is None:
        return []
    return [d for d in transiciones_posibles(estado_actual) if rol_puede_ir_a(rol, d, es_dueño=es_dueño)]
