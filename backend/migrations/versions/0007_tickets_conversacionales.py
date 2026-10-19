"""stub: 0007_tickets_conversacionales (migración aplicada en Supabase, archivo perdido)

Revision ID: 0007_tickets_conversacionales
Revises: 0006_notificacion_config
Create Date: 2026-10-18

Esta revisión ya fue aplicada en la base de Supabase (tablas ticket,
chat_feedback, chat_debug_attachment, sesion_debug, system_audit_log, ...),
pero su archivo nunca se subió al repo y no se sabe quién la creó.

Este stub existe solo para que Alembic reconozca la revisión que figura en
`alembic_version` de Supabase. NO crea ni modifica esquema: un entorno nuevo
(ej. Docker local) no tendrá esas tablas. Si el código llega a usarlas, hay
que reemplazar este stub por la migración real.
"""

from __future__ import annotations

revision = "0007_tickets_conversacionales"
down_revision = "0006_notificacion_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
