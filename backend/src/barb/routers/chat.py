from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sse_starlette.sse import EventSourceResponse

from barb.core.config import settings
from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import estimate_tokens, token_limiter
from barb.schemas.chat import (
    ChatMessage,
    DeleteSessionResponse,
    SessionDetailResponse,
    SessionListItem,
    SessionListResponse,
)
from barb.services import chat_repository
from barb.services.document_service import format_context, search_chunks
from barb.services.llm_service import (
    MULTIMODAL_IMAGE_TOKENS,
    NO_DOCS_ANSWER,
    create_conversation_chain,
    create_multimodal_chain,
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


async def _single_chunk(text: str):
    yield text


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    user: dict = Depends(get_current_user),
):
    user_id = int(user["id"])
    # Aislamiento: un usuario de empresa SIEMPRE consulta la documentación de su empresa.
    # get_current_user ya excluye al super_usuario; esta guarda cubre cualquier usuario sin empresa.
    if user["role"] == "super_usuario" or user["empresa_id"] is None:
        raise HTTPException(status_code=403, detail="Tu perfil no tiene acceso a DocChat.")
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

    # --- RAG: fragmentos relevantes de la documentación ACTIVA de la empresa ---
    # Se incluye el último mensaje del usuario para resolver preguntas de seguimiento
    # ("¿y el torque?") y también el último del ASISTENTE (v1.1, review de la
    # HU-05): los turnos con imagen dejan ahí el contexto del equipo identificado
    # ("es un chancador de mandíbulas") y los seguimientos ("¿cómo funciona?")
    # necesitan esa pista para encontrar el manual correspondiente.
    previous_user_msgs = [m.get("content", "") for m in history if m.get("role") == "user"][-1:]
    previous_assistant_msgs = [m.get("content", "") for m in history if m.get("role") == "assistant"][-1:]
    chunks = await search_chunks(
        empresa_id, request.message, *previous_user_msgs, *previous_assistant_msgs
    )
    context = format_context(chunks)

    # Sin documentación relevante no se consulta al LLM: se garantiza que la IA
    # nunca responda con conocimiento ajeno a lo compartido por la empresa.
    chain = create_conversation_chain() if chunks else None
    input_tokens = estimate_tokens(request.message)

    async def event_generator():
        output_chars = 0
        assistant_chunks: list[str] = []

        try:
            yield {
                "event": "session",
                "data": json.dumps({"session_id": session_id}),
            }

            if chain is None:
                stream = _single_chunk(NO_DOCS_ANSWER)
            else:
                stream = chain.astream(
                    {"input": request.message, "history": history, "context": context}
                )

            async for chunk in stream:
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
# Chat multimodal (HU-05): POST /api/chat/multimedia
# Contrato: docs/contrato_api_chat_multimedia.md · Diseño: docs/MULTIMODAL_ARCHITECTURE.md
# =============================================================================

# Formatos permitidos por el contrato (D4). muse-glimmer los soporta vía data URL
# (verificado contra NIM: jpeg/png/webp responden en español).
ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}

_DATA_URL_RE = re.compile(r"^data:([\w./+-]+);base64,(.*)$", re.DOTALL)

# 400 del contrato: sin imagen o mensaje vacío (detalle exacto del contrato).
_MULTIMEDIA_FALTA_INPUT = "Debes adjuntar una imagen y una pregunta."


class MultimediaRequest(BaseModel):
    session_id: str | None = None
    # El vacío se rechaza con 400 en el endpoint (detalle del contrato que combina
    # imagen+pregunta), no con min_length=1 como en el stream.
    message: str = Field(
        ...,
        max_length=2000,
        description="Pregunta del usuario sobre la imagen (1 a 2000 caracteres).",
    )
    image_base64: str = Field(
        ...,
        description="Imagen como data URL: data:image/{jpeg|png|webp};base64,... (≤ 5 MB decodificada).",
    )

    @field_validator("image_base64")
    @classmethod
    def _formato_de_imagen_permitido(cls, v: str) -> str:
        """Formato de imagen → 422 con array de errores Pydantic (contrato)."""
        m = _DATA_URL_RE.match(v)
        if m and m.group(1) not in ALLOWED_IMAGE_MIME:
            raise ValueError(
                f"Formato de imagen no permitido ({m.group(1)}). "
                f"Solo se aceptan: {', '.join(sorted(ALLOWED_IMAGE_MIME))}."
            )
        return v


def _validate_image(image_base64: str) -> None:
    """Valida estructura del data URL (400) y tamaño decodificado (413).

    El tamaño se mide sobre los bytes DECODIFICADOS (D4): el base64 infla ~33%
    en tránsito, por eso el límite no aplica sobre el string.
    """
    m = _DATA_URL_RE.match(image_base64)
    if not m:
        raise HTTPException(status_code=400, detail=_MULTIMEDIA_FALTA_INPUT)

    # Tolerante a saltos de línea en el base64 (encoders que hacen wrap).
    payload = "".join(m.group(2).split())
    if not payload:
        raise HTTPException(status_code=400, detail=_MULTIMEDIA_FALTA_INPUT)
    try:
        raw = base64.b64decode(payload + "=" * (-len(payload) % 4), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail=_MULTIMEDIA_FALTA_INPUT) from None

    max_bytes = settings.multimodal_max_image_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"La imagen supera el máximo de {settings.multimodal_max_image_mb} MB.",
        )


@router.post("/multimedia")
async def stream_multimedia_chat(
    request: MultimediaRequest,
    user: dict = Depends(get_current_user),
):
    """
    Análisis de imágenes en el chat IA (HU-05, CGBIDA-276/277).

    La imagen viaja como data URL base64, se usa en memoria para la respuesta
    y NO se persiste (D2): el historial guarda solo el texto del turno, igual
    que cualquier otra conversación. Reutiliza la infra del stream textual:
    JWT, rate limit, límite diario de tokens y los mismos eventos SSE.
    """
    # Feature apagada sin modelo/key (patrón 503 de documents.py).
    if not settings.multimodal_configurado:
        raise HTTPException(
            status_code=503,
            detail="El análisis de imágenes no está disponible (MULTIMODAL_MODEL).",
        )

    user_id = int(user["id"])
    # Aislamiento + RBAC idéntico al stream textual (alineado tras la HU-12,
    # PR #23): get_current_user ya excluye al super_usuario; esta guarda cubre
    # cualquier usuario sin empresa. El DocChat completo comparte esta política.
    if user["role"] == "super_usuario" or user["empresa_id"] is None:
        raise HTTPException(status_code=403, detail="Tu perfil no tiene acceso a DocChat.")
    empresa_id = int(user["empresa_id"])

    # Validaciones del payload ANTES del rate limit: un request inválido no debe
    # consumir cuota (el frontend igual valida antes de enviar; el backend
    # revalida — nunca confiar solo en el cliente).
    if not request.message.strip():
        raise HTTPException(status_code=400, detail=_MULTIMEDIA_FALTA_INPUT)
    _validate_image(request.image_base64)

    chat_rate_limiter.check(str(user_id))

    token_limiter.check(str(user_id))

    if request.session_id:
        try:
            uuid.UUID(request.session_id)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail="session_id debe ser un UUID válido.",
            ) from None

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

    # RAG ligero (D5 v1.1, review de la HU-05): fragmentos de la documentación
    # ACTIVA de la empresa que coincidan con la pregunta. El turno multimodal
    # responde con la imagen Y con los manuales cuando aplican; el prompt exige
    # etiquetar el origen (identificación visual vs documentación citada).
    # Se incluye el mensaje previo del asistente para que los turnos con imagen
    # aporten su contexto ("es un chancador de mandíbulas") a la búsqueda.
    previous_user_msgs = [m.get("content", "") for m in history if m.get("role") == "user"][-1:]
    previous_assistant_msgs = [m.get("content", "") for m in history if m.get("role") == "assistant"][-1:]
    chunks = await search_chunks(empresa_id, request.message, *previous_user_msgs, *previous_assistant_msgs)
    context = format_context(chunks) if chunks else ""

    chain = create_multimodal_chain()
    # Contabilidad de tokens (D6): el presupuesto visual de la imagen (~4096)
    # cuenta contra el límite diario del usuario. El contexto inyectado no se
    # cuenta, igual que en el stream textual.
    input_tokens = estimate_tokens(request.message) + MULTIMODAL_IMAGE_TOKENS

    async def event_generator():
        output_chars = 0
        assistant_chunks: list[str] = []

        try:
            yield {
                "event": "session",
                "data": json.dumps({"session_id": session_id}),
            }

            stream = chain.astream(
                {
                    "input": request.message,
                    "history": history,
                    "image": request.image_base64,
                    "context": context,
                }
            )

            async for chunk in stream:
                if chunk:
                    output_chars += len(chunk)
                    assistant_chunks.append(chunk)
                    yield {
                        "event": "token",
                        "data": json.dumps({"text": chunk}),
                    }

            yield {"event": "done", "data": "{}"}

        except Exception as e:
            logger.exception("Error en chat multimedia (session_id=%s)", session_id)
            yield {
                "event": "error",
                "data": json.dumps({"code": "internal_error", "message": str(e)}),
            }

        finally:
            try:
                ts = _now_ms()
                # D2: se persiste SOLO el texto del turno; la imagen no se guarda (v1).
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