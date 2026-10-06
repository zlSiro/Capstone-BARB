"""multi-empresa + documentación por empresa para el chat IA (RAG)

Revision ID: 0004_multiempresa_documentos
Revises: 0003_work_order_indexes
Create Date: 2026-10-05

Cambios de estructura de datos (resumen; detalle en docs/MULTIEMPRESA.md):

1. USUARIO.empresa_id pasa a ser NULLABLE y se agrega un CHECK: solo el rol
   'super_usuario' puede no pertenecer a una empresa (ve toda la plataforma).
   El resto de los roles sigue obligado a tener empresa.
2. DOCUMENTO (creada en 0002 sin dueño) recibe:
     - empresa_id  (NOT NULL, FK)  -> aislamiento: cada empresa solo ve/usa lo suyo
     - usuario_id  (FK, SET NULL)  -> quién subió el archivo
     - content_type, size_bytes    -> metadatos del archivo
     - activo                      -> permite excluir un documento de la IA sin borrarlo
3. DOCUMENTO_CHUNK (nueva): fragmentos de texto de cada documento con un
   tsvector generado ('spanish') + índice GIN. Es la base de recuperación (RAG)
   del chat: la IA solo recibe fragmentos de la empresa del usuario.
4. Índices por empresa_id en USUARIO y PLANTA (todas las consultas de OT se
   filtran por planta.empresa_id).

No se agrega empresa_id a ORDEN_TRABAJO: la pertenencia se deriva de
orden_trabajo -> maquina -> planta.empresa_id, evitando duplicar el dato.
"""

from __future__ import annotations

from alembic import op

revision = "0004_multiempresa_documentos"
down_revision = "0003_work_order_indexes"
branch_labels = None
depends_on = None

_DDL_UP = r"""
-- 1) Usuario: empresa opcional solo para super_usuario ------------------------
ALTER TABLE usuario ALTER COLUMN empresa_id DROP NOT NULL;
ALTER TABLE usuario ADD CONSTRAINT ck_usuario_empresa_rol
    CHECK (rol = 'super_usuario' OR empresa_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS ix_usuario_empresa ON usuario (empresa_id);
CREATE INDEX IF NOT EXISTS ix_planta_empresa  ON planta  (empresa_id);

-- 2) Documento: pertenencia a empresa y metadatos ------------------------------
ALTER TABLE documento ADD COLUMN empresa_id   INTEGER REFERENCES empresa(empresa_id) ON DELETE CASCADE;
ALTER TABLE documento ADD COLUMN usuario_id   INTEGER REFERENCES usuario(usuario_id) ON DELETE SET NULL;
ALTER TABLE documento ADD COLUMN content_type VARCHAR(100);
ALTER TABLE documento ADD COLUMN size_bytes   BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE documento ADD COLUMN activo       BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill de filas previas: empresa de su disciplina, o la primera empresa.
UPDATE documento d
SET empresa_id = COALESCE(
    (SELECT di.empresa_id FROM disciplina di WHERE di.disciplina_id = d.discipline_id),
    (SELECT MIN(empresa_id) FROM empresa)
);
ALTER TABLE documento ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX ix_documento_empresa ON documento (empresa_id, activo);

-- 3) Fragmentos indexados para búsqueda de texto completo ----------------------
CREATE TABLE documento_chunk (
    chunk_id     SERIAL PRIMARY KEY,
    documento_id INTEGER NOT NULL REFERENCES documento(documento_id) ON DELETE CASCADE,
    -- empresa_id se duplica a propósito: permite filtrar por tenant en la misma
    -- consulta del índice GIN sin join, y es una barrera extra de aislamiento.
    empresa_id   INTEGER NOT NULL REFERENCES empresa(empresa_id)     ON DELETE CASCADE,
    orden        INTEGER NOT NULL,
    contenido    TEXT    NOT NULL,
    tsv          TSVECTOR GENERATED ALWAYS AS (to_tsvector('spanish', contenido)) STORED
);
CREATE INDEX ix_chunk_tsv     ON documento_chunk USING GIN (tsv);
CREATE INDEX ix_chunk_empresa ON documento_chunk (empresa_id);
CREATE INDEX ix_chunk_doc     ON documento_chunk (documento_id, orden);
"""

_DDL_DOWN = r"""
DROP TABLE IF EXISTS documento_chunk;
DROP INDEX IF EXISTS ix_documento_empresa;
ALTER TABLE documento DROP COLUMN IF EXISTS activo;
ALTER TABLE documento DROP COLUMN IF EXISTS size_bytes;
ALTER TABLE documento DROP COLUMN IF EXISTS content_type;
ALTER TABLE documento DROP COLUMN IF EXISTS usuario_id;
ALTER TABLE documento DROP COLUMN IF EXISTS empresa_id;
DROP INDEX IF EXISTS ix_planta_empresa;
DROP INDEX IF EXISTS ix_usuario_empresa;
-- Los super_usuario no tienen empresa: se eliminan para poder restaurar NOT NULL.
DELETE FROM usuario WHERE empresa_id IS NULL;
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS ck_usuario_empresa_rol;
ALTER TABLE usuario ALTER COLUMN empresa_id SET NOT NULL;
"""


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
