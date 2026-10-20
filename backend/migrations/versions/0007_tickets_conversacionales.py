"""tickets conversacionales (HU-06): una conversación de chat promovida a ticket

Revision ID: 0007_tickets_conversacionales
Revises: 0006_notificacion_config
Create Date: 2026-10-16

Tabla `ticket`: promoción 1:1 de una `chat_session` a unidad de seguimiento
(CGBIDA-124). Diseño y decisiones D1-D7 en docs/TICKETS_ARCHITECTURE.md;
contrato en docs/contrato_api_tickets.md.

**Reemplaza el stub de PR #31.** Esa revisión se aplicó en Supabase el
16-10-2026 desde la rama HU06 (antes de que el archivo llegara al repo),
por lo que `alembic_version` de producción quedó apuntando a una revisión
sin archivo y se parcheó con un stub vacío. Este archivo ES la migración
real: en producción (y en cualquier BD donde ya se aplicó) es un no-op
gracias a `IF NOT EXISTS`; en un entorno nuevo crea la tabla.

Nota: esta revisión solo crea `ticket`. Las otras tablas que mencionaba el
docstring del stub (chat_feedback, chat_debug_attachment, sesion_debug,
system_audit_log) provienen de 0001/0002 y no son parte de esta revisión.

- UNIQUE(session_id): una conversación genera un solo ticket (D1).
- ON DELETE RESTRICT hacia chat_session: una sesión con ticket no se puede
  borrar (D4) — el endpoint de borrado traduce la FK a 409.
- usuario_id ON DELETE SET NULL: el ticket sobrevive como auditoría si se
  elimina el usuario (mismo patrón que chat_session.usuario_id).
"""

from __future__ import annotations

from alembic import op

revision = "0007_tickets_conversacionales"
down_revision = "0006_notificacion_config"
branch_labels = None
depends_on = None

# Idempotente (IF NOT EXISTS): la tabla ya existe en Supabase (ver docstring).
_DDL_UP = r"""
CREATE TABLE IF NOT EXISTS ticket (
    ticket_id    SERIAL PRIMARY KEY,
    empresa_id    INTEGER NOT NULL REFERENCES empresa(empresa_id),
    usuario_id    INTEGER REFERENCES usuario(usuario_id) ON DELETE SET NULL,
    session_id    UUID NOT NULL UNIQUE REFERENCES chat_session(session_id) ON DELETE RESTRICT,
    titulo        VARCHAR(200) NOT NULL,
    estado        VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ,
    CONSTRAINT ck_ticket_estado CHECK (estado IN ('open', 'in_progress', 'resolved', 'cancelled'))
);

-- Búsquedas frecuentes: listado por empresa (y con filtro de estado) y
-- "mis tickets" del dueño. Espejo de los índices de chat_session.
CREATE INDEX IF NOT EXISTS ix_ticket_empresa         ON ticket(empresa_id);
CREATE INDEX IF NOT EXISTS ix_ticket_empresa_estado ON ticket(empresa_id, estado);
CREATE INDEX IF NOT EXISTS ix_ticket_usuario        ON ticket(usuario_id);
"""

_DDL_DOWN = r"""
DROP INDEX IF EXISTS ix_ticket_usuario;
DROP INDEX IF EXISTS ix_ticket_empresa_estado;
DROP INDEX IF EXISTS ix_ticket_empresa;
DROP TABLE IF EXISTS ticket;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
