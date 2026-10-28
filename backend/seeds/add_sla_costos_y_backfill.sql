-- =============================================================================
-- BACKFILL DE SLA / COSTO POR MAQUINA Y VENCIMIENTOS DE OTs
-- =============================================================================
-- PREREQUISITO: `uv run alembic upgrade head` (migracion 0011_sla_costo_maquina crea
-- las columnas). Para aplicar en produccion a mano. Ejecuta:
--
--   1. (Columnas `maquina.sla_horas` y `maquina.costo_inactividad_minuto`: ya las crea
--      la migracion 0011; este script no toca el esquema.)
--   2. Les asigna valor a las maquinas segun su criticidad.
--   3. Calcula `orden_trabajo.fecha_vencimiento` para las OTs historicas, con la misma
--      formula que usa el alta de OT:
--
--          fecha_vencimiento = fecha_creacion
--                            + sla_horas(maquina) * 60 * factor(prioridad) minutos
--
--      con los factores urgent 0.5, high 0.75, medium 1.0, low 1.5.
--
-- COMO CORRERLO
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/seeds/add_sla_costos_y_backfill.sql
--
--   (`-v ON_ERROR_STOP=1` es importante: sin eso psql sigue tras un error y deja
--    el backfill a medias.)
--
-- LOCKS: el ALTER toma un lock exclusivo sobre `maquina` un instante (la tabla es chica),
-- pero el UPDATE de `orden_trabajo` mantiene locks de escritura mientras recorre la tabla.
-- En produccion conviene correrlo en una ventana de baja actividad, no en horario pico.
--
-- ES IDEMPOTENTE Y NO PISA DATOS:
--   * Las columnas se crean con IF NOT EXISTS.
--   * Los valores de SLA/costo solo se escriben donde estan en NULL: si alguien ya los
--     cargo a mano desde el mantenedor, se respeta.
--   * Los vencimientos solo se calculan donde estan en NULL: las OTs que ya tienen fecha
--     (fijada a mano o por el alta nueva) no se tocan.
--   * Las OTs canceladas se excluyen: no se van a atender.
--
-- TRANSACCION: todo va entre BEGIN y COMMIT. Antes del COMMIT hay un bloque de
-- VERIFICACION que imprime los conteos y una muestra. Si algo no cuadra, salir con
-- \q (o Ctrl+C) en vez de COMMIT: no se guarda nada.
--
-- NOTA SOBRE ENCODING: el archivo es ASCII puro a proposito, para que no dependa del
-- client_encoding del servidor.
--
-- EQUIVALENTE EN PYTHON: backend/scripts/backfill_sla_costos.py (misma logica, con
-- --dry-run). Este .sql existe para poder aplicarlo donde no se puede correr Python.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Columnas
-- -----------------------------------------------------------------------------
-- Las columnas las crea la migracion Alembic 0011_sla_costo_maquina. Correr antes
-- `uv run alembic upgrade head`; si no existen, este script falla (ON_ERROR_STOP).

-- -----------------------------------------------------------------------------
-- 2. Valores por maquina, segun criticidad
-- -----------------------------------------------------------------------------
-- Se clasifica por NOMBRE + CODIGO (no por disciplina: "Mecanica" agrupa un compresor y
-- una bomba, que no valen lo mismo parados). Los terminos son los que distinguen un
-- equipo que detiene la linea de uno que puede esperar al proximo turno.
--
--   criticas    : SLA 8-12 h   costo 2000-5000 /min
--   no criticas : SLA 24-48 h  costo  500-1000 /min
--
-- Dentro de cada rango el valor varia con el id de la maquina (modulo), para que no
-- queden 22 equipos con el mismo numero y el resultado sea reproducible en cada corrida.
--
-- El regex esta escrito para no depender de acentos: `subestaci.n` matchea "Subestacion"
-- y tambien la version con tilde. Por eso el archivo se mantiene en ASCII puro.
WITH clasificacion AS (
    SELECT
        m.maquina_id,
        lower(m.nombre || ' ' || m.codigo) ~
            '(compressor|compresor|plc|chiller|chancador|molino|prensa|press|subestaci.n|correa|overland|tritura|caldera)'
            AS critica
      FROM maquina m
)
UPDATE maquina m
   SET sla_horas = COALESCE(
           m.sla_horas,
           CASE WHEN c.critica THEN 8 + (m.maquina_id % 5)              -- 8, 9, 10, 11, 12
                ELSE 24 + (m.maquina_id % 5) * 6 END                    -- 24, 30, 36, 42, 48
       ),
       costo_inactividad_minuto = COALESCE(
           m.costo_inactividad_minuto,
           CASE WHEN c.critica THEN 2000 + (m.maquina_id % 4) * 1000    -- 2000..5000
                ELSE 500 + (m.maquina_id % 3) * 250 END                 -- 500, 750, 1000
       )
  FROM clasificacion c
 WHERE c.maquina_id = m.maquina_id
   AND (m.sla_horas IS NULL OR m.costo_inactividad_minuto IS NULL);

-- -----------------------------------------------------------------------------
-- 3. Backfill de vencimientos de OTs
-- -----------------------------------------------------------------------------
-- `make_interval(mins => N)` recibe un entero, de ahi el ROUND(...)::int: sin el cast,
-- PostgreSQL no resuelve la firma cuando el argumento es numeric.
--
-- `ot.priority::text` porque es un enum: comparar contra literales sin el cast funciona,
-- pero el cast deja el CASE explicito y evita sorpresas si el enum se renombra.
--
-- El ELSE 1.0 cubre una prioridad nueva que no este en la lista: en vez de no calcular
-- nada, aplica el factor neutro.
UPDATE orden_trabajo ot
   SET fecha_vencimiento = ot.fecha_creacion + make_interval(
           mins => ROUND(
               m.sla_horas * 60 * (CASE ot.priority::text
                                       WHEN 'urgent' THEN 0.5
                                       WHEN 'high'   THEN 0.75
                                       WHEN 'medium' THEN 1.0
                                       WHEN 'low'    THEN 1.5
                                       ELSE 1.0
                                   END)
           )::int
       )
  FROM maquina m
 WHERE m.maquina_id = ot.maquina_id
   AND ot.fecha_vencimiento IS NULL
   AND ot.estado <> 'cancelled'
   AND m.sla_horas IS NOT NULL;

-- =============================================================================
-- VERIFICACION (leer antes de confirmar)
-- =============================================================================
-- Todo esto corre dentro de la misma transaccion: refleja lo que se va a guardar.

-- 1) Columnas creadas
SELECT column_name, data_type, numeric_precision, numeric_scale
  FROM information_schema.columns
 WHERE table_name = 'maquina'
   AND column_name IN ('sla_horas', 'costo_inactividad_minuto')
 ORDER BY column_name;

-- 2) Cobertura: ninguna maquina puede quedar sin SLA ni sin costo
SELECT COUNT(*)                                        AS maquinas,
       COUNT(sla_horas)                                AS con_sla,
       COUNT(costo_inactividad_minuto)                 AS con_costo,
       MIN(sla_horas)                                  AS sla_min,
       MAX(sla_horas)                                  AS sla_max,
       MIN(costo_inactividad_minuto)                   AS costo_min,
       MAX(costo_inactividad_minuto)                   AS costo_max
  FROM maquina;

-- 3) Muestra de maquinas (las de menor SLA: las mas criticas)
SELECT m.nombre, m.codigo, m.sla_horas, m.costo_inactividad_minuto
  FROM maquina m
 ORDER BY m.sla_horas NULLS LAST, m.nombre
 LIMIT 10;

-- 4) Vencimientos: cuantas OTs quedan sin fecha y cuantas se calcularon
SELECT COUNT(*) FILTER (WHERE fecha_vencimiento IS NULL AND estado <> 'cancelled')
           AS ots_pendientes,
       COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL)
           AS ots_con_vencimiento,
       COUNT(*) FILTER (WHERE estado = 'cancelled')
           AS ots_canceladas
  FROM orden_trabajo;

-- 5) La aritmetica: 0 filas en `mal_calculadas` significa que el plazo guardado es
--    exactamente sla_horas x factor de prioridad.
SELECT COUNT(*) AS con_vencimiento,
       COUNT(*) FILTER (
           WHERE ROUND(EXTRACT(EPOCH FROM (ot.fecha_vencimiento - ot.fecha_creacion)) / 3600, 2)
              = ROUND(m.sla_horas * (CASE ot.priority::text
                                         WHEN 'urgent' THEN 0.5
                                         WHEN 'high'   THEN 0.75
                                         WHEN 'medium' THEN 1.0
                                         WHEN 'low'    THEN 1.5
                                         ELSE 1.0 END), 2)
       ) AS correctas,
       COUNT(*) FILTER (
           WHERE ROUND(EXTRACT(EPOCH FROM (ot.fecha_vencimiento - ot.fecha_creacion)) / 3600, 2)
              <> ROUND(m.sla_horas * (CASE ot.priority::text
                                          WHEN 'urgent' THEN 0.5
                                          WHEN 'high'   THEN 0.75
                                          WHEN 'medium' THEN 1.0
                                          WHEN 'low'    THEN 1.5
                                          ELSE 1.0 END), 2)
       ) AS mal_calculadas
  FROM orden_trabajo ot
  JOIN maquina m ON m.maquina_id = ot.maquina_id
 WHERE ot.fecha_vencimiento IS NOT NULL;

-- 6) Muestra de 5 OTs: se ve prioridad, SLA, plazo y fecha resultante
SELECT ot.numero_ot,
       ot.priority                                 AS prioridad,
       m.nombre                                    AS maquina,
       m.sla_horas,
       ot.fecha_creacion,
       ot.fecha_vencimiento,
       ROUND(EXTRACT(EPOCH FROM (ot.fecha_vencimiento - ot.fecha_creacion)) / 3600, 2)
                                                   AS plazo_horas
  FROM orden_trabajo ot
  JOIN maquina m ON m.maquina_id = ot.maquina_id
 WHERE ot.fecha_vencimiento IS NOT NULL
 ORDER BY ot.ot_id DESC
 LIMIT 5;

COMMIT;

-- =============================================================================
-- DESPUES DE APLICAR
-- =============================================================================
-- 1. REINICIAR el backend. `catalog.py` memoriza en el primer uso si las columnas
--    existen; si el proceso arranco antes del ALTER, seguiria respondiendo 503 hasta
--    que se reinicie.
--
-- 2. El Dashboard recien despues empieza a usar el SLA y el costo de cada maquina
--    (antes caia al valor global de la empresa).
--
-- PARA DESHACER (solo si hiciera falta, y es destructivo):
--   BEGIN;
--     ALTER TABLE maquina DROP COLUMN IF EXISTS sla_horas;
--     ALTER TABLE maquina DROP COLUMN IF EXISTS costo_inactividad_minuto;
--   COMMIT;
--   Los datos de las columnas se pierden. Los `fecha_vencimiento` calculados por este
--   script quedan; para volver a NULL habria que hacer un UPDATE aparte, y solo tiene
--   sentido si se sabe con certeza que esas OTs no tenian fecha antes (o sea, nunca).
-- =============================================================================
