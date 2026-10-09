"""configuración de notificaciones por correo de OTs atrasadas (por empresa)

Revision ID: 0006_notificacion_config
Revises: 0005_merge_heads
Create Date: 2026-10-07

Tabla `notificacion_config`: una fila por empresa con la frecuencia y los
destinatarios del correo de OTs atrasadas. El job (`POST /api/jobs/ot-atrasadas`)
la consulta para decidir a quién y cuándo enviar. Aditiva: no altera tablas previas.
"""

from __future__ import annotations

from alembic import op

revision = "0006_notificacion_config"
down_revision = "0005_merge_heads"
branch_labels = None
depends_on = None

_DDL_UP = r"""
CREATE TABLE notificacion_config (
    empresa_id    INTEGER PRIMARY KEY REFERENCES empresa(empresa_id) ON DELETE CASCADE,
    activo        BOOLEAN  NOT NULL DEFAULT FALSE,
    frecuencia    VARCHAR(10) NOT NULL DEFAULT 'diaria',
    hora          SMALLINT NOT NULL DEFAULT 8,
    dia_semana    SMALLINT,
    destinatarios TEXT[]   NOT NULL DEFAULT '{}',
    ultimo_envio  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_notif_frecuencia CHECK (frecuencia IN ('diaria', 'semanal')),
    CONSTRAINT ck_notif_hora       CHECK (hora BETWEEN 0 AND 23),
    CONSTRAINT ck_notif_dia        CHECK (dia_semana IS NULL OR dia_semana BETWEEN 0 AND 6),
    CONSTRAINT ck_notif_dia_semanal CHECK (frecuencia <> 'semanal' OR dia_semana IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_ot_abiertas_vencimiento
    ON orden_trabajo (fecha_vencimiento)
    WHERE estado NOT IN ('completed', 'cancelled') AND fecha_vencimiento IS NOT NULL;
"""

_DDL_DOWN = r"""
DROP INDEX IF EXISTS ix_ot_abiertas_vencimiento;
DROP TABLE IF EXISTS notificacion_config;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
