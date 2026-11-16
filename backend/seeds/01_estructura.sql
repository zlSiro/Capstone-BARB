-- =============================================================================
-- 01_estructura.sql — Verificación de estructura para los seeds realistas
-- =============================================================================
-- Proyecto: BARB (Capstone DUOC UC) · Rama: feat/seed-realista
--
-- QUÉ HACE
--   1. Asegura la extensión `vector` (pgvector), que necesitan los embeddings de
--      documentos y del RAG.
--   2. Verifica que el esquema de BARB esté aplicado: si falta alguna tabla
--      principal, corta con un mensaje claro en vez de dejar que los INSERT
--      fallen a mitad de camino.
--
-- QUÉ **NO** HACE (a propósito)
--   - NO crea tablas. El esquema es responsabilidad exclusiva de Alembic
--     (`uv run alembic upgrade head`). Un CREATE TABLE acá desincronizaría el
--     `down_revision` y rompería las migraciones futuras.
--   - NO borra ni modifica datos.
--
-- CÓMO SE APLICA (base local, desde backend/)
--   Windows (cmd, recomendado):
--     docker exec -i barb_capstone_postgres psql -U barb_admin -d barb_database
--       -v ON_ERROR_STOP=1 < seeds\01_estructura.sql
--   Linux/macOS:
--     docker exec -i barb_capstone_postgres psql -U barb_admin -d barb_database \
--       -v ON_ERROR_STOP=1 < seeds/01_estructura.sql
--   O con psql en el host:
--     psql "postgresql://barb_admin:barb_password123@localhost:5432/barb_database" \
--       -f seeds/01_estructura.sql
--
-- ⚠ NO uses "Get-Content archivo.sql | docker exec -i ..." en PowerShell: la
--   tubería re-codifica a la página ANSI de la consola y los acentos terminan
--   doble-codificados ("Minería" se guarda como "MinerÃ­a"). Los ejemplos de
--   arriba usan la redirección `<` del shell, que pasa los bytes tal cual.
--   Los archivos están en UTF-8 sin BOM.
--
-- Es idempotente: se puede correr las veces que haga falta.
-- =============================================================================

-- pgvector: la migración 0003 ya la crea. El IF NOT EXISTS lo vuelve inocuo si ya
-- está, y evita el "permission denied" que daría intentar crearla con un rol que
-- no es superusuario (barb_admin no lo es).
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Guardia: ¿está el esquema migrado?
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    -- Tablas que usan los seeds y la aplicación. Si falta alguna, el problema es
    -- que no se aplicaron las migraciones, no los datos.
    requeridas text[] := ARRAY[
        'empresa', 'usuario', 'planta', 'disciplina', 'maquina',
        'orden_trabajo', 'aviso_falla', 'documento', 'documento_chunk',
        'documento_embedding', 'sensor', 'lectura_sensor', 'repuesto',
        'programa_mantenimiento', 'transacciones', 'auditoria_cambio',
        'topologia_nodo', 'topologia_conexion', 'chat_session'
    ];
    faltantes text[] := ARRAY[]::text[];
    tabla text;
    revision text;
BEGIN
    FOREACH tabla IN ARRAY requeridas LOOP
        IF to_regclass(format('public.%I', tabla)) IS NULL THEN
            faltantes := faltantes || tabla;
        END IF;
    END LOOP;

    IF cardinality(faltantes) > 0 THEN
        RAISE EXCEPTION
            'Esquema BARB incompleto: faltan las tablas [%]. Aplicá las migraciones antes de los seeds: uv run alembic upgrade head',
            array_to_string(faltantes, ', ');
    END IF;

    -- Revisión de Alembic: informativa. No se fija un número exacto a propósito
    -- (cuando entre la 0016 este archivo no tiene que cambiar).
    IF to_regclass('public.alembic_version') IS NULL THEN
        RAISE WARNING 'No existe alembic_version: el esquema no fue migrado con Alembic.';
    ELSE
        SELECT version_num INTO revision FROM alembic_version LIMIT 1;
        IF revision IS NULL THEN
            RAISE WARNING 'alembic_version está vacía: no consta ninguna migración aplicada.';
        ELSE
            RAISE NOTICE 'Esquema BARB verificado. Revisión Alembic actual: %', revision;
        END IF;
    END IF;

    RAISE NOTICE 'pgvector disponible: %', (SELECT extversion FROM pg_extension WHERE extname = 'vector');
END $$;
