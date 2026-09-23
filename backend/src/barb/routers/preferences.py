from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from barb.core.db import execute
from barb.core.permissions import get_sesion_actual

logger = logging.getLogger("barb.preferences")

router = APIRouter()


@router.put("/api/user/preferences")
@router.put("/user/preferences")
async def update_user_preferences(payload: dict, sesion: dict = Depends(get_sesion_actual)):
    try:
        await execute(
            "UPDATE usuario SET preferencias = %(prefs)s WHERE usuario_id = %(uid)s",
            {"prefs": json.dumps(payload), "uid": sesion["usuario_id"]},
        )
        return {"status": "success", "preferencias": payload}
    except Exception as e:
        logger.exception("Error al guardar preferencias")
        raise HTTPException(status_code=500, detail=f"Error al guardar preferencias: {str(e)}") from e
