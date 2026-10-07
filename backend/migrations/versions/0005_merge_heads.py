"""merge de heads: 0003_pgvector_embeddings + 0004_multiempresa_documentos

Revision ID: 0005_merge_heads
Revises: 0003_pgvector_embeddings, 0004_multiempresa_documentos
Create Date: 2026-10-06

El repo tenía dos migraciones 0003 que partían de 0002_runtime_tables:

    0002 -> 0003_pgvector_embeddings
    0002 -> 0003_work_order_indexes -> 0004_multiempresa_documentos

Con dos heads, `alembic upgrade head` falla ("Multiple head revisions").
Esta migración solo une ambas ramas; no cambia el esquema.
"""

from __future__ import annotations

revision = "0005_merge_heads"
down_revision = ("0003_pgvector_embeddings", "0004_multiempresa_documentos")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
