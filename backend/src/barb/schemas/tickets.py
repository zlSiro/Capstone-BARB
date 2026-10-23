# backend/src/barb/schemas/tickets.py
"""Schemas Pydantic de los tickets conversacionales (HU-06, CGBIDA-286).

Contrato completo en docs/contrato_api_tickets.md; diseño (decisiones D1-D7)
en docs/TICKETS_ARCHITECTURE.md.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from barb.schemas.chat import ChatMessage

# Valores aceptados de `estado` (espejo de core/ticket_states.py). Un valor
# fuera del enum es 422 de Pydantic; una transición inválida para el estado
# actual es 409 de la máquina de estados (ver contrato, § PATCH).
EstadoTicket = Literal["open", "in_progress", "resolved", "cancelled"]


class TicketCreateRequest(BaseModel):
    """Body de POST /api/tickets: promueve una conversación propia a ticket."""

    session_id: uuid.UUID = Field(
        ...,
        description="Conversación propia a promover (se lista en GET /api/chat/sessions).",
    )
    titulo: str | None = Field(
        None,
        max_length=200,
        description="Título del ticket. Default: el título de la conversación.",
    )


class TicketStateUpdateRequest(BaseModel):
    """Body de PATCH /api/tickets/{ticket_id}/estado."""

    estado: EstadoTicket


class TicketResponse(BaseModel):
    """Forma de ticket que devuelven POST, el listado GET y PATCH."""

    ticket_id: int
    titulo: str
    estado: str
    session_id: str
    creado_por: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    # Destinos válidos para ESTE usuario (rol + dueñez), ya filtrados por el
    # backend — el frontend no duplica la máquina de estados (patrón OT).
    allowed_transitions: list[str] = []


class TicketListResponse(BaseModel):
    """Respuesta de GET /api/tickets."""

    tickets: list[TicketResponse]
    total: int = Field(..., ge=0, description="Total que cumple el filtro, independiente de la paginación.")


class TicketDetailResponse(TicketResponse):
    """Respuesta de GET /api/tickets/{ticket_id}: el ticket + la conversación en vivo (D4)."""

    messages: list[ChatMessage]
