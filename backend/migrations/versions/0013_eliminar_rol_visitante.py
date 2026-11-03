"""elimina el perfil `visitante`: borra sus usuarios y prohíbe el rol con un CHECK

Revision ID: 0013_eliminar_rol_visitante
Revises: 0012_aviso_falla
Create Date: 2026-11-03

El perfil «visitante» (solo lectura) deja de existir en el producto. Esta migración lo quita de la base:

1. Antes de borrar nada comprueba que ningún visitante sea autor de datos que la base no puede soltar (OT, avisos,
   programas de mantenimiento, reportes…: claves foráneas sin ON DELETE). Un visitante solo lee, así que no debería
   haber ninguno; si lo hay, la migración se detiene con un mensaje claro y NO cambia nada, para que alguien decida
   qué hacer con esos datos en vez de perderlos.
2. Borra los usuarios con `rol = 'visitante'`. Sus sesiones se van en cascada; lo que dejaron con una clave foránea
   `ON DELETE SET NULL` (chats, documentos, bitácoras) queda sin autor, no se borra.
3. Borra las filas de las bitácoras que registran ese perfil como texto (`transacciones.perfil` y
   `system_audit_log.usuario_rol`), porque pertenecen a un perfil que ya no existe.
4. Agrega `ck_usuario_rol_valido`: `usuario.rol` solo admite los 7 perfiles vigentes. Así la base misma impide volver a
   crear un visitante (hasta hoy `rol` era un VARCHAR libre; solo existía el CHECK de empresa).

Si la base ya tuviera algún rol que no esté entre los 7, el paso 4 falla y toda la migración se revierte (DDL
transaccional de Postgres): no queda nada a medias.

IRREVERSIBLE en datos: `downgrade` solo quita el CHECK; los usuarios visitante borrados no se recuperan.
"""

from __future__ import annotations

from alembic import op

revision = "0013_eliminar_rol_visitante"
down_revision = "0012_aviso_falla"
branch_labels = None
depends_on = None

_ROLES_VIGENTES = "'operador', 'tecnico', 'supervisor', 'engineer', 'gerente', 'admin', 'super_usuario'"

_DDL_UP = rf"""
-- 1) Guardia: ¿algún visitante es autor de algo que la base no puede soltar? (FK sin ON DELETE CASCADE / SET NULL)
DO $$
DECLARE
    fk        RECORD;
    cuantas   BIGINT;
    problemas TEXT := '';
BEGIN
    FOR fk IN
        SELECT c.conrelid::regclass AS tabla, a.attname AS columna
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.confrelid = 'usuario'::regclass
          AND c.confdeltype IN ('a', 'r')          -- NO ACTION / RESTRICT: bloquearían el borrado
    LOOP
        EXECUTE format(
            'SELECT count(*) FROM %s WHERE %I IN (SELECT usuario_id FROM usuario WHERE rol = %L)',
            fk.tabla, fk.columna, 'visitante') INTO cuantas;
        IF cuantas > 0 THEN
            problemas := problemas || format(' %s.%s=%s', fk.tabla, fk.columna, cuantas);
        END IF;
    END LOOP;

    IF problemas <> '' THEN
        RAISE EXCEPTION 'No se puede eliminar el rol visitante: hay datos creados por esos usuarios (%). Reasígnalos o bórralos a mano y reintenta.', trim(problemas);
    END IF;
END $$;

-- 2) Los usuarios visitante y sus sesiones.
DELETE FROM sesion WHERE usuario_id IN (SELECT usuario_id FROM usuario WHERE rol = 'visitante');
DELETE FROM usuario WHERE rol = 'visitante';

-- 3) Bitácoras que guardan el perfil como texto.
DELETE FROM transacciones WHERE perfil = 'visitante';
DELETE FROM system_audit_log WHERE usuario_rol = 'visitante';

-- 4) La base deja de admitir el rol.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuario_rol_valido' AND conrelid = 'usuario'::regclass) THEN
        ALTER TABLE usuario ADD CONSTRAINT ck_usuario_rol_valido CHECK (rol IN ({_ROLES_VIGENTES}));
    END IF;
END $$;
"""

_DDL_DOWN = r"""
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS ck_usuario_rol_valido;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    # Solo se quita el CHECK: los usuarios visitante borrados en `upgrade` no se pueden reconstruir.
    op.execute(_DDL_DOWN)
