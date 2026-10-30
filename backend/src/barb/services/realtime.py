"""
Broker en memoria para el monitoreo de OTs en tiempo real (HU-10, SSE).

Los routers de OT publican eventos después de confirmar la transacción; cada
conexión SSE abierta es un `Subscriber` con su propia cola. Un buffer circular
permite reanudar con `Last-Event-ID` tras una reconexión corta.

Single-process, igual que `core/rate_limit.py`: con más de una instancia habría que
mover el fan-out a Redis pub/sub. Detalle: `docs/REALTIME_OT.md`.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("barb.realtime")

BUFFER_SIZE = 500
QUEUE_SIZE = 100
TICKET_TTL_SECONDS = 60

EVENT_OT_CREATED = "ot.created"
EVENT_OT_STATUS_CHANGED = "ot.status_changed"
EVENT_OT_DELETED = "ot.deleted"
EVENT_RESYNC = "resync"


@dataclass(frozen=True)
class OtEvent:
    id: str | None
    type: str
    data: dict[str, Any]
    empresa_id: int | None = None


# Clave interna del payload: ids de los usuarios a quienes concierne la OT (técnico asignado, quien la creó y
# quien reportó el aviso del que nació). Solo sirve para filtrar; el router la quita antes de enviar el evento.
VISIBLE_A = "visible_a"


@dataclass(eq=False)  # identidad: se guarda en un set
class Subscriber:
    empresa_id: int | None  # None = todas las empresas (super_usuario)
    # Si se indica, solo recibe los eventos de las OT que le conciernen (operador y técnico: no ven las ajenas).
    solo_usuario_id: int | None = None
    queue: asyncio.Queue[OtEvent] = field(default_factory=lambda: asyncio.Queue(maxsize=QUEUE_SIZE))
    initial: list[OtEvent] = field(default_factory=list)  # replay / resync previo al stream en vivo

    def accepts(self, event: OtEvent) -> bool:
        if not (self.empresa_id is None or self.empresa_id == event.empresa_id):
            return False
        return self.solo_usuario_id is None or self.solo_usuario_id in (event.data.get(VISIBLE_A) or [])


class OtEventBroker:
    def __init__(self) -> None:
        self._subscribers: set[Subscriber] = set()
        self._buffer: deque[tuple[int, OtEvent]] = deque(maxlen=BUFFER_SIZE)
        self._seq = 0
        # Identifica esta vida del proceso: tras un reinicio los ids viejos ya no sirven.
        self._boot = int(time.time())

    @property
    def connections(self) -> int:
        return len(self._subscribers)

    def publish(self, event_type: str, data: dict[str, Any], empresa_id: int | None) -> OtEvent:
        """Registra el evento y lo reparte a las colas. Nunca bloquea ni lanza."""
        self._seq += 1
        payload = {**data, "empresa_id": empresa_id, "timestamp": datetime.now(UTC).isoformat()}
        event = OtEvent(id=f"{self._boot}-{self._seq}", type=event_type, data=payload, empresa_id=empresa_id)
        self._buffer.append((self._seq, event))

        for sub in list(self._subscribers):
            if not sub.accepts(event):
                continue
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                # Cliente lento: se descartan sus pendientes y se le pide recargar.
                self._flag_resync(sub)
        return event

    @staticmethod
    def _flag_resync(sub: Subscriber) -> None:
        while not sub.queue.empty():
            sub.queue.get_nowait()
        sub.queue.put_nowait(OtEvent(id=None, type=EVENT_RESYNC, data={"reason": "overflow"}))

    def _parse_id(self, last_event_id: str) -> int | None:
        boot, _, seq = last_event_id.partition("-")
        if not boot.isdigit() or not seq.isdigit() or int(boot) != self._boot:
            return None
        return int(seq)

    def _replay_for(self, sub: Subscriber, last_event_id: str | None) -> list[OtEvent]:
        if not last_event_id:
            return []
        last_seq = self._parse_id(last_event_id)
        resync = [OtEvent(id=None, type=EVENT_RESYNC, data={"reason": "gap"})]
        if last_seq is None or last_seq > self._seq:
            return resync
        if last_seq == self._seq:
            return []
        oldest = self._buffer[0][0] if self._buffer else self._seq + 1
        if last_seq < oldest - 1:
            return resync
        return [ev for seq, ev in self._buffer if seq > last_seq and sub.accepts(ev)]

    @contextmanager
    def subscribe(
        self, empresa_id: int | None, last_event_id: str | None = None, solo_usuario_id: int | None = None
    ) -> Iterator[Subscriber]:
        """Registra una conexión; se da de baja sola al salir (desconexión del cliente)."""
        sub = Subscriber(empresa_id=empresa_id, solo_usuario_id=solo_usuario_id)
        # Sin await entre registrar y calcular el replay: no se pierden eventos en medio.
        self._subscribers.add(sub)
        sub.initial = self._replay_for(sub, last_event_id)
        try:
            yield sub
        finally:
            self._subscribers.discard(sub)


broker = OtEventBroker()


def publish_safe(event_type: str, data: dict[str, Any], empresa_id: int | None) -> None:
    """Publica sin romper el request que originó el cambio si algo falla."""
    try:
        broker.publish(event_type, data, empresa_id)
    except Exception:
        logger.exception("No se pudo publicar el evento %s", event_type)


# =============================================================================
# TICKETS DE UN SOLO USO (EventSource nativo no puede enviar Authorization)
# =============================================================================

_tickets: dict[str, tuple[dict, float]] = {}


def issue_ticket(sesion: dict) -> str:
    now = time.monotonic()
    for key in [k for k, (_, exp) in _tickets.items() if exp <= now]:
        del _tickets[key]
    ticket = secrets.token_urlsafe(24)
    _tickets[ticket] = (sesion, now + TICKET_TTL_SECONDS)
    return ticket


def consume_ticket(ticket: str) -> dict | None:
    entry = _tickets.pop(ticket, None)
    if entry is None:
        return None
    sesion, expires = entry
    return sesion if expires > time.monotonic() else None
