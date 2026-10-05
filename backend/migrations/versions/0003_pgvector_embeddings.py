"""pgvector + tabla documento_embedding (RAG — HU-04)

Habilita la extensión vector y crea la tabla de chunks embebidos que usa el
pipeline de RAG (ver docs/RAG_ARCHITECTURE.md, decisión D2):

- `embedding vector(2048)`: dimensión de nvidia/nemotron-3-embed-1b (D1,
  validada por el equipo).
- FK a `documento` con ON DELETE CASCADE: al eliminar un documento se borran
  sus chunks.
- UNIQUE (documento_id, chunk_index): evita duplicados si un PDF se re-ingesta.
- Índice HNSW con operador coseno (`<=>`) para búsqueda por similitud.

En producción (Supabase) la extensión ya viene incluida; el CREATE EXTENSION
es idempotente (IF NOT EXISTS). En local requiere la imagen pgvector del
docker-compose.yml (pgvector/pgvector:pg17).

Revision ID: 0003_pgvector_embeddings
Revises: 0002_runtime_tables
Create Date: 2026-10-04
"""

from __future__ import annotations

from alembic import op

revision = "0003_pgvector_embeddings"
down_revision = "0002_runtime_tables"
branch_labels = None
depends_on = None

_DDL_UP = r"""
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documento_embedding (
    documento_embedding_id SERIAL PRIMARY KEY,
    documento_id          INTEGER NOT NULL REFERENCES documento(documento_id) ON DELETE CASCADE,
    chunk_index           INTEGER NOT NULL,
    content               TEXT NOT NULL,
    embedding             vector(2048) NOT NULL,
    created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT documento_embedding_unique_chunk UNIQUE (documento_id, chunk_index)
);

CREATE INDEX documento_embedding_idx ON documento_embedding
    USING hnsw (embedding vector_cosine_ops);
"""

_DDL_DOWN = r"""
DROP TABLE IF EXISTS documento_embedding;
DROP EXTENSION IF EXISTS vector;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
