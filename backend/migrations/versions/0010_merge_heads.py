"""merge de heads: 0009_transacciones_triggers + 0007_tickets_conversacionales

Revision ID: 0010_merge_heads
Revises: 0009_transacciones_triggers, 0007_tickets_conversacionales
Create Date: 2026-10-18

Une la rama de auditoría/transacciones con la rama de tickets (aplicada en
Supabase). Solo une ramas; no cambia el esquema.
"""

from __future__ import annotations

revision = "0010_merge_heads"
down_revision = ("0009_transacciones_triggers", "0007_tickets_conversacionales")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
