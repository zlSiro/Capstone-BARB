import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    _original_new_event_loop = asyncio.new_event_loop

    def _forced_selector_new_event_loop():
        return asyncio.SelectorEventLoop()

    asyncio.new_event_loop = _forced_selector_new_event_loop
# ==== FIN FORCE ====

from typing import AsyncIterator  # noqa: E402

import pytest  
import pytest_asyncio  
from httpx import AsyncClient, ASGITransport  

from barb.core.db import close_pool, open_pool  
from barb.main import app  


# =============================================================================
# Refuerzo por si otro plugin resetea la policy
# =============================================================================

def pytest_configure(config):
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


# =============================================================================
# POOL DE BD (CGBIDA-150 / 151) — session-scoped
# =============================================================================

@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_pool() -> AsyncIterator[None]:
    await open_pool()
    try:
        yield
    finally:
        await close_pool()


# =============================================================================
# CLIENTE HTTP DE PRUEBA (CGBIDA-15)
# =============================================================================

@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Cliente HTTP asíncrono apuntando a la app FastAPI."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# =============================================================================
# DATOS DE PRUEBA REUTILIZABLES (CGBIDA-14)
# =============================================================================

@pytest_asyncio.fixture
def usuario_admin() -> dict:
    return {"email": "admin@barb.com", "password": "admin123"}


@pytest_asyncio.fixture
def usuario_tecnico() -> dict:
    return {"email": "carlos@planta.com", "password": "tecnico123"}


@pytest_asyncio.fixture
def maquina_ejemplo() -> dict:
    return {"nombre": "Máquina Test", "planta_id": 1, "disciplina_id": 1}


@pytest_asyncio.fixture
def ot_ejemplo() -> dict:
    return {
        "maquina_id": 1,
        "tecnico_id": 1,
        "tipo": "corrective",
        "descripcion_problema": "Falla de prueba",
        "priority": "medium",
    }