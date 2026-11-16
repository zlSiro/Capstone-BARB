"""
Verificación manual de la HU-22 desde local: ¿el chat conserva el contexto si se
reinicia el backend?

La suite automatizada (`tests/test_persistencia_reinicio.py`) prueba la continuidad
contra la BD real, pero con un modelo falso. Este script hace la prueba de humo con el
modelo de verdad y con el backend corriendo, en dos pasos para poder reiniciar el
proceso entre medio:

    # 1) terminal A — backend local
    uv run fastapi dev src/barb/main.py --port 9000

    # 2) terminal B — primer turno
    uv run python scripts/verificar_contexto_persistente.py inicio
    # imprime SESSION=<uuid> y una frase con un dato inventado (no está en los manuales)

    # 3) Ctrl+C en la terminal A y volver a levantar el backend (esto es el "reinicio")

    # 4) terminal B — segundo turno sobre la MISMA sesión
    uv run python scripts/verificar_contexto_persistente.py continuar --session <uuid>

Si el segundo turno repite el dato y el detalle de la sesión muestra los 4 mensajes,
el contexto sobrevivió al reinicio. El script termina con código 1 si no se cumple.

Contra otro backend (Render, o local apuntando a Supabase):

    uv run python scripts/verificar_contexto_persistente.py inicio --base-url https://barb-api.onrender.com
    # o local con la BD de Supabase: DATABASE_URL="postgresql://..." uv run fastapi dev src/barb/main.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

import httpx

# Dato inventado a propósito: no aparece en los manuales de la empresa, así que si el
# segundo turno lo repite es porque vino del historial de la conversación y no del RAG.
DATO_PRUEBA = "ZX-4821"
TURNO_1 = (
    f"Anota este dato para una prueba de memoria: mi código de verificación es {DATO_PRUEBA}. "
    "Confírmame que lo anotaste."
)
TURNO_2 = (
    "¿Cuál era el código de verificación que te dije antes? "
    "Responde solo con el código, sin explicaciones."
)


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
) -> tuple[str, str]:
    """Envía un turno por SSE y devuelve `(session_id, texto_de_la_respuesta)`."""
    payload: dict[str, object] = {"message": mensaje}
    if session_id:
        payload["session_id"] = session_id

    session = session_id or ""
    trozos: list[str] = []
    evento = None

    async with client.stream("POST", "/api/chat/stream", headers=headers, json=payload, timeout=None) as resp:
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


def _imprimir_mensajes(mensajes: list[dict]) -> None:
    print(f"  Mensajes persistidos en la BD: {len(mensajes)}")
    for m in mensajes:
        contenido = " ".join(str(m.get("content") or "").split())
        print(f"    - [{m.get('role')}] {contenido[:90]}")


async def inicio(args: argparse.Namespace) -> None:
    async with httpx.AsyncClient(base_url=args.base_url, timeout=None) as client:
        headers = await _login(client, args.email, args.password)
        session_id, respuesta = await _turno(client, headers, TURNO_1)

    print(f"SESSION={session_id}")
    print(f"Respuesta del turno 1:\n  {respuesta or '(vacía)'}")
    print()
    print("Ahora reinicia el backend (Ctrl+C y volver a levantarlo) y ejecuta:")
    print(f"  uv run python scripts/verificar_contexto_persistente.py continuar --session {session_id}")


async def continuar(args: argparse.Namespace) -> None:
    async with httpx.AsyncClient(base_url=args.base_url, timeout=None) as client:
        headers = await _login(client, args.email, args.password)

        antes = await _detalle(client, headers, args.session)
        print("Antes del turno 2 (leído de la BD por el proceso nuevo):")
        _imprimir_mensajes(antes)

        _, respuesta = await _turno(client, headers, TURNO_2, args.session)

        despues = await _detalle(client, headers, args.session)
        print("\nDespués del turno 2:")
        _imprimir_mensajes(despues)

    print(f"\nRespuesta del turno 2:\n  {respuesta or '(vacía)'}")

    recordado = DATO_PRUEBA.lower() in respuesta.lower()
    persistido = len(antes) >= 2 and len(despues) == len(antes) + 2

    print()
    if recordado:
        print(f"OK: el modelo recordó «{DATO_PRUEBA}» después del reinicio.")
    else:
        print(f"FALLO: el modelo no recordó «{DATO_PRUEBA}» (puede ser no determinismo; reintenta).")

    if persistido:
        print(f"OK: la conversación creció de {len(antes)} a {len(despues)} mensajes en la BD.")
    else:
        print("FALLO: el detalle de la sesión no muestra el turno nuevo.")

    sys.exit(0 if recordado and persistido else 1)


async def estado(args: argparse.Namespace) -> None:
    async with httpx.AsyncClient(base_url=args.base_url, timeout=30) as client:
        headers = await _login(client, args.email, args.password)
        mensajes = await _detalle(client, headers, args.session)
    _imprimir_mensajes(mensajes)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verifica que el chat mantenga el contexto al reiniciar el backend (HU-22).")
    parser.add_argument("modo", choices=["inicio", "continuar", "estado"])
    parser.add_argument("--session", help="UUID de la sesión (lo imprime el modo `inicio`).")
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument("--email", default="tecnico1@mineradelnorte.cl")
    parser.add_argument("--password", default="mineria123")
    args = parser.parse_args()

    if args.modo in ("continuar", "estado") and not args.session:
        parser.error(f"el modo `{args.modo}` requiere --session <uuid>")

    asyncio.run({"inicio": inicio, "continuar": continuar, "estado": estado}[args.modo](args))


if __name__ == "__main__":
    main()
