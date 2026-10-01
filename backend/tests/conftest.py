"""
Configuración global de tests para BARB.

Estrategia actual:
- Los tests corren contra la app FastAPI real usando AsyncClient.
- Usan la BD que esté configurada en backend/.env (local Docker).
- Los datos de prueba se insertan/limpian según sea necesario.

Nota: la estrategia de "SQLite en memoria" del README no aplica porque el
backend usa psycopg3 (async) con PostgreSQL-específico. Cuando se migre a
una estrategia de BD aislada real, actualizar este archivo.
"""
from __future__ import annotations

import asyncio
import sys
from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from barb.core import db
from barb.core.config import settings
from barb.main import app

# psycopg async no funciona con ProactorEventLoop (default en Windows).
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


# =============================================================================
# CLIENTE HTTP DE PRUEBA (CGBIDA-15)
# =============================================================================

@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Cliente HTTP asíncrono apuntando a la app FastAPI."""
    # ASGITransport no ejecuta el lifespan de la app: se abre/cierra el pool aquí.
    # Un AsyncConnectionPool no se puede reabrir y cada test usa su propio event loop,
    # así que se crea un pool nuevo por test (los helpers de db leen `db.pool` en cada llamada).
    db.pool = AsyncConnectionPool(
        conninfo=settings.database_url, min_size=1, max_size=4, kwargs={"row_factory": dict_row}, open=False
    )
    await db.open_pool()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        await db.close_pool()


# =============================================================================
# DATOS DE PRUEBA REUTILIZABLES (CGBIDA-14)
# =============================================================================

@pytest_asyncio.fixture
def usuario_admin() -> dict:
    """Payload de usuario admin para pruebas."""
    return {
        "email": "admin@barb.com",
        "password": "admin123",
    }


@pytest_asyncio.fixture
def usuario_tecnico() -> dict:
    """Payload de usuario técnico para pruebas."""
    return {
        "email": "carlos@planta.com",
        "password": "tecnico123",
    }


@pytest_asyncio.fixture
def maquina_ejemplo() -> dict:
    """Payload de máquina para pruebas."""
    return {
        "nombre": "Máquina Test",
        "planta_id": 1,
        "disciplina_id": 1,
    }


@pytest_asyncio.fixture
def ot_ejemplo() -> dict:
    """Payload de orden de trabajo para pruebas."""
    return {
        "maquina_id": 1,
        "tecnico_id": 1,
        "tipo": "corrective",
        "descripcion_problema": "Falla de prueba",
        "priority": "medium",
    }