"""elimina el estado `demo` de las empresas (`estado_empresa`)

Revision ID: 0015_eliminar_estado_demo
Revises: 0014_estado_por_validar
Create Date: 2026-11-09

El estado «Demo» de una empresa nunca tuvo lógica asociada: no limitaba funciones ni vencía, y solo se podía elegir
al editar una empresa. Se elimina del producto; esta migración lo quita de la base:

1. Las empresas que estén en `demo` pasan a `active` (era el único efecto real de ese estado: la empresa operaba normal).
2. Se recrea el tipo `estado_empresa` con los 3 valores vigentes (`active`, `suspended`, `cancelled`): PostgreSQL no permite
   quitar un valor de un enum. Para poder cambiar el tipo de la columna se suelta y se vuelve a crear su DEFAULT ('active').

Transaccional: si algo falla (p. ej. un objeto nuevo que dependa del tipo y que esta migración no conoce) se revierte todo.

REVERSIÓN (`downgrade`): vuelve a agregar el valor `demo` al tipo. Las empresas que estaban en `demo` NO se recuperan: ya
quedaron en `active` y no hay forma de saber cuáles eran.
"""

from __future__ import annotations

from alembic import op

revision = "0015_eliminar_estado_demo"
down_revision = "0014_estado_por_validar"
branch_labels = None
depends_on = None

_DDL_UP = """
UPDATE empresa SET estado = 'active' WHERE estado::text = 'demo';
ALTER TABLE empresa ALTER COLUMN estado DROP DEFAULT;
ALTER TYPE estado_empresa RENAME TO estado_empresa_con_demo;
CREATE TYPE estado_empresa AS ENUM ('active', 'suspended', 'cancelled');
ALTER TABLE empresa ALTER COLUMN estado TYPE estado_empresa USING estado::text::estado_empresa;
ALTER TABLE empresa ALTER COLUMN estado SET DEFAULT 'active';
DROP TYPE estado_empresa_con_demo;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    # Un valor de enum recién creado no se puede usar en la misma transacción: se confirma de inmediato.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE estado_empresa ADD VALUE IF NOT EXISTS 'demo'")
