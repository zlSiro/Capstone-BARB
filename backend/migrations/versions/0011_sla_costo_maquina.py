"""columnas de SLA y costo de inactividad por máquina

Revision ID: 0011_sla_costo_maquina
Revises: 0010_merge_heads
Create Date: 2026-10-27

`maquina.sla_horas` y `maquina.costo_inactividad_minuto`: las usa el mantenedor de
plantas/máquinas, el alta de OT (fecha_vencimiento) y el dashboard. NULL = usa el SLA
general de la empresa. Aditiva y idempotente (IF NOT EXISTS): si las columnas ya se
crearon a mano en una base, la migración solo registra la versión.

Solo esquema. El backfill de valores y de `orden_trabajo.fecha_vencimiento` va aparte:
`seeds/add_sla_costos_y_backfill.sql` o `scripts/backfill_sla_costos.py`.
"""

from __future__ import annotations

from alembic import op

revision = "0011_sla_costo_maquina"
down_revision = "0010_merge_heads"
branch_labels = None
depends_on = None

_DDL_UP = r"""
ALTER TABLE maquina
    ADD COLUMN IF NOT EXISTS sla_horas NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS costo_inactividad_minuto NUMERIC(12,2);
"""

_DDL_DOWN = r"""
ALTER TABLE maquina
    DROP COLUMN IF EXISTS costo_inactividad_minuto,
    DROP COLUMN IF EXISTS sla_horas;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
