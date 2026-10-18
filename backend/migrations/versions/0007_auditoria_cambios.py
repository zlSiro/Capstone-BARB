"""bitácora de cambios (auditoría) sobre usuario, empresa y orden_trabajo

Revision ID: 0007_auditoria_cambios
Revises: 0006_notificacion_config
Create Date: 2026-10-17

Tabla `auditoria_cambio`: una fila por INSERT/UPDATE/DELETE en `usuario`,
`empresa` y `orden_trabajo`, escrita por un trigger (no depende del código de
la app, así que captura también scripts y SQL manual).

- `datos_anteriores` / `datos_nuevos`: fila completa en JSONB (sin `password_hash`).
- `cambios`: solo las columnas que cambiaron en un UPDATE ({col: {antes, despues}}).
- `usuario_id`: quién lo hizo. Se toma de la variable de sesión `app.usuario_id`
  (`SELECT set_config('app.usuario_id', '<id>', true)` dentro de la transacción);
  queda NULL si la app no la fija (seed, migraciones, SQL manual).
- UPDATE sin cambios reales, o que solo toca `usuario.ultimo_login`, no se registra.
Aditiva: no altera tablas previas.
"""

from __future__ import annotations

from alembic import op

revision = "0007_auditoria_cambios"
down_revision = "0006_notificacion_config"
branch_labels = None
depends_on = None

_DDL_UP = r"""
CREATE TABLE auditoria_cambio (
    auditoria_id     BIGSERIAL PRIMARY KEY,
    tabla            VARCHAR(50) NOT NULL,
    registro_id      INTEGER     NOT NULL,
    operacion        VARCHAR(6)  NOT NULL,
    usuario_id       INTEGER,
    datos_anteriores JSONB,
    datos_nuevos     JSONB,
    cambios          JSONB,
    fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_auditoria_operacion CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE'))
);

CREATE INDEX ix_auditoria_tabla_registro ON auditoria_cambio (tabla, registro_id, fecha DESC);
CREATE INDEX ix_auditoria_usuario        ON auditoria_cambio (usuario_id, fecha DESC);
CREATE INDEX ix_auditoria_fecha          ON auditoria_cambio (fecha DESC);

CREATE FUNCTION fn_auditar_cambio() RETURNS trigger AS $$
DECLARE
    v_old     JSONB;
    v_new     JSONB;
    v_cambios JSONB;
    v_pk      TEXT := TG_ARGV[0];
    v_id      INTEGER;
    v_user    INTEGER;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD) - 'password_hash'; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW) - 'password_hash'; END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT jsonb_object_agg(n.key, jsonb_build_object('antes', v_old -> n.key, 'despues', n.value))
          INTO v_cambios
          FROM jsonb_each(v_new) n
         WHERE v_old -> n.key IS DISTINCT FROM n.value
           AND NOT (TG_TABLE_NAME = 'usuario' AND n.key = 'ultimo_login');
        IF v_cambios IS NULL THEN RETURN NEW; END IF;  -- sin cambios relevantes
    END IF;

    v_id := ((CASE WHEN TG_OP = 'DELETE' THEN v_old ELSE v_new END) ->> v_pk)::INTEGER;
    v_user := NULLIF(current_setting('app.usuario_id', true), '')::INTEGER;

    INSERT INTO auditoria_cambio (tabla, registro_id, operacion, usuario_id, datos_anteriores, datos_nuevos, cambios)
    VALUES (TG_TABLE_NAME, v_id, TG_OP, v_user, v_old, v_new, v_cambios);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditar_usuario
    AFTER INSERT OR UPDATE OR DELETE ON usuario
    FOR EACH ROW EXECUTE FUNCTION fn_auditar_cambio('usuario_id');
CREATE TRIGGER trg_auditar_empresa
    AFTER INSERT OR UPDATE OR DELETE ON empresa
    FOR EACH ROW EXECUTE FUNCTION fn_auditar_cambio('empresa_id');
CREATE TRIGGER trg_auditar_orden_trabajo
    AFTER INSERT OR UPDATE OR DELETE ON orden_trabajo
    FOR EACH ROW EXECUTE FUNCTION fn_auditar_cambio('ot_id');
"""

_DDL_DOWN = r"""
DROP TRIGGER IF EXISTS trg_auditar_orden_trabajo ON orden_trabajo;
DROP TRIGGER IF EXISTS trg_auditar_empresa ON empresa;
DROP TRIGGER IF EXISTS trg_auditar_usuario ON usuario;
DROP FUNCTION IF EXISTS fn_auditar_cambio();
DROP TABLE IF EXISTS auditoria_cambio;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
