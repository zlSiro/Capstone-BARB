from __future__ import annotations

from fastapi import APIRouter

from barb.core.cache import get_redis_client
from barb.core.config import settings
from barb.core.db import fetch_one

router = APIRouter()


@router.get("/")
async def root():
    return {"service": "BARB API", "status": "online"}


@router.get("/health")
@router.get("/api/health")
async def health():
    try:
        await fetch_one("SELECT 1 AS ok")
        return {"status": "online"}
    except Exception as e:
        return {"status": "error_db", "detail": str(e)}


@router.get("/api/health/redis")
async def health_redis():
    client = await get_redis_client()
    if not client:
        return {"status": "offline"}
    try:
        return {"status": "online", "ping": await client.ping()}
    except Exception as exc:
        return {"status": "offline", "detail": str(exc)}


@router.get("/api/health/llm")
async def health_llm():
    """
    Estado del motor de IA: base de datos y proveedor de chat ACTIVO.

    Antes comprobaba `settings.deepseek_api_key` a mano, así que con
    `LLM_PROVIDER=nvidia` respondía «offline / falta DEEPSEEK_API_KEY» aunque el chat
    estuviera funcionando. Ahora pregunta a `settings.llm_configurado`, que resuelve la key
    del proveedor configurado, y devuelve cuál es y con qué modelo.
    """
    db_status = await health()
    configurado = settings.llm_configurado

    llm_status = {
        "status": "ok" if configurado else "offline",
        "provider": settings.llm_provider,
        "model": settings.llm_model,
        "detail": (
            f"Proveedor {settings.llm_provider} configurado ({settings.llm_env_var})."
            if configurado
            else f"Falta configurar {settings.llm_env_var} para el proveedor "
            f"{settings.llm_provider}."
        ),
    }

    db_ok = db_status.get("status") == "online"
    overall = "ok" if db_ok and configurado else "degraded"
    return {"status": overall, "db": db_status, "llm": llm_status}
