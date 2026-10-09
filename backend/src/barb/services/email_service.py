"""Envío de correo por SMTP genérico (stdlib, sin dependencias nuevas)."""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from barb.core.config import settings

logger = logging.getLogger("barb.email")

SMTP_TIMEOUT_S = 30


class EmailNoConfigurado(RuntimeError):
    """SMTP sin configurar (falta SMTP_HOST / SMTP_FROM)."""


def _enviar_sync(msg: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_S) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)


async def send_email(to: list[str], subject: str, html: str, text: str) -> None:
    """Envía un correo multipart (texto + HTML) a `to`. Lanza si falla el SMTP."""
    if not settings.smtp_configurado:
        raise EmailNoConfigurado("SMTP no configurado (SMTP_HOST / SMTP_FROM).")
    if not to:
        raise ValueError("Sin destinatarios.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = ", ".join(to)
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    await asyncio.to_thread(_enviar_sync, msg)
    logger.info("Correo enviado a %d destinatario(s).", len(to))
