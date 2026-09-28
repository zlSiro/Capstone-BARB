# backend/src/barb/core/rate_limit.py

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException


class InMemoryRateLimiter:
    """
    Rate limiter simple en memoria, por usuario.
    Guarda los timestamps de las últimas peticiones y rechaza si
    se supera el límite en la ventana configurada.

    ⚠️ Solo válido para un único proceso del backend. Si en el futuro
    se escala horizontalmente (múltiples workers), migrar a Redis.
    """

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, user_id: str) -> None:
        """Lanza HTTPException 429 si el usuario superó el límite."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        bucket = self._hits[user_id]

        # Descartar hits fuera de la ventana
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= self.max_requests:
            retry_after = int(self.window_seconds - (now - bucket[0])) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Demasiadas peticiones. Reintenta en {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )

        bucket.append(now)


# Instancia compartida: 10 mensajes por minuto por usuario
chat_rate_limiter = InMemoryRateLimiter(max_requests=10, window_seconds=60)