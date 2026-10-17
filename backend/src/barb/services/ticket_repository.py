# backend/src/barb/services/ticket_repository.py
"""
Repositorio de tickets conversacionales (HU-06, CGBIDA-287).

CRUD puro sobre la tabla `ticket` (migración 0007). Sin LLM y sin snapshot:
el ticket referencia la sesión en vivo (decisión D4, docs/TICKETS_ARCHITECTURE.md).

Aislamiento multi-empresa: TODA consulta filtra por `empresa_id`. La visibilidad
"ver todos los de la empresa" (permiso `history`) la decide el router y aquí se
expresa como `usuario_id=None`; con `usuario_id` solo se ven los tickets propios.
"""

from __future__ import annotations

import json
import logging

from barb.core.db import fetch_all, fetch_one

logger = logging.getLogger("barb.ticket_repo")

# SELECT base con el nombre del creador. LEFT JOIN: si el usuario se elimina,
# usuario_id queda NULL (ON DELETE SET NULL) y el ticket sobrevive como auditoría.
_TICKET_SELECT = """
    SELECT t.ticket_id,
           t.empresa_id,
           t.usuario_id,
           t.session_id,
           t.titulo,
           t.estado,
           t.created_at,
           t.updated_at,
           t.resolved_at,
           u.nombre AS creado_por
    FROM ticket t
    LEFT JOIN usuario u ON u.usuario_id = t.usuario_id
"""


def _normalize_messages(raw) -> list[dict]:
    """Asegura que `messages` sea una lista de dicts (misma lógica que chat_repository)."""
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    return list(raw) if isinstance(raw, list) else []


async def create_from_session(
    empresa_id: int,
    usuario_id: int,
    session_id: str,
    titulo: str,
) -> dict | None:
    """
    Crea el ticket de una conversación (cardinalidad 1:1, decisión D1).

    `ON CONFLICT (session_id) DO NOTHING` impone el UNIQUE en BD incluso ante
    carreras de POST simultáneos: devuelve None si la sesión ya tiene ticket
    (el router traduce a 409 con el ticket existente).
    """
    inserted = await fetch_one(
        """
        INSERT INTO ticket (empresa_id, usuario_id, session_id, titulo)
        VALUES (%(empresa_id)s, %(usuario_id)s, %(session_id)s, %(titulo)s)
        ON CONFLICT (session_id) DO NOTHING
        RETURNING ticket_id
        """,
        {
            "empresa_id": empresa_id,
            "usuario_id": usuario_id,
            "session_id": session_id,
            "titulo": titulo,
        },
    )
    if not inserted:
        return None
    return await get_by_id(int(inserted["ticket_id"]), empresa_id)


async def get_by_id(ticket_id: int, empresa_id: int) -> dict | None:
    """Un ticket por ID dentro de la empresa; None si no existe (o es de otra empresa)."""
    return await fetch_one(
        _TICKET_SELECT + " WHERE t.ticket_id = %(tid)s AND t.empresa_id = %(eid)s LIMIT 1",
        {"tid": ticket_id, "eid": empresa_id},
    )


async def get_by_session(session_id: str, empresa_id: int) -> dict | None:
    """El ticket existente de una sesión (para el 409 del POST con el id)."""
    return await fetch_one(
        _TICKET_SELECT + " WHERE t.session_id = %(sid)s AND t.empresa_id = %(eid)s LIMIT 1",
        {"sid": session_id, "eid": empresa_id},
    )


async def list_tickets(
    empresa_id: int,
    usuario_id: int | None = None,
    estado: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """
    Lista paginada con `total` que cumple el filtro (independiente de la página),
    ordenada por `updated_at DESC` (seguimiento: los más movidos primero).

    `usuario_id=None` = todos los tickets de la empresa (permiso `history`).
    """
    filtros = ["t.empresa_id = %(eid)s"]
    params: dict = {"eid": empresa_id}
    if usuario_id is not None:
        filtros.append("t.usuario_id = %(uid)s")
        params["uid"] = usuario_id
    if estado is not None:
        filtros.append("t.estado = %(estado)s")
        params["estado"] = estado
    where = " AND ".join(filtros)

    rows = await fetch_all(
        _TICKET_SELECT
        + f" WHERE {where} ORDER BY t.updated_at DESC, t.ticket_id DESC LIMIT %(limit)s OFFSET %(offset)s",
        {**params, "limit": limit, "offset": offset},
    )

    total_row = await fetch_one(
        f"SELECT COUNT(*) AS total FROM ticket t WHERE {where}",
        params,
    )
    total = int(total_row["total"]) if total_row else 0
    return rows, total


async def update_estado(ticket_id: int, empresa_id: int, estado: str) -> dict | None:
    """
    Transiciona el estado (la validez la valida el router con ticket_states)
    y registra `resolved_at` solo al llegar a 'resolved'. None si no existe.
    """
    updated = await fetch_one(
        """
        UPDATE ticket
        SET estado = %(estado)s,
            updated_at = NOW(),
            resolved_at = CASE WHEN %(estado)s = 'resolved' THEN NOW() ELSE resolved_at END
        WHERE ticket_id = %(tid)s AND empresa_id = %(eid)s
        RETURNING ticket_id
        """,
        {"estado": estado, "tid": ticket_id, "eid": empresa_id},
    )
    if not updated:
        return None
    return await get_by_id(ticket_id, empresa_id)


async def get_session_messages(session_id: str, empresa_id: int) -> list[dict]:
    """
    Mensajes en vivo de la conversación que originó el ticket (D4: sin snapshot).
    Se autoriza por la empresa del ticket, no por la dueñez de la sesión: un
    supervisor (permiso `history`) ve la conversación del ticket de su técnico.
    """
    row = await fetch_one(
        "SELECT messages FROM chat_session WHERE session_id = %(sid)s AND empresa_id = %(eid)s",
        {"sid": session_id, "eid": empresa_id},
    )
    if not row:
        return []
    return _normalize_messages(row.get("messages"))
