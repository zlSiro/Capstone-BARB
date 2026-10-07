"""
Notificaciones por correo de OTs atrasadas.

- `POST /api/jobs/ot-atrasadas`: lo llama un cron externo (auth por `X-Job-Token`, no por sesión).
- `/api/notificaciones/*`: configuración por empresa (frecuencia y destinatarios), prueba y vista previa.
"""

from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException

from barb.core.config import settings
from barb.core.db import execute
from barb.core.permissions import empresa_obligatoria, get_sesion_actual, require_action
from barb.schemas.notifications import NotificacionConfigIn, NotificacionConfigOut
from barb.services.email_service import EmailNoConfigurado
from barb.services.overdue_report import (
    enviar_reporte_empresa,
    fetch_ots_atrasadas,
    get_config,
    run_overdue_job,
)

logger = logging.getLogger("barb.notifications")

router = APIRouter()

_DEFAULTS = {"activo": False, "frecuencia": "diaria", "hora": 8, "dia_semana": None, "destinatarios": [], "ultimo_envio": None}


# --- Job (cron externo) -------------------------------------------------------

async def require_job_token(x_job_token: str = Header("", alias="X-Job-Token")) -> None:
    if not settings.job_token:
        raise HTTPException(status_code=503, detail="Job deshabilitado: JOB_TOKEN no configurado.")
    if not secrets.compare_digest(x_job_token, settings.job_token):
        raise HTTPException(status_code=401, detail="Token de job inválido.")


@router.post("/api/jobs/ot-atrasadas", dependencies=[Depends(require_job_token)])
async def job_ot_atrasadas(force: bool = False, empresa_id: int | None = None):
    """Envía el reporte a cada empresa a la que "toca" según su frecuencia. Idempotente por período."""
    if not settings.smtp_configurado:
        raise HTTPException(status_code=503, detail="SMTP no configurado.")
    resultados = await run_overdue_job(force=force, empresa_id=empresa_id)
    return {
        "empresas_procesadas": len(resultados),
        "enviados": sum(1 for r in resultados if r.get("enviado")),
        "resultados": resultados,
    }


# --- Configuración por empresa ------------------------------------------------

@router.get(
    "/api/notificaciones/config",
    response_model=NotificacionConfigOut,
    dependencies=[Depends(require_action("configurar_notificaciones"))],
)
async def get_notificacion_config(empresa_id: int | None = None, sesion: dict = Depends(get_sesion_actual)):
    eid = empresa_obligatoria(sesion, empresa_id)
    cfg = await get_config(eid) or {"empresa_id": eid, **_DEFAULTS}
    return cfg


@router.put(
    "/api/notificaciones/config",
    response_model=NotificacionConfigOut,
    dependencies=[Depends(require_action("configurar_notificaciones"))],
)
async def put_notificacion_config(
    payload: NotificacionConfigIn, empresa_id: int | None = None, sesion: dict = Depends(get_sesion_actual)
):
    eid = empresa_obligatoria(sesion, empresa_id)
    await execute(
        """
        INSERT INTO notificacion_config (empresa_id, activo, frecuencia, hora, dia_semana, destinatarios)
        VALUES (%(e)s, %(activo)s, %(frecuencia)s, %(hora)s, %(dia)s, %(dest)s)
        ON CONFLICT (empresa_id) DO UPDATE SET
            activo = EXCLUDED.activo,
            frecuencia = EXCLUDED.frecuencia,
            hora = EXCLUDED.hora,
            dia_semana = EXCLUDED.dia_semana,
            destinatarios = EXCLUDED.destinatarios,
            updated_at = NOW()
        """,
        {
            "e": eid,
            "activo": payload.activo,
            "frecuencia": payload.frecuencia,
            "hora": payload.hora,
            "dia": payload.dia_semana,
            "dest": payload.destinatarios,
        },
    )
    return await get_config(eid)


# --- Prueba y vista previa ----------------------------------------------------

@router.post("/api/notificaciones/prueba", dependencies=[Depends(require_action("configurar_notificaciones"))])
async def enviar_prueba(empresa_id: int | None = None, sesion: dict = Depends(get_sesion_actual)):
    """Envía el reporte ahora a los destinatarios guardados (aunque no haya OTs atrasadas)."""
    eid = empresa_obligatoria(sesion, empresa_id)
    cfg = await get_config(eid)
    if not cfg or not cfg["destinatarios"]:
        raise HTTPException(status_code=422, detail="Configura al menos un destinatario antes de enviar la prueba.")
    try:
        return await enviar_reporte_empresa(eid, list(cfg["destinatarios"]), enviar_vacio=True)
    except EmailNoConfigurado as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Falló el correo de prueba (empresa %s)", eid)
        raise HTTPException(status_code=502, detail=f"No se pudo enviar el correo: {exc}") from exc


@router.get("/api/notificaciones/preview", dependencies=[Depends(require_action("configurar_notificaciones"))])
async def preview_ots_atrasadas(empresa_id: int | None = None, sesion: dict = Depends(get_sesion_actual)):
    eid = empresa_obligatoria(sesion, empresa_id)
    ots = await fetch_ots_atrasadas(eid)
    return {"empresa_id": eid, "total": len(ots), "ots": ots}
