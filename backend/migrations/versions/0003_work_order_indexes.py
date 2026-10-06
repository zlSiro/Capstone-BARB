"""work order indexes

Revision ID: 0003_work_order_indexes
Revises: 0002_runtime_tables
Create Date: 2026-09-29

NOTA: esta revisión ya estaba aplicada en la BD de desarrollo (alembic_version =
0003_work_order_indexes) pero el archivo no estaba versionado en esta rama, lo que
rompía `alembic upgrade head`. Se reconstruye a partir de los índices existentes
(ix_ot_*) usando IF NOT EXISTS, por lo que es seguro tanto en BDs que ya los tienen
como en BDs nuevas.
"""

from __future__ import annotations

from alembic import op

revision = "0003_work_order_indexes"
down_revision = "0002_runtime_tables"
branch_labels = None
depends_on = None

_INDEXES = {
    "ix_ot_estado": "orden_trabajo (estado)",
    "ix_ot_fecha_creacion": "orden_trabajo (fecha_creacion DESC)",
    "ix_ot_fecha_vencimiento": "orden_trabajo (fecha_vencimiento)",
    "ix_ot_maquina_id": "orden_trabajo (maquina_id)",
    "ix_ot_priority": "orden_trabajo (priority)",
    "ix_ot_tecnico_id": "orden_trabajo (tecnico_id)",
    "ix_ot_foto_ot_id": "ot_foto (ot_id)",
}


def upgrade() -> None:
    for name, target in _INDEXES.items():
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {target}")


def downgrade() -> None:
    for name in _INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
