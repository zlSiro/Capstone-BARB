# backend/src/barb/routers/chat.py

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel, Field
import json

from barb.core.rate_limit import chat_rate_limiter
from barb.core.security import get_current_user
from barb.core.token_limit import estimate_tokens, token_limiter
from barb.services.llm_service import create_conversation_chain

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Mensaje del usuario (1 a 2000 caracteres).",
    )


@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    user: dict = Depends(get_current_user),
):
    user_id = str(user["id"])

    # --- Rate limit por minuto ---
    chat_rate_limiter.check(user_id)

    # --- Límite diario de tokens (pre-check) ---
    token_limiter.check(user_id)

    # --- Sesión aislada por usuario ---
    base_session = request.session_id or "default"
    session_id = f"{user_id}:{base_session}"

    chain = create_conversation_chain(session_id)
    input_tokens = estimate_tokens(request.message)

    async def event_generator():
        output_chars = 0
        try:
            yield {
                "event": "session",
                "data": json.dumps({"session_id": session_id}),
            }

            async for chunk in chain.astream(
                {"input": request.message},
                config={"configurable": {"session_id": session_id}},
            ):
                if chunk:
                    output_chars += len(chunk)
                    yield {
                        "event": "token",
                        "data": json.dumps({"text": chunk}),
                    }

            yield {"event": "done", "data": "{}"}

        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"code": "internal_error", "message": str(e)}),
            }
        finally:
            # Registrar consumo: input + output estimados
            output_tokens = max(0, output_chars // 4)
            token_limiter.add(user_id, input_tokens + output_tokens)

    return EventSourceResponse(event_generator())