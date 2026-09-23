from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis

from barb.core.config import settings

logger = logging.getLogger("barb.cache")

_redis_client: Redis | None = None
_redis_ready = False


async def get_redis_client() -> Redis | None:
    global _redis_client, _redis_ready
    if _redis_client is not None and _redis_ready:
        return _redis_client
    try:
        _redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
        await _redis_client.ping()
        _redis_ready = True
        return _redis_client
    except Exception as exc:
        logger.warning("Redis no disponible: %s", exc)
        _redis_client = None
        _redis_ready = False
        return None


async def close_redis_client() -> None:
    global _redis_client, _redis_ready
    if _redis_client is not None:
        await _redis_client.aclose()
    _redis_client = None
    _redis_ready = False


async def cache_get(key: str) -> Any | None:
    client = await get_redis_client()
    if not client:
        return None
    try:
        raw = await client.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl_seconds: int = 300) -> None:
    client = await get_redis_client()
    if not client:
        return
    try:
        await client.setex(key, ttl_seconds, json.dumps(value, default=str))
    except Exception:
        return
