"""Máquina de estados de las órdenes de trabajo (OT).

Única fuente de verdad de qué transiciones existen y qué acción de `ACCIONES` exige cada una. El frontend no
duplica estas reglas: el backend entrega en cada OT la lista `allowed_transitions` ya filtrada por rol (y por la
rol).

    pending ──► in_progress ──► por_validar ──► completed (cerrada)
       │             ▲               │
       │             └───────────────┘   (devolución, con comentario)
       └─────────────┴───────────────┴──► cancelled (con motivo)

El cierre tiene doble validación: el técnico asignado (o el supervisor) envía la OT a validación y un supervisor
la valida (la cierra) o la devuelve. No se exige que sea otro supervisor: si el único supervisor de la empresa envió
la OT, puede validarla. `in_progress → completed` directo no existe. `assigned` y `overdue` son estados
heredados del esquema: se tratan como «pendiente» (pueden iniciarse o cancelarse). `completed` y `cancelled` son
finales: no admiten más cambios.
"""

from __future__ import annotations

from barb.core.permissions import ROLES_SOLO_OT_ASIGNADA, puede_ejecutar_accion

ESTADO_PENDIENTE = "pending"
ESTADO_EN_CURSO = "in_progress"
ESTADO_POR_VALIDAR = "por_validar"
ESTADO_CERRADA = "completed"
ESTADO_CANCELADA = "cancelled"

TRANSICIONES: dict[str, tuple[str, ...]] = {
    "pending": (ESTADO_EN_CURSO, ESTADO_CANCELADA),
    "assigned": (ESTADO_EN_CURSO, ESTADO_CANCELADA),
    "overdue": (ESTADO_EN_CURSO, ESTADO_CANCELADA),
    "in_progress": (ESTADO_POR_VALIDAR, ESTADO_CANCELADA),
    "por_validar": (ESTADO_CERRADA, ESTADO_EN_CURSO, ESTADO_CANCELADA),
    "completed": (),
    "cancelled": (),
}

ESTADOS_FINALES = frozenset(e for e, destinos in TRANSICIONES.items() if not destinos)

ETIQUETA_ES: dict[str, str] = {
    "pending": "Pendiente",
    "assigned": "Asignada",
    "in_progress": "En curso",
    "por_validar": "Por validar",
    "completed": "Cerrada",
    "cancelled": "Cancelada",
    "overdue": "Vencida",
}

# Acción de ACCIONES exigida para entrar a cada estado destino.
# Cancelar y validar son decisiones de supervisión; avanzar el trabajo (iniciar, enviar a validación) también
# lo puede hacer el técnico asignado, pero solo sobre su propia OT.
ACCION_POR_DESTINO: dict[str, str] = {
    ESTADO_EN_CURSO: "cambiar_estado_ot",
    ESTADO_POR_VALIDAR: "enviar_a_validacion",
    ESTADO_CERRADA: "validar_ot",
    ESTADO_CANCELADA: "cancelar_ot",
}

# Devolver una OT por validar a «en curso» es una decisión de quien valida, no de quien trabaja.
ACCION_DEVOLUCION = "validar_ot"

# Transiciones que exigen un comentario: el motivo de la cancelación y la razón de la devolución.
_DEVOLUCION = (ESTADO_POR_VALIDAR, ESTADO_EN_CURSO)


def es_devolucion(origen: str, destino: str) -> bool:
    return (origen, destino) == _DEVOLUCION


def exige_comentario(origen: str, destino: str) -> bool:
    """¿La transición necesita un comentario obligatorio? (cancelar con motivo; devolver con comentario)."""
    return destino == ESTADO_CANCELADA or es_devolucion(origen, destino)


def transiciones_posibles(estado_actual: str) -> tuple[str, ...]:
    """Destinos válidos según la máquina de estados, sin considerar roles."""
    return TRANSICIONES.get(estado_actual, ())


def rol_puede_ir_a(
    rol: str,
    destino: str,
    es_responsable: bool = False,
    origen: str | None = None,
) -> bool:
    """
    ¿Puede el rol llevar la OT a `destino`?

    - `es_responsable`: el usuario es el técnico asignado a la OT.
    - `origen`: estado actual; distingue la devolución (`por_validar → in_progress`) de iniciar la OT.
    """
    if origen is not None and es_devolucion(origen, destino):
        return puede_ejecutar_accion(rol, ACCION_DEVOLUCION)
    accion = ACCION_POR_DESTINO.get(destino)
    if accion is None:
        return False
    if puede_ejecutar_accion(rol, accion):
        # El técnico solo envía a validación la OT que tiene asignada; el resto de los roles no está acotado.
        return destino != ESTADO_POR_VALIDAR or es_responsable or rol not in ROLES_SOLO_OT_ASIGNADA
    # El técnico responsable puede iniciar su OT; cerrarla o cancelarla sigue siendo de supervisión.
    return destino == ESTADO_EN_CURSO and es_responsable and puede_ejecutar_accion(rol, "iniciar_ot_asignada")


def transiciones_permitidas(
    estado_actual: str,
    rol: str | None,
    es_responsable: bool = False,
) -> list[str]:
    """Destinos válidos que además el rol puede ejecutar (según sea o no el técnico asignado)."""
    if rol is None:
        return []
    return [d for d in transiciones_posibles(estado_actual) if rol_puede_ir_a(rol, d, es_responsable, estado_actual)]
