# backend/src/barb/core/token_limit.py

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException


class InMemoryTokenLimiter:
    """
    Límite de tokens por usuario en una ventana de tiempo (por defecto 24 h).
    Estima tokens como `len(texto) // 4` (heurística estándar para inglés/español).

    ⚠️ Solo válido para un único proceso del backend. Migrar a Redis si se escala.
    """

    def __init__(self, max_tokens: int, window_seconds: int = 86400) -> None:
        self.max_tokens = max_tokens
        self.window_seconds = window_seconds
        self._usage: dict[str, deque[tuple[float, int]]] = defaultdict(deque)

    def _purge_old(self, user_id: str) -> None:
        cutoff = time.monotonic() - self.window_seconds
        bucket = self._usage[user_id]
        while bucket and bucket[0][0] < cutoff:
            bucket.popleft()

    def used(self, user_id: str) -> int:
        self._purge_old(user_id)
        return sum(t for _, t in self._usage[user_id])

    def check(self, user_id: str) -> None:
        """Lanza 429 si el usuario ya superó el límite diario."""
        if self.used(user_id) >= self.max_tokens:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Límite diario de tokens alcanzado ({self.max_tokens} tokens). "
                    "Intenta de nuevo mañana."
                ),
            )

    def add(self, user_id: str, tokens: int) -> None:
        self._usage[user_id].append((time.monotonic(), max(0, tokens)))


def estimate_tokens(text: str) -> int:
    """Estimación rápida de tokens: ~4 caracteres por token."""
    return max(1, len(text) // 4)


# Instancia compartida: 50 000 tokens / 24 h por usuario
token_limiter = InMemoryTokenLimiter(max_tokens=50_000, window_seconds=86400)