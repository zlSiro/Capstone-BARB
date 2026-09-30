# backend/src/barb/services/chat_repository.py
"""
Repositorio de conversaciones del chat IA.

Usa la tabla `chat_session` existente (ver migración 0002 o schema legacy).
Los mensajes viven como array JSONB en la columna `messages`:
    [{"role": "user"|"assistant", "content": "...", "timestamp": 1234567890}]

El aislamiento por usuario se garantiza filtrando SIEMPRE por `usuario_id`.
"""

from __future__ import annotations

import json
import logging

from barb.core.db import fetch_all, fetch_one

logger = logging.getLogger("barb.chat_repo")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_titulo(primer_mensaje: str) -> str:
    """Genera un título corto a partir del primer mensaje del usuario."""
    text = (primer_mensaje or "").strip().replace("\n", " ")
    if not text:
        return "Conversación sin título"
    return text[:60] + ("…" if len(text) > 60 else "")


def _normalize_messages(raw) -> list[dict]:
    """Asegura que `messages` sea una lista de dicts (psycopg devuelve JSONB ya parseado)."""
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    return list(raw) if isinstance(raw, list) else []


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def create_session(
    usuario_id: int,
    empresa_id: int,
    primer_mensaje: str,
) -> str:
    """Crea una sesión nueva y devuelve su UUID (str)."""
    row = await fetch_one(
        """
        INSERT INTO chat_session (empresa_id, usuario_id, titulo, messages, metadata)
        VALUES (
            %(empresa_id)s,
            %(usuario_id)s,
            %(titulo)s,
            '[]'::jsonb,
            '{}'::jsonb
        )
        RETURNING session_id
        """,
        {
            "empresa_id": empresa_id,
            "usuario_id": usuario_id,
            "titulo": _make_titulo(primer_mensaje),
        },
    )
    if not row:
        raise RuntimeError("No se pudo crear la sesión de chat")
    return str(row["session_id"])


async def get_session(session_id: str, usuario_id: int) -> dict | None:
    """Devuelve la sesión si pertenece al usuario; None en caso contrario."""
    return await fetch_one(
        """
        SELECT session_id, usuario_id, empresa_id, titulo, messages, saved_at
        FROM chat_session
        WHERE session_id = %(sid)s AND usuario_id = %(uid)s
        LIMIT 1
        """,
        {"sid": session_id, "uid": usuario_id},
    )


async def load_messages(session_id: str, usuario_id: int) -> list[dict]:
    """Devuelve la lista de mensajes de la sesión, o [] si no existe / no pertenece."""
    row = await get_session(session_id, usuario_id)
    if not row:
        return []
    return _normalize_messages(row.get("messages"))


async def append_messages(
    session_id: str,
    usuario_id: int,
    nuevos: list[dict],
) -> bool:
    """Agrega mensajes al array JSONB. Devuelve True si actualizó alguna fila."""
    if not nuevos:
        return True

    row = await fetch_one(
        """
        UPDATE chat_session
        SET messages = messages || %(nuevos)s::jsonb,
            saved_at = NOW()
        WHERE session_id = %(sid)s AND usuario_id = %(uid)s
        RETURNING session_id
        """,
        {
            "nuevos": json.dumps(nuevos, ensure_ascii=False),
            "sid": session_id,
            "uid": usuario_id,
        },
    )
    return row is not None


async def list_by_user(
    usuario_id: int,
    limit: int = 20,
    offset: int = 0,
) -> list[dict]:
    """Lista las sesiones del usuario con metadatos para la tabla de historial."""
    return await fetch_all(
        """
        SELECT session_id,
               titulo,
               saved_at,
               saved_by,
               machine_name,
               discipline,
               plant_name,
               jsonb_array_length(messages) AS message_count
        FROM chat_session
        WHERE usuario_id = %(uid)s
        ORDER BY saved_at DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        {"uid": usuario_id, "limit": limit, "offset": offset},
    )


async def delete_session(session_id: str, usuario_id: int) -> bool:
    """Borra una sesión del usuario. Devuelve True si existía."""
    row = await fetch_one(
        """
        DELETE FROM chat_session
        WHERE session_id = %(sid)s AND usuario_id = %(uid)s
        RETURNING session_id
        """,
        {"sid": session_id, "uid": usuario_id},
    )
    return row is not None