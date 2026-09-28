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

from typing import AsyncIterator

import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from barb.main import app


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