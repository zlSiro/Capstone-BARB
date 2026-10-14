"""Canal SSE de OTs en tiempo real (HU-10). Contrato y decisiones: `docs/REALTIME_OT.md`."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Header, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from barb.core.db import fetch_one
from barb.core.permissions import get_sesion_actual, resolver_empresa
from barb.services.realtime import TICKET_TTL_SECONDS, OtEvent, broker, consume_ticket, issue_ticket

logger = logging.getLogger("barb.realtime")

router = APIRouter()

RETRY_MS = 3000
PING_SECONDS = 15
POLL_SECONDS = 5
REVALIDATE_SECONDS = 60

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _token_of(authorization: str) -> str:
    return authorization.replace("Bearer ", "").strip()


async def _sesion_vigente(token: str) -> bool:
    row = await fetch_one(
        """
        SELECT 1 AS ok FROM sesion s JOIN usuario u ON u.usuario_id = s.usuario_id
        WHERE s.token = %(token)s AND s.expira_en > NOW() AND u.activo
        """,
        {"token": token},
    )
    return row is not None


def _frame(event: OtEvent) -> dict:
    frame = {"event": event.type, "data": json.dumps(event.data)}
    if event.id:
        frame["id"] = event.id
    return frame


@router.post("/api/work-orders/stream/ticket")
@router.post("/api/work_orders/stream/ticket")
async def crear_ticket_stream(authorization: str = Header(..., alias="Authorization")):
    """Ticket de un solo uso (60 s) para abrir el stream con `EventSource`, que no envía headers."""
    sesion = await get_sesion_actual(authorization)
    ticket = issue_ticket({**sesion, "token": _token_of(authorization)})
    return {"ticket": ticket, "expires_in": TICKET_TTL_SECONDS}


@router.get("/api/work-orders/stream")
@router.get("/api/work_orders/stream")
async def stream_work_orders(
    request: Request,
    ticket: str | None = Query(default=None),
    empresa_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None, alias="Authorization"),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
):
    if authorization:
        sesion = await get_sesion_actual(authorization)
        token = _token_of(authorization)
    elif ticket:
        sesion = consume_ticket(ticket)
        if sesion is None:
            raise HTTPException(status_code=401, detail="Ticket inválido o expirado.")
        token = sesion.get("token", "")
    else:
        raise HTTPException(status_code=401, detail="Falta Authorization: Bearer <token> o ?ticket=.")

    scope = resolver_empresa(sesion, empresa_id)

    async def event_generator():
        yield {"event": "hello", "data": json.dumps({"connected": True, "empresa_id": scope}), "retry": RETRY_MS}

        with broker.subscribe(scope, last_event_id) as sub:
            for event in sub.initial:
                yield _frame(event)

            last_check = time.monotonic()
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(sub.queue.get(), timeout=POLL_SECONDS)
                    yield _frame(event)
                except TimeoutError:
                    pass

                if token and time.monotonic() - last_check >= REVALIDATE_SECONDS:
                    last_check = time.monotonic()
                    if not await _sesion_vigente(token):
                        yield {"event": "error", "data": json.dumps({"code": "session_expired"})}
                        return

    return EventSourceResponse(event_generator(), ping=PING_SECONDS, headers=SSE_HEADERS)
