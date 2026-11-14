"""Seed oficial de BARB: datos reales de las tres empresas industriales.

Aplica, en orden, los tres archivos de `backend/seeds/`:

    01_estructura.sql   precondiciones (extensión `vector` + chequeo del esquema)
    02_maestros.sql     empresas, usuarios, plantas, disciplinas, máquinas, sensores y topología
    03_operativos.sql   OTs de 24 meses, repuestos, mantenimiento, documentos y chat

Por qué son tres y no uno: la estructura la gobierna Alembic, el catálogo cambia poco y la
operación se regenera seguido. Separarlos permite re-aplicar solo la capa que hace falta.

Los seeds son **idempotentes**: se apoyan en claves naturales (RUT, email, código de
máquina/sensor, `numero_ot`), así que correr esto dos veces no duplica nada.

Requisito: la base migrada.

    docker compose up -d db
    cd backend
    uv run alembic upgrade head
    uv run python scripts/seed.py

Historial: antes este script aplicaba `seed_data.sql`, `seed_multiempresa.sql` y el
historial sintético de `seed_history.py`. Los tres quedaron obsoletos cuando el seed
realista reemplazó el catálogo genérico por equipos reales con manuales verificables.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from barb.core.db import close_pool, open_pool, pool  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("barb.seed")

SEEDS_DIR = Path(__file__).resolve().parent.parent / "seeds"

# El orden importa: 02 necesita el esquema que verifica 01, y 03 necesita el catálogo de 02.
ARCHIVOS = (
    "01_estructura.sql",
    "02_maestros.sql",
    "03_operativos.sql",
)


async def _aplicar(conn, nombre: str) -> None:
    """Ejecuta un archivo completo, tal como lo haría `psql -f`.

    Los archivos traen su propio `BEGIN; ... COMMIT;` y cientos de sentencias, así que
    la conexión va en **autocommit**: sin eso se abriría una transacción implícita y el
    `COMMIT` del archivo cerraría la nuestra, dejando el `DISABLE TRIGGER` sin control.
    """
    ruta = SEEDS_DIR / nombre
    if not ruta.exists():
        raise FileNotFoundError(f"Falta el seed {ruta}")

    sql = ruta.read_text(encoding="utf-8")
    async with conn.cursor() as cur:
        # Sin parámetros, psycopg usa el protocolo simple, que acepta varios comandos
        # en una sola llamada: es lo que permite enviar el archivo entero.
        await cur.execute(sql)
    logger.info("Aplicado %s", nombre)


async def main() -> None:
    await open_pool()
    try:
        async with pool.connection() as conn:
            # En conexiones async el atributo es de solo lectura: se cambia con el setter.
            await conn.set_autocommit(True)
            for nombre in ARCHIVOS:
                await _aplicar(conn, nombre)
        logger.info("Seed completo: 3 empresas industriales, 11 máquinas, 528 OTs.")
    finally:
        await close_pool()


if __name__ == "__main__":
    if sys.platform == "win32":
        # psycopg async no funciona sobre el ProactorEventLoop de Windows.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
