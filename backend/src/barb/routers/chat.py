from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import estimate_tokens, token_limiter
from barb.services import chat_repository
from barb.services.llm_service import create_conversation_chain

from fastapi import Query

from barb.schemas.chat import (
    ChatMessage,
    DeleteSessionResponse,
    SessionDetailResponse,
    SessionListItem,
    SessionListResponse,
)


logger = logging.getLogger("barb.chat")

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Mensaje del usuario (1 a 2000 caracteres).",
    )


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    user: dict = Depends(get_current_user),
):
    user_id = int(user["id"])
    empresa_id = int(user["empresa_id"])

    chat_rate_limiter.check(str(user_id))

    token_limiter.check(str(user_id))

    if request.session_id:
        try:
            uuid.UUID(request.session_id)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail="session_id debe ser un UUID válido.",
            )

        existing = await chat_repository.get_session(request.session_id, user_id)
        if not existing:
            raise HTTPException(
                status_code=404,
                detail="Sesión no encontrada o no te pertenece.",
            )
        session_id = request.session_id
        history = await chat_repository.load_messages(session_id, user_id)
    else:
        session_id = await chat_repository.create_session(
            usuario_id=user_id,
            empresa_id=empresa_id,
            primer_mensaje=request.message,
        )
        history = []

    chain = create_conversation_chain()
    input_tokens = estimate_tokens(request.message)

    async def event_generator():
        output_chars = 0
        assistant_chunks: list[str] = []

        try:
            yield {
                "event": "session",
                "data": json.dumps({"session_id": session_id}),
            }

            async for chunk in chain.astream(
                {"input": request.message, "history": history}
            ):
                if chunk:
                    output_chars += len(chunk)
                    assistant_chunks.append(chunk)
                    yield {
                        "event": "token",
                        "data": json.dumps({"text": chunk}),
                    }

            yield {"event": "done", "data": "{}"}

        except Exception as e:
            logger.exception("Error en chat stream (session_id=%s)", session_id)
            yield {
                "event": "error",
                "data": json.dumps({"code": "internal_error", "message": str(e)}),
            }

        finally:
            try:
                ts = _now_ms()
                nuevos = [
                    {"role": "user", "content": request.message, "timestamp": ts},
                    {
                        "role": "assistant",
                        "content": "".join(assistant_chunks),
                        "timestamp": ts + 1,
                    },
                ]
                await chat_repository.append_messages(session_id, user_id, nuevos)
            except Exception:
                logger.exception(
                    "No se pudo persistir la conversación session_id=%s", session_id
                )

            output_tokens = max(0, output_chars // 4)
            token_limiter.add(str(user_id), input_tokens + output_tokens)

    return EventSourceResponse(event_generator())


# =============================================================================
# Listado / consulta / borrado de conversaciones (CGBIDA-254, 255, 256)
# =============================================================================

@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    user: dict = Depends(get_current_user),
    limit: int = Query(20, ge=1, le=100, description="Tamaño de página (1-100)"),
    offset: int = Query(0, ge=0, description="Desplazamiento"),
):
    """
    Lista las conversaciones del usuario autenticado, ordenadas por
    `saved_at DESC`. Incluye metadatos (técnico, equipo, disciplina) para
    la tabla de historial.
    """
    user_id = int(user["id"])
    sessions = await chat_repository.list_by_user(user_id, limit=limit, offset=offset)

    items = [
        SessionListItem(
            session_id=str(s["session_id"]),
            titulo=str(s["titulo"]),
            saved_at=s["saved_at"],
            message_count=int(s["message_count"]),
            saved_by=s.get("saved_by"),
            machine_name=s.get("machine_name"),
            discipline=s.get("discipline"),
            plant_name=s.get("plant_name"),
        )
        for s in sessions
    ]
    return SessionListResponse(sessions=items, total=len(items))


@router.get("/sessions/{session_id}", response_model=SessionDetailResponse)
async def get_session_detail(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """
    Devuelve el historial completo de una conversación.

    Valida que el `session_id` sea un UUID y que pertenezca al usuario
    autenticado (CGBIDA-257).
    """
    user_id = int(user["id"])

    # Validar formato UUID
    try:
        uuid.UUID(session_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=422,
            detail="session_id debe ser un UUID válido.",
        )

    # Verificar ownership + existencia
    session = await chat_repository.get_session(session_id, user_id)
    if not session:
        raise HTTPException(
            status_code=404,
            detail="Sesión no encontrada o no te pertenece.",
        )

    messages_raw = await chat_repository.load_messages(session_id, user_id)
    messages = [
        ChatMessage(
            role=str(m.get("role", "")),
            content=str(m.get("content", "")),
            timestamp=int(m["timestamp"]) if m.get("timestamp") is not None else None,
        )
        for m in messages_raw
    ]

    return SessionDetailResponse(
        session_id=str(session["session_id"]),
        titulo=str(session["titulo"]),
        saved_at=session["saved_at"],
        messages=messages,
    )


@router.delete("/sessions/{session_id}", response_model=DeleteSessionResponse)
async def delete_session(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """
    Elimina una conversación del usuario autenticado.

    Valida formato UUID, existencia y ownership. Si la sesión no existe o
    no pertenece al usuario, devuelve 404 (no revela si existe para otro).
    """
    user_id = int(user["id"])

    # Validar formato UUID
    try:
        uuid.UUID(session_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=422,
            detail="session_id debe ser un UUID válido.",
        )

    deleted = await chat_repository.delete_session(session_id, user_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Sesión no encontrada o no te pertenece.",
        )

    return DeleteSessionResponse(deleted=True, session_id=session_id)