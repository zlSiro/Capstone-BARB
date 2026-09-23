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
    db_status = await health()
    has_key = bool(settings.deepseek_api_key)

    lm_status = {
        "status": "online" if has_key else "offline",
        "detail": (
            "API Key de DeepSeek configurada correctamente."
            if has_key
            else "Falta configurar DEEPSEEK_API_KEY en el entorno."
        ),
    }

    overall = "online" if db_status.get("status") == "online" and has_key else "degraded"
    return {"status": overall, "db": db_status, "llm": lm_status}
