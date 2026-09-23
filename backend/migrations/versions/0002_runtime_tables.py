"""runtime tables — sesion, documento, chat_debug_attachment, chat_feedback + usuario.preferencias

Revision ID: 0002_runtime_tables
Revises: 0001_initial_schema
Create Date: 2026-09-22

Port de las tablas que el backend legado creaba on-the-fly en startup /
dentro de handlers (`backend/main.py`, `backend/routers/chat.py`,
`backend/routers/documents.py`). `documento` y `chat_debug_attachment` son
de fase 2 (RAG/chat) pero se migran aquí junto al resto del bloque
"tablas adicionales" del script legado para no fragmentar el historial de
Alembic.
"""

from __future__ import annotations

from alembic import op

revision = "0002_runtime_tables"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None

_DDL_UP = r"""
CREATE TABLE sesion (
    token       VARCHAR(64) PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuario(usuario_id) ON DELETE CASCADE,
    creado_en   TIMESTAMP NOT NULL DEFAULT NOW(),
    expira_en   TIMESTAMP NOT NULL
);

CREATE TABLE documento (
    documento_id  SERIAL PRIMARY KEY,
    title         VARCHAR(255) NOT NULL,
    discipline_id INTEGER REFERENCES disciplina(disciplina_id) ON DELETE SET NULL,
    maquina_id    INTEGER REFERENCES maquina(maquina_id) ON DELETE SET NULL,
    notes         TEXT,
    original_name VARCHAR(255) NOT NULL,
    stored_name   VARCHAR(255) NOT NULL,
    file_id       VARCHAR(64) NOT NULL,
    chunks_indexed INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_debug_attachment (
    attachment_id SERIAL PRIMARY KEY,
    session_id    VARCHAR(64),
    maquina_id    INTEGER REFERENCES maquina(maquina_id) ON DELETE SET NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name   VARCHAR(255) NOT NULL,
    content_type  VARCHAR(50) NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_feedback (
    feedback_id SERIAL PRIMARY KEY,
    message_content TEXT,
    rating VARCHAR(10),
    context VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE usuario ADD COLUMN preferencias JSONB DEFAULT '{}'::jsonb;
"""

_DDL_DOWN = r"""
ALTER TABLE usuario DROP COLUMN IF EXISTS preferencias;
DROP TABLE IF EXISTS chat_feedback;
DROP TABLE IF EXISTS chat_debug_attachment;
DROP TABLE IF EXISTS documento;
DROP TABLE IF EXISTS sesion;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
