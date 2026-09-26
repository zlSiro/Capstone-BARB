# Configuración del Entorno de Pruebas (BARB)

Este documento detalla la configuración inicial y la estrategia de pruebas automatizadas para el backend del proyecto BARB.

## Estrategia de Pruebas

Los tests corren contra la aplicación FastAPI real, usando la base de datos
PostgreSQL configurada en `backend/.env` (Docker local en desarrollo).

- **Requisito previo:** Docker con `barb_capstone_postgres` corriendo + `uv run alembic upgrade head` + `uv run python scripts/seed.py`.
- **Aislamiento:** Los tests no escriben en BD por ahora (solo lectura). Cuando se agreguen tests que mutan datos, se evaluará usar transacciones o un PostgreSQL efímero.
- **Futuro:** migrar a `testcontainers` para BD efímera por sesión de tests.

## Archivo de Configuración Global (`conftest.py`)

El siguiente código define la configuración global y los *fixtures* reutilizables para toda la suite de pruebas.

**Ruta del archivo:** `backend/tests/conftest.py`

```
"""
Configuración global de tests para BARB.

Estrategia:
- Cada test corre contra una base de datos SQLite en memoria aislada.
- Los fixtures inyectan las dependencias que la app necesita.
- No toca datos de desarrollo ni de producción.
"""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from barb.main import app


# =============================================================================
# CONFIGURACIÓN GENERAL
# =============================================================================

@pytest.fixture(scope="session")
def event_loop():
    """Loop compartido para toda la suite."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# =============================================================================
# CLIENTE HTTP DE PRUEBA (CGBIDA-15)
# =============================================================================

@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Cliente HTTP asíncrono apuntando a la app FastAPI en modo test."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# =============================================================================
# DATOS DE PRUEBA REUTILIZABLES (CGBIDA-14)
# =============================================================================

@pytest.fixture
def usuario_admin() -> dict:
    """Usuario admin de prueba (no se persiste en BD, solo para payloads)."""
    return {
        "email": "admin@test.local",
        "password": "test_password_123",
        "nombre": "Admin Test",
        "rol": "admin",
    }


@pytest.fixture
def usuario_tecnico() -> dict:
    """Usuario técnico de prueba."""
    return {
        "email": "tecnico@test.local",
        "password": "test_password_123",
        "nombre": "Técnico Test",
        "rol": "tecnico",
    }


@pytest.fixture
def maquina_ejemplo() -> dict:
    """Payload de máquina para pruebas."""
    return {
        "nombre": "Máquina Test",
        "planta_id": 1,
        "disciplina_id": 1,
    }


@pytest.fixture
def ot_ejemplo() -> dict:
    """Payload de orden de trabajo para pruebas."""
    return {
        "maquina_id": 1,
        "tecnico_id": 1,
        "tipo": "corrective",
        "descripcion_problema": "Falla de prueba",
        "priority": "medium",
    }

```

## Diccionario de Fixtures

| Fixture | Propósito | Ticket Asociado | 
 | ----- | ----- | ----- | 
| `event_loop` | Mantiene un event loop asíncrono a nivel de sesión para evitar conflictos entre tests. | General | 
| `client` | Proporciona un `AsyncClient` de `httpx` para hacer peticiones HTTP a la API FastAPI en los tests. | CGBIDA-15 | 
| `usuario_admin` | Payload JSON simulando un usuario con rol de Administrador. | CGBIDA-14 | 
| `usuario_tecnico` | Payload JSON simulando un usuario con rol de Técnico. | CGBIDA-14 | 
| `maquina_ejemplo` | Payload JSON con la estructura básica de una Máquina/Equipo. | CGBIDA-14 | 
| `ot_ejemplo` | Payload JSON con la estructura de una Orden de Trabajo (OT). | CGBIDA-14 | 
