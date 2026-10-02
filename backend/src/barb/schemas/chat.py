# backend/src/barb/schemas/chat.py
"""Schemas Pydantic para el listado y consulta de conversaciones del chat IA."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SessionListItem(BaseModel):
    """Item del listado de conversaciones (con metadatos enriquecidos)."""
    session_id: str
    titulo: str
    saved_at: datetime
    message_count: int = Field(..., ge=0)
    saved_by: str | None = None
    machine_name: str | None = None
    discipline: str | None = None
    plant_name: str | None = None


class SessionListResponse(BaseModel):
    """Respuesta de GET /api/chat/sessions."""
    sessions: list[SessionListItem]
    total: int = Field(..., ge=0)


class ChatMessage(BaseModel):
    """Un mensaje dentro de una conversación."""
    role: str
    content: str
    timestamp: int | None = None


class SessionDetailResponse(BaseModel):
    """Respuesta de GET /api/chat/sessions/{session_id}."""
    session_id: str
    titulo: str
    saved_at: datetime
    messages: list[ChatMessage]


class DeleteSessionResponse(BaseModel):
    """Respuesta de DELETE /api/chat/sessions/{session_id}."""
    deleted: bool
    session_id: str