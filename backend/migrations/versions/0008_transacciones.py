"""tabla `transacciones`: registro de las acciones de los usuarios de cada empresa

Revision ID: 0008_transacciones
Revises: 0007_auditoria_cambios
Create Date: 2026-10-18

Una fila por acción realizada por un usuario. Alimentará la vista de
transacciones: el gerente ve las de su empresa; el super_usuario ve todas,
filtradas por empresa y agrupadas por usuario.

`perfil` y `empresa_id` son una copia (snapshot) del rol y la empresa del usuario
al momento de la acción, para que el historial no cambie si el usuario se mueve
de rol o empresa. `empresa_id` es NULL para el super_usuario (no tiene empresa).
Aditiva: no altera tablas previas.
"""

from __future__ import annotations

from alembic import op

revision = "0008_transacciones"
down_revision = "0007_auditoria_cambios"
branch_labels = None
depends_on = None

_DDL_UP = r"""
CREATE TABLE transacciones (
    transaccion_id BIGSERIAL PRIMARY KEY,
    usuario_id     INTEGER REFERENCES usuario(usuario_id) ON DELETE SET NULL,
    empresa_id     INTEGER REFERENCES empresa(empresa_id),
    perfil         VARCHAR(50)  NOT NULL,
    accion         VARCHAR(150) NOT NULL,
    detalle        JSONB,
    fecha          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vista del gerente: transacciones de su empresa, más recientes primero.
CREATE INDEX ix_transacciones_empresa_fecha ON transacciones (empresa_id, fecha DESC);
-- Vista del super_usuario: filtrar por empresa y agrupar por usuario.
CREATE INDEX ix_transacciones_empresa_usuario ON transacciones (empresa_id, usuario_id, fecha DESC);
CREATE INDEX ix_transacciones_usuario ON transacciones (usuario_id, fecha DESC);
"""

_DDL_DOWN = r"""
DROP TABLE IF EXISTS transacciones;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
