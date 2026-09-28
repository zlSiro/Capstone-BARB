# backend/src/barb/routers/chat.py

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel
import json

from barb.services.llm_service import create_conversation_chain

router = APIRouter(prefix="/api/chat", tags=["chat"])

class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str

@router.post("/stream")
async def stream_chat(request: ChatRequest):
    session_id = request.session_id or "default-session"
    chain = create_conversation_chain(session_id)

    async def event_generator():
        try:
            # Notificar el ID de sesión al frontend
            yield {
                "event": "session",
                "data": json.dumps({"session_id": session_id}),
            }

            # Stream de tokens
            async for chunk in chain.astream(
                {"input": request.message},
                config={"configurable": {"session_id": session_id}},
            ):
                if chunk:
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

    return EventSourceResponse(event_generator())