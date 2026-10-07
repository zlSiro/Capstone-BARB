from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from barb.core.cache import close_redis_client
from barb.core.config import settings
from barb.core.db import close_pool, execute, open_pool
from barb.routers import (
    auth,
    catalog,
    chat,
    documents,
    empresas,
    health,
    notifications,
    preferences,
    stats,
    topology,
    users,
    work_orders,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("barb.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_pool()

    # --- Validar que la API key del proveedor LLM activo esté configurada ---
    if settings.llm_provider == "deepseek" and not settings.deepseek_api_key:
        logger.warning("DEEPSEEK_API_KEY no configurada (requerido para el chat IA, HU-03).")
    elif settings.llm_provider == "openai" and not settings.openai_api_key:
        logger.warning("OPENAI_API_KEY no configurada (requerido para el chat IA, HU-03).")
    else:
        logger.info(
            "Chat IA configurado con proveedor: %s (modelo: %s)",
            settings.llm_provider,
            settings.llm_model,
        )

    # --- Limpieza de sesiones expiradas al arrancar ---
    try:
        eliminadas_row = await _cleanup_expired_sessions()
        if eliminadas_row:
            logger.info("%s sesión(es) expirada(s) eliminadas.", eliminadas_row)
    except Exception:
        logger.exception("No se pudo limpiar sesiones expiradas al iniciar.")

    yield

    await close_pool()
    await close_redis_client()


async def _cleanup_expired_sessions() -> None:
    await execute("DELETE FROM sesion WHERE expira_en < NOW();")


app = FastAPI(title="BARB Plant Memory API", version="3.0.0", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(empresas.router)
app.include_router(documents.router)
app.include_router(catalog.router)
app.include_router(topology.router)
app.include_router(stats.router)
app.include_router(work_orders.router)
app.include_router(preferences.router)
app.include_router(chat.router)
app.include_router(notifications.router)