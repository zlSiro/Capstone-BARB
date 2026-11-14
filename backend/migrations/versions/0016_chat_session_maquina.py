"""vincula `chat_session` a una máquina del catálogo (HU-23)

Revision ID: 0016_chat_session_maquina
Revises: 0015_eliminar_estado_demo
Create Date: 2026-11-14

Agrega `chat_session.maquina_id` (FK a `maquina`, ON DELETE SET NULL) para que una conversación del chat quede
vinculada, opcionalmente, a una máquina de la empresa. Elimina `chat_session.machine_id VARCHAR(40)`, que nunca se
usó, y su índice. `machine_name` / `plant_name` / `discipline` siguen como snapshot para el Historial.

REVERSIÓN (`downgrade`): recrea `machine_id VARCHAR(40)` y su índice, y elimina `maquina_id`. Los valores previos de
`machine_id` no se recuperan (la columna estaba sin uso).
"""

from __future__ import annotations

from alembic import op

revision = "0016_chat_session_maquina"
down_revision = "0015_eliminar_estado_demo"
branch_labels = None
depends_on = None

_DDL_UP = """
ALTER TABLE chat_session
    ADD COLUMN maquina_id INT REFERENCES maquina(maquina_id) ON DELETE SET NULL;
DROP INDEX IF EXISTS idx_chat_session_machine;
ALTER TABLE chat_session DROP COLUMN machine_id;
CREATE INDEX idx_chat_session_maquina ON chat_session(empresa_id, maquina_id);
"""

_DDL_DOWN = """
DROP INDEX IF EXISTS idx_chat_session_maquina;
ALTER TABLE chat_session DROP COLUMN maquina_id;
ALTER TABLE chat_session ADD COLUMN machine_id VARCHAR(40);
CREATE INDEX idx_chat_session_machine ON chat_session(empresa_id, machine_id);
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
