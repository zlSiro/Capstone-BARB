"""Backfill de embeddings para los documentos ya subidos (HU-04 — Fase 1).

Rellena `documento_embedding` a partir de `documento_chunk`, que es lo que hoy tiene
texto pero no vector. Sin esto el RAG semántico no tiene nada que comparar: la tabla
existe, el índice HNSW existe y las funciones de búsqueda existen, pero están vacías.

Uso:

    python -m scripts.backfill_embeddings --dry-run   # valida modelo y dimension, no escribe
    python -m scripts.backfill_embeddings             # escribe los vectores que falten
    python -m scripts.backfill_embeddings --limit 5   # procesa como maximo 5 chunks
    python -m scripts.backfill_embeddings --force     # regenera tambien los ya vectorizados

El `--dry-run` embebe UN chunk de muestra y compara su tamano con el que exige la
columna. Es la comprobacion que evita el peor escenario: descubrir a mitad de un INSERT
multiple que el modelo no mide 2048.

Nota: la salida por stdout es ASCII a proposito. La consola de Windows usa cp1252 y
revienta con checkmarks o guiones largos, y un script de datos no debe caerse porque el
mensaje de error no se pudo imprimir.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from barb.core.db import close_pool, fetch_all, open_pool  # noqa: E402
from barb.services.document_repository import EMBEDDING_DIM, upsert_chunks  # noqa: E402
from barb.services.embeddings import (  # noqa: E402
    EmbeddingsNoConfigurados,
    embed_lote,
    embed_texto,
    embeddings_disponibles,
)

# Tamano de lote: NIM acepta varios textos por request y el free tier agradece no
# recibir 17 llamadas seguidas.
LOTE = 8


def _ok(msg: str) -> None:
    print(f"  [OK] {msg}")


def _err(msg: str) -> None:
    print(f"  [ERROR] {msg}")


async def _chunks_pendientes(force: bool) -> list[dict]:
    """
    Chunks que necesitan vector.

    Con `force` se traen todos; si no, solo los que aun no tienen fila en
    `documento_embedding` para su (documento_id, chunk_index).
    """
    condicion = (
        ""
        if force
        else """
        WHERE NOT EXISTS (
            SELECT 1 FROM documento_embedding e
             WHERE e.documento_id = c.documento_id
               AND e.chunk_index  = c.orden
        )
        """
    )
    return await fetch_all(
        f"""
        SELECT c.documento_id, c.orden, c.contenido, d.title
          FROM documento_chunk c
          JOIN documento d ON d.documento_id = c.documento_id
        {condicion}
         ORDER BY c.documento_id, c.orden
        """
    )


async def _total_actual() -> int:
    filas = await fetch_all("SELECT COUNT(*) AS n FROM documento_embedding")
    return int(filas[0]["n"]) if filas else 0


async def main() -> int:
    parser = argparse.ArgumentParser(description="Genera embeddings de los documentos.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="valida modelo y dimension sin escribir en la base",
    )
    parser.add_argument("--limit", type=int, default=0, help="maximo de chunks a procesar")
    parser.add_argument(
        "--force",
        action="store_true",
        help="regenera tambien los chunks que ya tienen vector",
    )
    args = parser.parse_args()

    print("=" * 70)
    print(" Backfill de embeddings: documento_chunk -> documento_embedding")
    print("=" * 70)

    if not embeddings_disponibles():
        _err("No hay modelo o key de embeddings configurados.")
        print("        Defini NVIDIA_API_KEY (o NVIDIA_EMBEDDINGS_API_KEY) en backend/.env.")
        return 2

    await open_pool()
    try:
        pendientes = await _chunks_pendientes(force=args.force)
        ya_embebidos = await _total_actual()
        print(f"  chunks con vector : {ya_embebidos}")
        print(f"  chunks pendientes : {len(pendientes)}")
        if args.limit:
            pendientes = pendientes[: args.limit]
            print(f"  limitado a        : {len(pendientes)}")

        if not pendientes:
            print("\n  Nada por hacer.")
            return 0

        # --- Dry run: validar el modelo y la dimension ---------------------------
        muestra = pendientes[0]
        print(
            f"\n  Embedding de prueba (documento_id={muestra['documento_id']}, "
            f"chunk={muestra['orden']})..."
        )
        vector = await embed_texto(muestra["contenido"])
        print(f"  dimension devuelta: {len(vector)}")
        print(f"  dimension exigida : {EMBEDDING_DIM}")
        if len(vector) != EMBEDDING_DIM:
            _err("La dimension no coincide: el INSERT fallaria.")
            print("        Cambiar de modelo exige migrar documento_embedding.embedding (AGENTS.md).")
            return 1
        _ok("Coincide: el modelo y la columna son compatibles.")

        if args.dry_run:
            print("\n[dry-run] No se escribio nada en la base.")
            return 0

        # --- Escritura -----------------------------------------------------------
        print(f"\n  Generando {len(pendientes)} vectores en lotes de {LOTE}...")
        por_documento: dict[int, list[tuple[int, str, list[float]]]] = {}
        procesados = 0

        for inicio in range(0, len(pendientes), LOTE):
            lote = pendientes[inicio : inicio + LOTE]
            vectores = await embed_lote([c["contenido"] for c in lote])
            for fila, vec in zip(lote, vectores, strict=True):
                por_documento.setdefault(int(fila["documento_id"]), []).append(
                    (int(fila["orden"]), str(fila["contenido"]), vec)
                )
            procesados += len(lote)
            print(f"    {procesados}/{len(pendientes)} chunks embebidos")

        escritos = 0
        for documento_id, chunks in por_documento.items():
            escritos += await upsert_chunks(documento_id, chunks)

        _ok(f"{escritos} vectores escritos en documento_embedding.")
        print(f"        total en la tabla: {await _total_actual()}")
        return 0
    except EmbeddingsNoConfigurados as e:
        _err(str(e))
        return 2
    except Exception as e:  # noqa: BLE001 — el script debe reportar, no reventar
        _err(f"{type(e).__name__}: {e}")
        return 1
    finally:
        await close_pool()


if __name__ == "__main__":
    # En Windows el loop proactor no soporta psycopg async (mismo patron que seed.py).
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(main()))
