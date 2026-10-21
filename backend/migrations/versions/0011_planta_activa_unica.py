"""plantas: baja logica (`activa`) y nombre unico por empresa

Revision ID: 0011_planta_activa_unica
Revises: 0010_merge_heads
Create Date: 2026-10-21

Soporte del mantenedor masivo (HU-24).

- `activa`: permite retirar una planta sin borrarla. Borrarla de verdad es imposible en
  cuanto tiene maquinas (`fk_maquina_planta` no tiene CASCADE) y, aunque se pudiera,
  arrastraria el historico de OTs. La baja logica deja el dato fuera de los listados sin
  destruir la trazabilidad.
- `UNIQUE (empresa_id, nombre)`: el alta masiva crea plantas desde un formulario, donde el
  nombre se escribe a mano. Sin la restriccion, dos altas del mismo nombre dejan dos plantas
  identicas e indistinguibles para el usuario. `disciplina` ya tiene su equivalente.

La constraint falla si ya hubiera duplicados; por eso el upgrade primero comprueba y solo
crea la restriccion si no existe (idempotente en un entorno ya migrado a mano).
"""

from __future__ import annotations

from alembic import op

revision = "0011_planta_activa_unica"
down_revision = "0010_merge_heads"
branch_labels = None
depends_on = None

_DDL_UP = """
ALTER TABLE planta ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'planta_empresa_id_nombre_key'
           AND conrelid = 'planta'::regclass
    ) THEN
        ALTER TABLE planta
            ADD CONSTRAINT planta_empresa_id_nombre_key UNIQUE (empresa_id, nombre);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_planta_empresa_activa ON planta (empresa_id, activa);
"""

_DDL_DOWN = """
DROP INDEX IF EXISTS ix_planta_empresa_activa;
ALTER TABLE planta DROP CONSTRAINT IF EXISTS planta_empresa_id_nombre_key;
ALTER TABLE planta DROP COLUMN IF EXISTS activa;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)

