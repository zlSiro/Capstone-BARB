"""estado `por_validar` en las órdenes de trabajo (doble validación del cierre)

Revision ID: 0014_estado_por_validar
Revises: 0013_eliminar_rol_visitante
Create Date: 2026-11-06

El cierre de una OT pasa a tener dos pasos: el técnico asignado (o el supervisor) la **envía a validación**
(`in_progress → por_validar`) y un supervisor distinto de quien la envió la **valida** (`por_validar → completed`) o la
**devuelve** con un comentario (`por_validar → in_progress`). `in_progress → completed` directo deja de existir.

Esta migración solo agrega el valor `por_validar` al tipo `estado_ot`, justo después de `in_progress`:

    pending, assigned, in_progress, [por_validar], completed, cancelled, overdue

- Es **aditiva**: no toca filas ni columnas. Ninguna OT existente cambia de estado.
- `ALTER TYPE ... ADD VALUE` corre en un bloque `autocommit`: un valor nuevo de enum no puede usarse en la misma
  transacción que lo crea, y en PostgreSQL < 12 ni siquiera puede ejecutarse dentro de una. `IF NOT EXISTS` la hace
  idempotente (se puede reaplicar sin error).
- `ot_audit_log.estado_anterior/estado_nuevo` son VARCHAR, así que la bitácora no necesita cambios.

Antes de aplicarla en producción (Supabase) el backend nuevo todavía no debe estar desplegado, o el endpoint de cambio
de estado fallará al intentar usar un valor que la base no conoce: aplicar con `uv run alembic upgrade heads` y comprobar
que `alembic current` coincide con `alembic heads`, y recién entonces mergear/desplegar.

REVERSIÓN (`downgrade`): PostgreSQL no permite quitar un valor de un enum. Lo que hace el downgrade es:

1. Se detiene con un error claro, sin tocar nada, si existe alguna OT en `por_validar` (hay que devolverla a
   `in_progress` o cerrarla antes de bajar la versión).
2. Si no hay ninguna, recrea el tipo sin `por_validar`: renombra el tipo viejo, crea `estado_ot` con los 6 valores
   originales, convierte `orden_trabajo.estado` y elimina el tipo viejo. Para que la conversión sea posible suelta el
   DEFAULT de la columna ('pending') y el índice parcial `ix_ot_abiertas_vencimiento` (migración 0006), cuyo predicado
   compara `estado` con literales del tipo; ambos se vuelven a crear con su definición original al terminar.

Todo el downgrade es transaccional: si algo falla (p. ej. una vista o un índice nuevo que dependa del tipo y que esta
migración no conoce), Postgres lo revierte y no queda nada a medias.

Limitaciones del downgrade: las filas de `ot_audit_log` que mencionen `por_validar` se conservan (son texto) y quedan
como historia de un estado que ya no existe.
"""

from __future__ import annotations

from alembic import op

revision = "0014_estado_por_validar"
down_revision = "0013_eliminar_rol_visitante"
branch_labels = None
depends_on = None

_DDL_DOWN_GUARDIA = """
DO $$
DECLARE
    n INT;
BEGIN
    SELECT COUNT(*) INTO n FROM orden_trabajo WHERE estado::text = 'por_validar';
    IF n > 0 THEN
        RAISE EXCEPTION
            'No se puede revertir 0014: % OT estan en estado por_validar. Devuelvelas a in_progress o cierralas antes de bajar la version.', n;
    END IF;
END
$$;
"""

_DDL_DOWN_TIPO = """
-- El predicado del índice compara `estado` con literales de estado_ot: hay que soltarlo para cambiar el tipo.
DROP INDEX IF EXISTS ix_ot_abiertas_vencimiento;
ALTER TABLE orden_trabajo ALTER COLUMN estado DROP DEFAULT;
ALTER TYPE estado_ot RENAME TO estado_ot_con_por_validar;
CREATE TYPE estado_ot AS ENUM ('pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'overdue');
ALTER TABLE orden_trabajo ALTER COLUMN estado TYPE estado_ot USING estado::text::estado_ot;
ALTER TABLE orden_trabajo ALTER COLUMN estado SET DEFAULT 'pending';
DROP TYPE estado_ot_con_por_validar;
-- Definición original (migración 0006).
CREATE INDEX IF NOT EXISTS ix_ot_abiertas_vencimiento
    ON orden_trabajo (fecha_vencimiento)
    WHERE estado NOT IN ('completed', 'cancelled') AND fecha_vencimiento IS NOT NULL;
"""


def upgrade() -> None:
    # Un valor de enum recién creado no se puede usar en la misma transacción: se confirma de inmediato.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE estado_ot ADD VALUE IF NOT EXISTS 'por_validar' AFTER 'in_progress'")


def downgrade() -> None:
    op.execute(_DDL_DOWN_GUARDIA)
    op.execute(_DDL_DOWN_TIPO)
