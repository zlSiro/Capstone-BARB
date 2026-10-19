"""triggers que registran en `transacciones` todo INSERT/UPDATE/DELETE

Revision ID: 0009_transacciones_triggers
Revises: 0008_transacciones
Create Date: 2026-10-18

Un trigger por fila (`trg_transaccion`) en cada tabla de negocio llama a
`fn_registrar_transaccion()`, que inserta en `transacciones`:

- usuario_id: variable de sesión `app.usuario_id` (la fija `barb/core/db.py` con el usuario
  autenticado). Solo se registran cambios en los que intervino un usuario: sin usuario (seed,
  jobs, migraciones, SQL manual) el trigger no escribe nada.
- empresa_id / perfil: copia de la empresa y el rol de ese usuario. Si el usuario no tiene
  empresa (super_usuario), se usa la empresa de la fila modificada, si la tiene.
- accion: '<OPERACION> <tabla>', p. ej. 'UPDATE orden_trabajo'.
- detalle: {tabla, registro_id, operacion, cambios | datos}. `password_hash` nunca se guarda.

No se registran: las propias tablas de bitácora, `alembic_version`, y tablas de ruido
técnico (`sesion`, `sesion_debug`, `chat_session`, `lectura_sensor`, `documento_chunk`,
`documento_embedding`). Un UPDATE sin cambios reales, o que solo toca `usuario.ultimo_login`,
tampoco se registra. Para excluir/incluir otra tabla: DROP/CREATE TRIGGER trg_transaccion.
"""

from __future__ import annotations

from alembic import op

revision = "0009_transacciones_triggers"
down_revision = "0008_transacciones"
branch_labels = None
depends_on = None

_EXCLUIDAS = (
    "transacciones",
    "auditoria_cambio",
    "ot_audit_log",
    "system_audit_log",
    "alembic_version",
    "sesion",
    "sesion_debug",
    "chat_session",
    "lectura_sensor",
    "documento_chunk",
    "documento_embedding",
)

_DDL_UP = r"""
CREATE FUNCTION fn_registrar_transaccion() RETURNS trigger AS $$
DECLARE
    v_old     JSONB;
    v_new     JSONB;
    v_row     JSONB;
    v_cambios JSONB;
    v_pk      TEXT := NULLIF(TG_ARGV[0], '');
    v_user    INTEGER;
    v_empresa INTEGER;
    v_perfil  TEXT;
    v_detalle JSONB;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD) - 'password_hash'; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW) - 'password_hash'; END IF;
    v_row := COALESCE(v_new, v_old);

    IF TG_OP = 'UPDATE' THEN
        SELECT jsonb_object_agg(n.key, jsonb_build_object('antes', v_old -> n.key, 'despues', n.value))
          INTO v_cambios
          FROM jsonb_each(v_new) n
         WHERE v_old -> n.key IS DISTINCT FROM n.value
           AND NOT (TG_TABLE_NAME = 'usuario' AND n.key = 'ultimo_login');
        IF v_cambios IS NULL THEN RETURN NEW; END IF;  -- sin cambios relevantes
    END IF;

    v_user := NULLIF(current_setting('app.usuario_id', true), '')::INTEGER;
    IF v_user IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;  -- sin usuario: no se registra

    SELECT u.empresa_id, u.rol INTO v_empresa, v_perfil FROM usuario u WHERE u.usuario_id = v_user;
    IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;  -- usuario ya eliminado: evita violar la FK
    IF v_empresa IS NULL THEN
        v_empresa := (v_row ->> 'empresa_id')::INTEGER;
    END IF;

    v_detalle := jsonb_build_object('tabla', TG_TABLE_NAME, 'operacion', TG_OP,
                                    'registro_id', CASE WHEN v_pk IS NULL THEN NULL ELSE v_row ->> v_pk END);
    IF TG_OP = 'UPDATE' THEN v_detalle := v_detalle || jsonb_build_object('cambios', v_cambios);
    ELSE v_detalle := v_detalle || jsonb_build_object('datos', v_row);
    END IF;

    INSERT INTO transacciones (usuario_id, empresa_id, perfil, accion, detalle)
    VALUES (v_user, v_empresa, v_perfil, TG_OP || ' ' || TG_TABLE_NAME, v_detalle);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t  RECORD;
BEGIN
    FOR t IN
        SELECT c.relname AS tabla,
               (SELECT a.attname FROM pg_index i
                  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                 WHERE i.indrelid = c.oid AND i.indisprimary AND i.indnatts = 1) AS pk
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> ALL (ARRAY[__EXCLUIDAS__])
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_transaccion AFTER INSERT OR UPDATE OR DELETE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_registrar_transaccion(%L)',
            t.tabla, COALESCE(t.pk, ''));
    END LOOP;
END $$;
""".replace("__EXCLUIDAS__", ", ".join(f"'{t}'" for t in _EXCLUIDAS))

_DDL_DOWN = r"""
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT event_object_table AS tabla FROM information_schema.triggers
              WHERE trigger_name = 'trg_transaccion' AND trigger_schema = 'public'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_transaccion ON %I', t.tabla);
    END LOOP;
END $$;
DROP FUNCTION IF EXISTS fn_registrar_transaccion();
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
