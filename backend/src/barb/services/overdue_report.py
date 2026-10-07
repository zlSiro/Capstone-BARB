"""
Reporte de OTs atrasadas por correo.

Atrasada = estado no final (≠ completed/cancelled) con `fecha_vencimiento` ya
pasada. Las OT sin fecha de vencimiento se ignoran. Los días de atraso se
cuentan por fecha calendario en la zona `settings.notif_timezone`.

`run_overdue_job` lo invoca el cron externo (`POST /api/jobs/ot-atrasadas`) o el
script `scripts/run_overdue_job.py`: recorre las empresas con notificación
activa, decide si "toca" enviar (`debe_enviar`) y manda un correo por empresa.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from html import escape
from zoneinfo import ZoneInfo

from barb.core.config import settings
from barb.core.db import execute, fetch_all, fetch_one
from barb.core.work_order_states import ETIQUETA_ES
from barb.services.email_service import send_email

logger = logging.getLogger("barb.overdue")

_TD = "padding:6px 10px;border:1px solid #ddd"


def _tz() -> ZoneInfo:
    return ZoneInfo(settings.notif_timezone)


# =============================================================================
# Consulta
# =============================================================================

async def fetch_ots_atrasadas(empresa_id: int) -> list[dict]:
    """OTs abiertas con vencimiento pasado de UNA empresa, las más atrasadas primero."""
    return await fetch_all(
        """
        SELECT
            ot.numero_ot,
            m.nombre AS maquina,
            COALESCE(u.nombre, '—') AS tecnico,
            ot.fecha_vencimiento,
            ot.priority,
            ot.estado,
            ((NOW() AT TIME ZONE %(tz)s)::date - ot.fecha_vencimiento::date) AS dias_atraso
        FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        LEFT JOIN usuario u ON u.usuario_id = ot.tecnico_id
        WHERE p.empresa_id = %(empresa_id)s
          AND ot.estado NOT IN ('completed', 'cancelled')
          AND ot.fecha_vencimiento IS NOT NULL
          AND ot.fecha_vencimiento < (NOW() AT TIME ZONE %(tz)s)
        ORDER BY ot.fecha_vencimiento ASC, ot.numero_ot
        """,
        {"empresa_id": empresa_id, "tz": settings.notif_timezone},
    )


# =============================================================================
# Frecuencia
# =============================================================================

def ultimo_slot(config: dict, ahora: datetime) -> datetime:
    """Último instante programado (<= ahora) según frecuencia/hora/día de la config."""
    slot = ahora.replace(hour=config["hora"], minute=0, second=0, microsecond=0)
    if config["frecuencia"] == "semanal":
        slot -= timedelta(days=(ahora.weekday() - config["dia_semana"]) % 7)
    if slot > ahora:
        slot -= timedelta(days=7 if config["frecuencia"] == "semanal" else 1)
    return slot


def debe_enviar(config: dict, ahora: datetime) -> bool:
    """True si ya pasó el último slot programado y aún no se envió para ese slot.

    `ahora` debe ser tz-aware (en `notif_timezone`). Idempotente: dos llamadas
    dentro del mismo período solo envían la primera vez.
    """
    if not config.get("activo") or not config.get("destinatarios"):
        return False
    ultimo = config.get("ultimo_envio")
    return ultimo is None or ultimo < ultimo_slot(config, ahora)


# =============================================================================
# Render
# =============================================================================

def render_reporte(empresa_nombre: str, ots: list[dict]) -> tuple[str, str, str]:
    """Devuelve (asunto, html, texto)."""
    n = len(ots)
    asunto = f"[BARB] {n} OT atrasada{'s' if n != 1 else ''} — {empresa_nombre}"

    filas_html = "".join(
        "<tr>"
        f"<td style='{_TD}'>{escape(ot['numero_ot'])}</td>"
        f"<td style='{_TD}'>{escape(ot['maquina'])}</td>"
        f"<td style='{_TD}'>{escape(ot['tecnico'])}</td>"
        f"<td style='{_TD}'>{escape(ETIQUETA_ES.get(ot['estado'], ot['estado']))}</td>"
        f"<td style='{_TD};text-align:right'><b>{ot['dias_atraso']}</b></td>"
        "</tr>"
        for ot in ots
    )
    link = (
        f"<p><a href='{escape(settings.frontend_url)}/work-orders'>Ver órdenes de trabajo en BARB</a></p>"
        if settings.frontend_url
        else ""
    )
    html = (
        "<div style='font-family:Arial,sans-serif;font-size:14px;color:#222'>"
        f"<h2 style='margin:0 0 8px'>OTs atrasadas — {escape(empresa_nombre)}</h2>"
        f"<p>Hay <b>{n}</b> orden{'es' if n != 1 else ''} de trabajo con el plazo vencido:</p>"
        "<table style='border-collapse:collapse'><thead><tr style='background:#f3f4f6'>"
        f"<th style='{_TD};text-align:left'>ID</th>"
        f"<th style='{_TD};text-align:left'>Máquina</th>"
        f"<th style='{_TD};text-align:left'>Técnico</th>"
        f"<th style='{_TD};text-align:left'>Estado</th>"
        f"<th style='{_TD};text-align:right'>Días de atraso</th>"
        f"</tr></thead><tbody>{filas_html}</tbody></table>"
        f"{link}"
        "<p style='color:#888;font-size:12px'>Correo automático de BARB.</p></div>"
    )

    lineas = [f"OTs atrasadas — {empresa_nombre}", f"{n} orden(es) con el plazo vencido:", ""]
    lineas += [
        f"- {ot['numero_ot']} | {ot['maquina']} | {ot['tecnico']} | "
        f"{ot['dias_atraso']} día(s) de atraso"
        for ot in ots
    ]
    if settings.frontend_url:
        lineas += ["", f"{settings.frontend_url}/work-orders"]
    return asunto, html, "\n".join(lineas)


# =============================================================================
# Job
# =============================================================================

async def get_config(empresa_id: int) -> dict | None:
    return await fetch_one("SELECT * FROM notificacion_config WHERE empresa_id = %(e)s", {"e": empresa_id})


async def enviar_reporte_empresa(empresa_id: int, destinatarios: list[str], *, enviar_vacio: bool = False) -> dict:
    """Consulta las OTs atrasadas de la empresa y envía el correo. No toca `ultimo_envio`."""
    empresa = await fetch_one("SELECT nombre FROM empresa WHERE empresa_id = %(e)s", {"e": empresa_id})
    nombre = empresa["nombre"] if empresa else f"Empresa {empresa_id}"
    ots = await fetch_ots_atrasadas(empresa_id)
    if not ots and not enviar_vacio:
        return {"empresa_id": empresa_id, "enviado": False, "ots": 0, "motivo": "sin_ots_atrasadas"}
    asunto, html, texto = render_reporte(nombre, ots)
    await send_email(destinatarios, asunto, html, texto)
    return {"empresa_id": empresa_id, "enviado": True, "ots": len(ots), "destinatarios": len(destinatarios)}


async def run_overdue_job(*, force: bool = False, empresa_id: int | None = None) -> list[dict]:
    """Procesa las empresas con notificación activa. `force` ignora la frecuencia."""
    ahora = datetime.now(_tz())
    configs = await fetch_all(
        """
        SELECT nc.* FROM notificacion_config nc
        JOIN empresa e ON e.empresa_id = nc.empresa_id
        WHERE nc.activo AND e.estado NOT IN ('suspended', 'cancelled')
          AND (%(empresa_id)s::int IS NULL OR nc.empresa_id = %(empresa_id)s::int)
        ORDER BY nc.empresa_id
        """,
        {"empresa_id": empresa_id},
    )
    resultados: list[dict] = []
    for cfg in configs:
        eid = cfg["empresa_id"]
        if not force and not debe_enviar(cfg, ahora):
            resultados.append({"empresa_id": eid, "enviado": False, "motivo": "fuera_de_horario_o_ya_enviado"})
            continue
        if not cfg["destinatarios"]:
            resultados.append({"empresa_id": eid, "enviado": False, "motivo": "sin_destinatarios"})
            continue
        try:
            res = await enviar_reporte_empresa(eid, list(cfg["destinatarios"]))
        except Exception as exc:  # una empresa con SMTP/destinatario roto no frena a las demás
            logger.exception("Falló el envío de OTs atrasadas (empresa %s)", eid)
            resultados.append({"empresa_id": eid, "enviado": False, "motivo": "error_envio", "detalle": str(exc)})
            continue
        if res["enviado"]:
            await execute("UPDATE notificacion_config SET ultimo_envio = NOW() WHERE empresa_id = %(e)s", {"e": eid})
        resultados.append(res)
    return resultados
