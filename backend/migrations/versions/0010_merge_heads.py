"""0010_merge_heads: punto de unión de la cadena (sin cambios de esquema)

Revision ID: 0010_merge_heads
Revises: 0009_transacciones_triggers
Create Date: 2026-10-18

Originalmente unía la rama de auditoría/transacciones con el stub
`0007_tickets_conversacionales` (migración perdida, aplicada en Supabase). El
stub se eliminó porque Supabase ya está en esta revisión (`alembic_version` =
`0010_merge_heads`); la revisión se conserva porque esa base la referencia.
No cambia el esquema.
"""

from __future__ import annotations

revision = "0010_merge_heads"
down_revision = "0009_transacciones_triggers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
