# backend/src/barb/routers/tickets.py
"""
Tickets conversacionales (HU-06, CGBIDA-287).

Promueve una conversación del chat a ticket para darle seguimiento (CGBIDA-124,
criterios: ID propio, historial consultable, visibilidad por rol).

Contrato: docs/contrato_api_tickets.md · Diseño (D1-D7): docs/TICKETS_ARCHITECTURE.md

Visibilidad (D3): cada usuario ve los tickets nacidos de SUS conversaciones;
el permiso de ruta `history` (supervisor/gerente/admin) ve TODOS los de la
empresa. Denegado = 404 no revelador (no se distingue "no existe" de "es de
otro"), igual que el historial de chat.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from barb.core import ticket_states
from barb.core.permissions import (
    get_sesion_actual,
    puede_acceder_ruta,
    require_action,
    require_auth,
)
from barb.schemas.chat import ChatMessage
from barb.schemas.tickets import (
    TicketCreateRequest,
    TicketDetailResponse,
    TicketListResponse,
    TicketResponse,
    TicketStateUpdateRequest,
)
from barb.services import chat_repository, ticket_repository

logger = logging.getLogger("barb.tickets")

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

_TICKET_NO_ENCONTRADO = "Ticket no encontrado o no tienes acceso a él."

# Filtro opcional del listado: solo los estados de la máquina (422 si no).
_ESTADO_PATTERN = "^(" + "|".join(ticket_states.ESTADOS_VALIDOS) + ")$"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _empresa_de_sesion(sesion: dict) -> int:
    """Exige empresa concreta: el ticket pertenece a la empresa de la conversación."""
    empresa_id = sesion.get("empresa_id")
    if empresa_id is None:
        raise HTTPException(status_code=403, detail="Tu perfil no pertenece a una empresa.")
    return int(empresa_id)


def _puede_ver_todos(rol: str) -> bool:
    """Permiso `history`: ver los tickets de toda la empresa (D3)."""
    return puede_acceder_ruta(rol, "history") is True


def _es_dueño(row: dict, usuario_id: int) -> bool:
    return row.get("usuario_id") is not None and int(row["usuario_id"]) == usuario_id


def _to_response(row: dict, rol: str, usuario_id: int) -> TicketResponse:
    """Fila → schema, con allowed_transitions ya filtrado por rol y dueñez (patrón OT)."""
    return TicketResponse(
        ticket_id=int(row["ticket_id"]),
        titulo=str(row["titulo"]),
        estado=str(row["estado"]),
        session_id=str(row["session_id"]),
        creado_por=row.get("creado_por"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        resolved_at=row.get("resolved_at"),
        allowed_transitions=ticket_states.transiciones_permitidas(
            str(row["estado"]), rol, es_dueño=_es_dueño(row, usuario_id)
        ),
    )


# ---------------------------------------------------------------------------
# POST /api/tickets — crear desde una conversación propia
# ---------------------------------------------------------------------------

@router.post("", status_code=201, response_model=TicketResponse, dependencies=[Depends(require_action("crear_ticket"))])
async def create_ticket(
    payload: TicketCreateRequest,
    sesion: dict = Depends(get_sesion_actual),
):
    """
    Promueve una conversación propia a ticket (relación 1:1, D1).

    La sesión debe pertenecer al usuario (mismo 404 no revelador que el chat);
    si ya tiene ticket, se responde 409 con el `ticket_id` existente para que
    el frontend navegue a él.
    """
    usuario_id = int(sesion["usuario_id"])
    _empresa_de_sesion(sesion)  # guard: sin empresa no hay conversación propia

    chat_session = await chat_repository.get_session(str(payload.session_id), usuario_id)
    if not chat_session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada o no te pertenece.")

    # El ticket nace DE la conversación: hereda su empresa (NOT NULL) y su
    # título si el payload no trae uno.
    empresa_id = int(chat_session["empresa_id"])
    titulo = (payload.titulo or "").strip() or str(chat_session["titulo"])

    ticket = await ticket_repository.create_from_session(
        empresa_id=empresa_id,
        usuario_id=usuario_id,
        session_id=str(payload.session_id),
        titulo=titulo,
    )
    if ticket is None:
        existing = await ticket_repository.get_by_session(str(payload.session_id), empresa_id)
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Esta conversación ya tiene un ticket asociado.",
                "ticket_id": int(existing["ticket_id"]) if existing else None,
            },
        )
    return _to_response(ticket, sesion["rol"], usuario_id)


# ---------------------------------------------------------------------------
# GET /api/tickets — listado (dueño o history)
# ---------------------------------------------------------------------------

@router.get("", response_model=TicketListResponse, dependencies=[Depends(require_auth)])
async def list_tickets(
    sesion: dict = Depends(get_sesion_actual),
    estado: str | None = Query(default=None, pattern=_ESTADO_PATTERN, description="Filtro opcional por estado."),
    limit: int = Query(20, ge=1, le=100, description="Tamaño de página (1-100)"),
    offset: int = Query(0, ge=0, description="Desplazamiento"),
):
    """Lista los tickets visibles, ordenados por `updated_at DESC` (seguimiento)."""
    usuario_id = int(sesion["usuario_id"])
    empresa_id = _empresa_de_sesion(sesion)
    rol = sesion["rol"]

    ver_todos = _puede_ver_todos(rol)
    rows, total = await ticket_repository.list_tickets(
        empresa_id=empresa_id,
        usuario_id=None if ver_todos else usuario_id,
        estado=estado,
        limit=limit,
        offset=offset,
    )
    return TicketListResponse(
        tickets=[_to_response(r, rol, usuario_id) for r in rows],
        total=total,
    )


# ---------------------------------------------------------------------------
# GET /api/tickets/{ticket_id} — detalle con la conversación en vivo
# ---------------------------------------------------------------------------

@router.get("/{ticket_id}", response_model=TicketDetailResponse, dependencies=[Depends(require_auth)])
async def get_ticket(
    ticket_id: int,
    sesion: dict = Depends(get_sesion_actual),
):
    """El ticket + los mensajes actuales de la sesión que lo originó (D4: sin snapshot)."""
    usuario_id = int(sesion["usuario_id"])
    empresa_id = _empresa_de_sesion(sesion)
    rol = sesion["rol"]

    ticket = await ticket_repository.get_by_id(ticket_id, empresa_id)
    if not ticket or not (_es_dueño(ticket, usuario_id) or _puede_ver_todos(rol)):
        raise HTTPException(status_code=404, detail=_TICKET_NO_ENCONTRADO)

    mensajes = await ticket_repository.get_session_messages(str(ticket["session_id"]), empresa_id)
    base = _to_response(ticket, rol, usuario_id)
    return TicketDetailResponse(
        **base.model_dump(),
        messages=[
            ChatMessage(
                role=str(m.get("role", "")),
                content=str(m.get("content", "")),
                timestamp=int(m["timestamp"]) if m.get("timestamp") is not None else None,
            )
            for m in mensajes
        ],
    )


# ---------------------------------------------------------------------------
# PATCH /api/tickets/{ticket_id}/estado — transición de estado
# ---------------------------------------------------------------------------

@router.patch("/{ticket_id}/estado", response_model=TicketResponse, dependencies=[Depends(require_auth)])
async def update_ticket_state(
    ticket_id: int,
    payload: TicketStateUpdateRequest,
    sesion: dict = Depends(get_sesion_actual),
):
    """
    Transiciona el ticket según la máquina de estados (D2).

    - 409: transición inválida por la máquina (p.ej. resolved → in_progress).
    - 403: el destino es válido pero tu rol no llega (dueño no cancela;
      quien no ve el ticket ya recibió 404 en la visibilidad).
    """
    usuario_id = int(sesion["usuario_id"])
    empresa_id = _empresa_de_sesion(sesion)
    rol = sesion["rol"]

    ticket = await ticket_repository.get_by_id(ticket_id, empresa_id)
    es_dueño = _es_dueño(ticket, usuario_id) if ticket else False
    if not ticket or not (es_dueño or _puede_ver_todos(rol)):
        raise HTTPException(status_code=404, detail=_TICKET_NO_ENCONTRADO)

    estado_actual = str(ticket["estado"])
    destino = payload.estado
    if destino not in ticket_states.transiciones_posibles(estado_actual):
        raise HTTPException(
            status_code=409,
            detail=f"Transición inválida: un ticket '{estado_actual}' no puede pasar a '{destino}'.",
        )
    if destino not in ticket_states.transiciones_permitidas(estado_actual, rol, es_dueño=es_dueño):
        raise HTTPException(
            status_code=403,
            detail=f"El rol '{rol}' no puede llevar este ticket a '{destino}'.",
        )

    updated = await ticket_repository.update_estado(ticket_id, empresa_id, destino)
    if not updated:
        raise HTTPException(status_code=404, detail=_TICKET_NO_ENCONTRADO)
    return _to_response(updated, rol, usuario_id)
