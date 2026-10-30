"""tabla `aviso_falla` (reporte de falla desde planta) y su relación con `orden_trabajo`

Revision ID: 0012_aviso_falla
Revises: 0011_sla_costo_maquina
Create Date: 2026-10-29

Quienes trabajan en planta reportan una falla (formulario «Reportar falla»); el aviso llega al repositorio del
supervisor, que decide si genera una OT. Hasta ahora los avisos se guardaban en la tabla `reporte`; esta migración
les da una tabla propia con las columnas del formulario:

- datos del formulario: máquina, descripción, gravedad percibida y la foto opcional (la imagen queda en disco;
  aquí su nombre, tipo y ruta relativa a `upload_dir`);
- seguimiento: quién reportó, estado (`pendiente`, `con_ot`, `descartado`), quién decidió y cuándo, y el motivo
  del descarte (obligatorio si se descarta).

Relación con las OT: `orden_trabajo.aviso_falla_id` guarda el id del aviso que originó la OT (NULL si la OT se creó
directamente). Un aviso origina como máximo una OT (índice único parcial).

También se instala el trigger de la bitácora de transacciones (función `fn_registrar_transaccion` de la 0009), para que
los avisos sigan quedando registrados con el usuario que los reportó o decidió.

Aditiva: no modifica datos existentes ni otras columnas. No migra filas de `reporte`: la funcionalidad de avisos no
estaba desplegada.
"""

from __future__ import annotations

from alembic import op

revision = "0012_aviso_falla"
down_revision = "0011_sla_costo_maquina"
branch_labels = None
depends_on = None

_DDL_UP = r"""
CREATE TABLE aviso_falla (
    aviso_falla_id    SERIAL PRIMARY KEY,
    numero_aviso      VARCHAR(40)  NOT NULL UNIQUE,              -- AV-<año>-<id con 4 dígitos>
    maquina_id        INT          NOT NULL REFERENCES maquina(maquina_id),
    reportado_por     INT          NOT NULL REFERENCES usuario(usuario_id),
    descripcion       TEXT         NOT NULL,
    severidad         nivel_severidad NOT NULL DEFAULT 'medium', -- gravedad que percibe quien reporta
    estado            VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
    -- Foto opcional: el archivo vive en disco (upload_dir/avisos/<id>/); aquí su metadata.
    foto_nombre       VARCHAR(255),                               -- nombre original del archivo
    foto_archivo      VARCHAR(255),                               -- nombre con el que se guardó
    foto_content_type VARCHAR(50),
    foto_ruta         VARCHAR(500),                               -- relativa a upload_dir
    -- Decisión del supervisor (generar OT o descartar).
    resuelto_por      INT          REFERENCES usuario(usuario_id),
    resuelto_en       TIMESTAMP,
    motivo_descarte   TEXT,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_aviso_falla_estado CHECK (estado IN ('pendiente', 'con_ot', 'descartado')),
    CONSTRAINT ck_aviso_falla_descarte CHECK (estado <> 'descartado' OR motivo_descarte IS NOT NULL),
    CONSTRAINT ck_aviso_falla_decision CHECK (estado = 'pendiente' OR (resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)),
    CONSTRAINT ck_aviso_falla_foto CHECK (
        (foto_ruta IS NULL AND foto_content_type IS NULL AND foto_nombre IS NULL AND foto_archivo IS NULL)
        OR (foto_ruta IS NOT NULL AND foto_content_type IS NOT NULL AND foto_nombre IS NOT NULL AND foto_archivo IS NOT NULL)
    )
);

CREATE INDEX ix_aviso_falla_maquina       ON aviso_falla (maquina_id);
CREATE INDEX ix_aviso_falla_reportado_por ON aviso_falla (reportado_por, created_at DESC);
CREATE INDEX ix_aviso_falla_estado        ON aviso_falla (estado, created_at DESC);

-- La OT recuerda de qué aviso nació (NULL = creada directamente). Si algún día se borrara el aviso, la OT se conserva.
ALTER TABLE orden_trabajo
    ADD COLUMN aviso_falla_id INT REFERENCES aviso_falla(aviso_falla_id) ON DELETE SET NULL;

-- Un aviso origina como máximo una OT.
CREATE UNIQUE INDEX ux_orden_trabajo_aviso_falla ON orden_trabajo (aviso_falla_id) WHERE aviso_falla_id IS NOT NULL;

-- Bitácora de transacciones (función de la 0009): INSERT/UPDATE/DELETE hechos por un usuario autenticado.
CREATE TRIGGER trg_transaccion
    AFTER INSERT OR UPDATE OR DELETE ON aviso_falla
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_transaccion('aviso_falla_id');
"""

_DDL_DOWN = r"""
DROP TRIGGER IF EXISTS trg_transaccion ON aviso_falla;
DROP INDEX IF EXISTS ux_orden_trabajo_aviso_falla;
ALTER TABLE orden_trabajo DROP COLUMN IF EXISTS aviso_falla_id;
DROP TABLE IF EXISTS aviso_falla;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
