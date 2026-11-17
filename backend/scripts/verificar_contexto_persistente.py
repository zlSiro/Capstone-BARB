"""
Verificación manual de la HU-22: ¿el chat conserva el contexto si se reinicia el backend?

La suite automatizada (`tests/test_persistencia_reinicio.py`) prueba la continuidad
contra la BD real, pero con un modelo falso. Este script hace la prueba de humo con el
modelo de verdad y con el backend corriendo, en dos pasos para poder reiniciar el
proceso entre medio.

**Ejecutar SIEMPRE desde `backend/`** (el script no está en la raíz del repo):

    # 1) terminal A — backend local
    uv run fastapi dev src/barb/main.py --port 9000

    # 2) terminal B — primer turno (texto)
    uv run python scripts/verificar_contexto_persistente.py texto

    # 3) Ctrl+C en la terminal A y volver a levantar el backend (esto ES el reinicio)

    # 4) terminal B — segundo turno sobre la MISMA sesión
    uv run python scripts/verificar_contexto_persistente.py continuar

El UUID no se copia a mano: queda guardado en `backend/.hu22_session`. Si prefieres
pasarlo explícito, `--session <uuid-real>` (sin los `<>`: `<` es redirección del shell).

Modos:
    texto      turno 1 textual con un dato inventado (no está en los manuales).
    imagen     turno 1 multimodal con una imagen de prueba generada al vuelo.
    continuar  turno 2 sobre la sesión guardada; verifica que el contexto sobrevivió.
    estado     muestra los mensajes persistidos de la sesión (leídos de la BD).

Contra otro backend (Render):

    uv run python scripts/verificar_contexto_persistente.py texto --base-url https://barb-api.onrender.com
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import re
import struct
import sys
import unicodedata
import zlib
from pathlib import Path

import httpx

# Dato inventado a propósito: no aparece en los manuales de la empresa, así que si el
# segundo turno lo repite es porque vino del historial de la conversación y no del RAG.
DATO_PRUEBA = "ZX-4821"
PREGUNTA_TEXTO = (
    f"Anota este dato para una prueba de memoria: mi código de verificación es {DATO_PRUEBA}. "
    "Confírmame que lo anotaste."
)
PREGUNTA_IMAGEN = "¿Qué se ve en esta imagen? Descríbelo en una sola frase corta."
# El chequeo es determinista a propósito: repetir la primera frase del turno anterior
# sólo se puede hacer con el historial a la vista. Pedirle que «recuerde» un dato libre
# depende de que quiera anotarlo (este asistente se niega a guardar datos inventados).
PREGUNTA_CONTINUACION = (
    "Responde solo con la primera frase de tu mensaje anterior, palabra por palabra, sin agregar nada."
)

ARCHIVO_SESION = Path(__file__).with_name(".hu22_session")


# ---------------------------------------------------------------------------
# Imagen de prueba (PNG generado sin dependencias externas)
# ---------------------------------------------------------------------------

def _png_de_prueba(lado: int = 256) -> str:
    """
    PNG de franjas diagonales como data URL.

    No hace falta una foto real: lo que se verifica es que el TEXTO del turno con
    imagen quede en la base y llegue al turno siguiente. Cualquier imagen válida sirve
    (el modelo responderá «no distingo el equipo», y eso también es texto persistido).
    """

    filas = bytearray()
    for y in range(lado):
        filas.append(0)  # filtro "none"
        for x in range(lado):
            franja = ((x + y) // 16) % 2
            filas.extend((40, 90, 200) if franja else (230, 180, 60))

    def bloque(tipo: bytes, datos: bytes) -> bytes:
        return (
            struct.pack(">I", len(datos))
            + tipo
            + datos
            + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + bloque(b"IHDR", struct.pack(">IIBBBBB", lado, lado, 8, 2, 0, 0, 0))
        + bloque(b"IDAT", zlib.compress(bytes(filas), 9))
        + bloque(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode()


# ---------------------------------------------------------------------------
# Cliente HTTP
# ---------------------------------------------------------------------------

async def _login(client: httpx.AsyncClient, email: str, password: str) -> dict[str, str]:
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    if resp.status_code != 200:
        raise SystemExit(f"Login falló ({resp.status_code}): {resp.text}")
    return {"Authorization": f"Bearer {resp.json()['token']}"}


async def _turno(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    mensaje: str,
    session_id: str | None = None,
    imagen: str | None = None,
) -> tuple[str, str]:
    """Envía un turno por SSE y devuelve `(session_id, texto_de_la_respuesta)`."""
    ruta = "/api/chat/multimedia" if imagen else "/api/chat/stream"
    payload: dict[str, object] = {"message": mensaje}
    if session_id:
        payload["session_id"] = session_id
    if imagen:
        payload["image_base64"] = imagen

    session = session_id or ""
    trozos: list[str] = []
    evento = None

    async with client.stream("POST", ruta, headers=headers, json=payload, timeout=None) as resp:
        if resp.status_code != 200:
            detalle = (await resp.aread()).decode(errors="replace")
            raise SystemExit(f"El chat respondió {resp.status_code}: {detalle}")

        async for linea in resp.aiter_lines():
            if linea.startswith("event:"):
                evento = linea[6:].strip()
            elif linea.startswith("data:"):
                data = linea[5:].strip()
                if evento == "session":
                    session = json.loads(data)["session_id"]
                elif evento == "token":
                    trozos.append(json.loads(data)["text"])
                elif evento == "error":
                    raise SystemExit(f"El backend devolvió un error: {data}")
                evento = None

    return session, "".join(trozos).strip()


async def _detalle(client: httpx.AsyncClient, headers: dict[str, str], session_id: str) -> list[dict]:
    resp = await client.get(f"/api/chat/sessions/{session_id}", headers=headers)
    resp.raise_for_status()
    return resp.json().get("messages", [])


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def _imprimir_mensajes(mensajes: list[dict]) -> None:
    print(f"  Mensajes persistidos en la BD: {len(mensajes)}")
    for m in mensajes:
        contenido = " ".join(str(m.get("content") or "").split())
        marca = " [imagen]" if m.get("has_image") else ""
        print(f"    - [{m.get('role')}]{marca} {contenido[:90]}")


def _guardar_sesion(session_id: str, modo: str) -> None:
    ARCHIVO_SESION.write_text(json.dumps({"session": session_id, "modo": modo}), encoding="utf-8")


def _leer_sesion() -> tuple[str | None, str]:
    if not ARCHIVO_SESION.exists():
        return None, ""
    try:
        datos = json.loads(ARCHIVO_SESION.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None, ""
    return datos.get("session"), datos.get("modo", "")


def _primera_frase(texto: str) -> str:
    frase = re.split(r"(?<=[.!?])\s+", texto.strip(), maxsplit=1)[0]
    return " ".join(frase.split())


def _normalizar(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFKD", texto.lower())
    return " ".join(re.sub(r"[^a-z0-9áéíóúñ ]", " ", sin_tildes).split())


def _parecido(a: str, b: str) -> float:
    """Proporción de palabras de `a` que aparecen en `b` (0..1)."""
    palabras = [p for p in _normalizar(a).split() if len(p) > 3]
    if not palabras:
        return 0.0
    normalizado_b = _normalizar(b)
    return sum(1 for p in palabras if p in normalizado_b) / len(palabras)


# ---------------------------------------------------------------------------
# Modos
# ---------------------------------------------------------------------------

async def _primer_turno(args: argparse.Namespace, imagen: str | None) -> None:
    modo = "imagen" if imagen else "texto"
    pregunta = PREGUNTA_IMAGEN if imagen else PREGUNTA_TEXTO

    async with httpx.AsyncClient(base_url=args.base_url, timeout=None) as client:
        headers = await _login(client, args.email, args.password)
        session_id, respuesta = await _turno(client, headers, pregunta, imagen=imagen)

    _guardar_sesion(session_id, modo)
    print(f"SESSION={session_id}  (guardado en {ARCHIVO_SESION})")
    print(f"Modo: {modo}")
    print(f"Respuesta del turno 1:\n  {respuesta or '(vacía)'}")
    print()
    print("Ahora reinicia el backend (Ctrl+C y volver a levantarlo) y ejecuta:")
    print("  uv run python scripts/verificar_contexto_persistente.py continuar")


async def texto(args: argparse.Namespace) -> None:
    await _primer_turno(args, imagen=None)


async def imagen(args: argparse.Namespace) -> None:
    await _primer_turno(args, imagen=_png_de_prueba())


async def continuar(args: argparse.Namespace) -> None:
    guardada, modo = _leer_sesion()
    session_id = args.session or guardada
    if not session_id:
        raise SystemExit(
            "No hay sesión guardada. Ejecuta primero `... verificar_contexto_persistente.py texto` "
            "(o `imagen`) desde la carpeta backend/."
        )

    async with httpx.AsyncClient(base_url=args.base_url, timeout=None) as client:
        headers = await _login(client, args.email, args.password)

        antes = await _detalle(client, headers, session_id)
        print("Antes del turno 2 (leído de la BD por el proceso nuevo):")
        _imprimir_mensajes(antes)

        _, respuesta = await _turno(client, headers, PREGUNTA_CONTINUACION, session_id)

        despues = await _detalle(client, headers, session_id)
        print("\nDespués del turno 2:")
        _imprimir_mensajes(despues)

    print(f"\nRespuesta del turno 2:\n  {respuesta or '(vacía)'}")

    previo = next((str(m.get("content") or "") for m in reversed(antes) if m.get("role") == "assistant"), "")
    primera = _primera_frase(previo)
    coincidencia = _parecido(primera, respuesta)
    recordado = coincidencia >= 0.6
    persistido = len(antes) >= 2 and len(despues) == len(antes) + 2

    print()
    print("Frase del turno anterior:", primera[:100])
    print(
        f"{'OK' if recordado else 'FALLO'}: el turno 2 la repite "
        f"({coincidencia:.0%} de coincidencia; se exige 60%)."
    )
    print(
        f"{'OK' if persistido else 'FALLO'}: la conversación creció de {len(antes)} a {len(despues)} mensajes en la BD."
    )
    if modo != "imagen" and DATO_PRUEBA.lower() in respuesta.lower():
        print(f"Además, el modelo mencionó «{DATO_PRUEBA}».")

    sys.exit(0 if recordado and persistido else 1)


async def estado(args: argparse.Namespace) -> None:
    guardada, _ = _leer_sesion()
    session_id = args.session or guardada
    if not session_id:
        raise SystemExit("No hay sesión guardada ni --session.")

    async with httpx.AsyncClient(base_url=args.base_url, timeout=30) as client:
        headers = await _login(client, args.email, args.password)
        mensajes = await _detalle(client, headers, session_id)
    _imprimir_mensajes(mensajes)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verifica que el chat mantenga el contexto al reiniciar el backend (HU-22)."
    )
    parser.add_argument("modo", choices=["texto", "imagen", "continuar", "estado"])
    parser.add_argument("--session", help="UUID real de la sesión (por defecto, la guardada en .hu22_session).")
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument("--email", default="tecnico1@mineradelnorte.cl")
    parser.add_argument("--password", default="mineria123")
    args = parser.parse_args()

    asyncio.run({"texto": texto, "imagen": imagen, "continuar": continuar, "estado": estado}[args.modo](args))


if __name__ == "__main__":
    main()
