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
import re

from barb.core.db import fetch_all, fetch_one

logger = logging.getLogger("barb.chat_repo")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MAX_TITULO = 48
_MAX_PROBLEMA = 40

# Muletillas con las que la gente abre una consulta. No aportan al título y hacen que
# todas las filas empiecen igual («Necesito saber…»).
_MULETILLAS = re.compile(
    r"^(?:hola|buenas|buenos días|buenas tardes|buenas noches|por favor|"
    r"necesito saber|necesito|quisiera saber|quisiera|me gustaría saber|me gustaría|"
    r"quiero saber|quiero|puedes decirme|podrías decirme|me puedes decir|"
    r"me podrías decir|ayúdame a|ayudame a|dime|saber|por qué|porque|qué|que)"
    r"\b[\s,;:.\-–—]*",
    re.IGNORECASE,
)

# Conectores que quedan pegados al problema después de quitar el equipo («PUMP-E4 está
# vibrando» → «vibrando»).
_CONECTORES = re.compile(
    r"^(?:está|esta|están|estan|tiene|tienen|presenta|presentan|hace|hacen|"
    r"con|que|por|porque|debido a|a causa de)\b[\s,;:.¿?¡!\-–—]*",
    re.IGNORECASE,
)


_STOPWORDS_FINALES = frozenset(
    {
        "a", "al", "con", "de", "del", "el", "en", "la", "las", "los",
        "o", "para", "por", "un", "una", "unas", "unos", "y",
    }
)


def _recortar_palabras_finales(texto: str) -> str:
    """Quita puntuación y conectores sueltos al final de un título truncado."""
    limpio = (texto or "").strip(" ,;:.-–—")
    while limpio:
        cabeza, _, ultima = limpio.rpartition(" ")
        if not cabeza or ultima.lower() not in _STOPWORDS_FINALES:
            break
        limpio = cabeza.rstrip(" ,;:.-–—")
    return limpio


def _sin_muletillas(texto: str) -> str:
    limpio = " ".join((texto or "").split())
    while limpio:
        nuevo = _MULETILLAS.sub("", limpio, count=1).strip()
        if nuevo == limpio:
            break
        limpio = nuevo
    return limpio


def _frase_corta(texto: str, maximo: int = _MAX_TITULO) -> str:
    """Primera frase, sin muletillas y cortada en palabra completa (sin puntos suspensivos)."""
    text = _sin_muletillas(texto)
    if not text:
        return "Conversación sin título"

    fin = re.search(r"[.!?](\s|$)", text)
    frase = text[: fin.start()].strip() if fin else text
    if not frase:
        frase = text

    # El título no lleva signos de apertura («¿Cuál es…» → «Cuál es…»).
    frase = frase.lstrip("¿¡ ").strip()

    if len(frase) > maximo:
        frase = frase[:maximo].rsplit(" ", 1)[0].rstrip(" ,;:.-–—")

    frase = _recortar_palabras_finales(frase)

    # Al quitar la muletilla inicial la frase puede quedar en minúscula.
    frase = frase[:1].upper() + frase[1:] if frase else frase
    return frase or "Conversación sin título"


def _problema_despues_de_maquina(texto: str, nombre: str, codigo: str) -> str:
    """Texto que sigue a la mención del equipo, ya limpio y acotado."""
    text = " ".join((texto or "").split())
    if not text:
        return ""

    fin = -1
    for aguja in (codigo, nombre):
        if not aguja:
            continue
        for m in re.finditer(re.escape(aguja), text, flags=re.IGNORECASE):
            fin = max(fin, m.end())

    if fin < 0:
        # El usuario puede omitir palabras del nombre («el chancador» en vez de
        # «Chancador de mandíbulas»): basta con que aparezca un token significativo.
        for token in re.split(r"\W+", nombre or ""):
            if len(token) < 2:
                continue
            for m in re.finditer(rf"\b{re.escape(token)}\b", text, flags=re.IGNORECASE):
                fin = max(fin, m.end())

    resto = text[fin:] if fin >= 0 else text
    resto = re.sub(r"^[\s,;:.¿?¡!\-–—]+", "", resto)
    while resto:
        nuevo = _CONECTORES.sub("", resto, count=1).strip()
        if nuevo == resto:
            break
        resto = nuevo

    # Solo la primera cláusula: «vibrando demasiado y qué debo revisar» → «vibrando demasiado».
    resto = re.split(r"[.;:!?]|\s+y\s+", resto, maxsplit=1)[0].strip()
    resto = resto.strip(" ,;:.-–—")
    if len(resto) > _MAX_PROBLEMA:
        resto = resto[:_MAX_PROBLEMA].rsplit(" ", 1)[0].rstrip(" ,;:.-–—")
    return _recortar_palabras_finales(resto)


def _make_titulo(primer_mensaje: str, maquina: dict | None = None) -> str:
    """Título del historial.

    Si el primer mensaje identifica una máquina, usa «CÓDIGO — problema» (por ejemplo
    «PUMP-E4 — vibrando demasiado»). Si no, cae a la primera frase sin muletillas y sin
    puntos suspensivos.
    """
    if maquina:
        equipo = str(maquina.get("codigo") or maquina.get("nombre") or "").strip()
        problema = _problema_despues_de_maquina(
            primer_mensaje,
            str(maquina.get("nombre") or ""),
            str(maquina.get("codigo") or ""),
        )
        if equipo and problema:
            return f"{equipo} — {problema}"
        if equipo:
            return equipo
    return _frase_corta(primer_mensaje)


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
    """Crea una sesión nueva y devuelve su UUID (str).

    Si el primer mensaje menciona una única máquina de la empresa, se guarda también su
    nombre, planta y disciplina: son las columnas que muestra la columna «Equipo» del
    historial (CGBIDA-454). La detección es best-effort: si falla o hay ambigüedad, la
    sesión se crea igual y el título cae al formato de frase.
    """
    # Import perezoso: `ai_tools` arrastra LangChain y este módulo lo usan los tests y los
    # routers de historial, que no necesitan el grafo para listar sesiones.
    from barb.services.ai_tools import identificar_maquina

    maquina = await identificar_maquina(empresa_id, primer_mensaje)

    row = await fetch_one(
        """
        INSERT INTO chat_session (
            empresa_id, usuario_id, titulo, messages, metadata,
            machine_name, plant_name, discipline
        )
        VALUES (
            %(empresa_id)s,
            %(usuario_id)s,
            %(titulo)s,
            '[]'::jsonb,
            '{}'::jsonb,
            %(machine_name)s,
            %(plant_name)s,
            %(discipline)s
        )
        RETURNING session_id
        """,
        {
            "empresa_id": empresa_id,
            "usuario_id": usuario_id,
            "titulo": _make_titulo(primer_mensaje, maquina),
            "machine_name": (maquina or {}).get("nombre"),
            "plant_name": (maquina or {}).get("planta"),
            "discipline": (maquina or {}).get("disciplina"),
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


def ventana_de_memoria(mensajes: list[dict], limite: int | None) -> list[dict]:
    """
    Últimos `limite` mensajes, alineados al comienzo de un turno del usuario.

    `CHAT_MEMORY_WINDOW` estaba en la configuración pero nadie la aplicaba: se mandaba la
    conversación completa al modelo en cada turno, así que el coste de tokens crecía sin
    techo en conversaciones largas. Se aplica acá, en el único punto donde se lee el
    historial para el modelo.

    Dos detalles deliberados:
    - El recorte se alinea a un mensaje de usuario. Si el corte deja primero una respuesta
      del asistente, se descarta: una respuesta sin su pregunta confunde más que ayuda.
    - `limite` vacío o <= 0 significa «sin ventana». Se usa en el detalle de sesión, que
      tiene que mostrar la conversación completa al usuario.
    """
    if not limite or limite <= 0 or len(mensajes) <= limite:
        return mensajes

    recorte = mensajes[-limite:]
    while recorte and (recorte[0].get("role") or "").lower() != "user":
        recorte = recorte[1:]
    return recorte


async def load_messages(
    session_id: str, usuario_id: int, limite: int | None = None
) -> list[dict]:
    """
    Devuelve la lista de mensajes de la sesión, o [] si no existe / no pertenece.

    `limite` acota cuántos mensajes viajan al modelo (ver `ventana_de_memoria`). Sin
    `limite` se devuelve todo, que es lo correcto para mostrar la sesión al usuario.
    """
    row = await get_session(session_id, usuario_id)
    if not row:
        return []
    return ventana_de_memoria(_normalize_messages(row.get("messages")), limite)


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