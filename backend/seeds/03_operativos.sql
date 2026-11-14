-- =============================================================================
-- 03_operativos.sql — Historial de operación, documentos y mantenimiento
-- =============================================================================
-- Proyecto: BARB (Capstone DUOC UC) · Rama: feat/seed-realista
--
-- QUÉ HACE (sobre las 3 empresas del informe)
--   1. 528 órdenes de trabajo en EXACTAMENTE 24 meses calendario (48 por máquina),
--      con fechas relativas a date_trunc('month', CURRENT_DATE) para que el
--      dashboard nunca envejezca. El creador de cada OT es el SUPERVISOR de la
--      empresa (rol que opera las OT en la matriz vigente); el técnico asignado
--      rota entre los tres técnicos de esa empresa.
--   2. 12 repuestos (4 por empresa) con stock, costo y proveedor.
--   3. 11 programas de mantenimiento preventivo (uno por máquina).
--   5. Lecturas de sensores (168), repuestos usados en OTs (109), bitácora de OTs
--      (996), 6 sesiones de diagnóstico con sus diagnósticos y reportes, y 9
--      conversaciones de chat. Estas cinco capas se RESCATARON de seed_data.sql
--      al consolidar los seeds (la vista de topología, el historial de la OT y el
--      historial del chat arrancaban vacíos sin ellas).
--   4. 8 manuales reales en `documento` (Sandvik, Siemens, Parker, amoníaco,
--      KUKA, Larzep, KSB, Grundfos) + 24 fragmentos en `documento_chunk`, con la
--      URL de origen de cada manual (los links del informe) en `notes`.
--
-- TRIGGERS
--   Los seeds insertan cientos de filas de golpe: si los triggers de auditoría y
--   de transacciones están activos, se generan ~10.000 filas en `transacciones` y
--   `auditoria_cambio` que no aportan a la demo (ya pasó con la carga histórica:
--   7.644 y 5.914 filas). Por eso se DESACTIVAN por tabla con
--   `DISABLE TRIGGER USER`, que apaga los triggers de usuario pero **mantiene los
--   de las claves foráneas**: así el seed sigue fallando si referencia algo
--   inexistente. (La alternativa `session_replication_role = replica` apagaría
--   también las FK, y un dato mal referenciado entraría sin avisar.)
--   Al final del archivo se reactivan. Todo va en una transacción, así que si el
--   script falla a la mitad, el ROLLBACK deja los triggers como estaban.
--
-- IDEMPOTENTE
--   - OTs: `numero_ot` = 'REAL-<código>-<mes>-<k>' (único y determinista).
--   - Documentos: por `file_id`; fragmentos: por (documento, orden).
--   - Repuestos: por (empresa, código); programas: por (máquina, nombre).
--   Se puede correr dos veces: la segunda no inserta nada.
--
-- CÓMO SE APLICA (después de 02_maestros.sql, desde backend/)
--   Windows (cmd, recomendado):
--     docker exec -i barb_capstone_postgres psql -U barb_admin -d barb_database
--       -v ON_ERROR_STOP=1 < seeds\03_operativos.sql
--   Linux/macOS:
--     docker exec -i barb_capstone_postgres psql -U barb_admin -d barb_database \
--       -v ON_ERROR_STOP=1 < seeds/03_operativos.sql
--
-- ⚠ NO uses "Get-Content archivo.sql | docker exec -i ..." en PowerShell: la
--   tubería re-codifica a la página ANSI de la consola y los acentos terminan
--   doble-codificados. Ver la advertencia de 01_estructura.sql.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Triggers de auditoría y transacciones: OFF solo en lo que toca este seed
-- -----------------------------------------------------------------------------
ALTER TABLE orden_trabajo         DISABLE TRIGGER USER;
ALTER TABLE documento             DISABLE TRIGGER USER;
ALTER TABLE documento_chunk       DISABLE TRIGGER USER;
ALTER TABLE repuesto              DISABLE TRIGGER USER;
ALTER TABLE programa_mantenimiento DISABLE TRIGGER USER;
ALTER TABLE ot_repuesto            DISABLE TRIGGER USER;
ALTER TABLE diagnostico            DISABLE TRIGGER USER;
ALTER TABLE reporte                DISABLE TRIGGER USER;

-- -----------------------------------------------------------------------------
-- 2. Órdenes de trabajo — 24 meses, 2 por máquina por mes
-- -----------------------------------------------------------------------------
-- El estado se deduce de un "dado" determinista (maquina, mes, k), no de
-- random(): el mismo script produce siempre el mismo historial.
--   - meses 1-2 (los más recientes): pending / in_progress / por_validar
--   - 4% del resto: cancelled (no suma costo ni MTTR en los KPIs)
--   - el resto: completed
WITH maquinas AS (
    SELECT m.maquina_id,
           m.codigo,
           m.nombre,
           m.sla_horas,
           m.costo_inactividad_minuto,
           p.empresa_id
    FROM maquina m
    JOIN planta p ON p.planta_id = m.planta_id
    JOIN empresa e ON e.empresa_id = p.empresa_id
    WHERE e.rut IN ('77.111.111-1', '77.222.222-2', '77.333.333-3')
),
gen AS (
    SELECT m.*,
           g.mes,
           h.k,
           (m.maquina_id * 13 + g.mes * 7 + h.k * 3) % 100 AS dado,
           -- Exactamente 24 meses: se trunca al mes y se retrocede `mes` meses desde
           -- el 1° del mes actual. Con generate_series(0, 23) caen en 24 meses
           -- distintos (el actual incluido), sin el corrimiento de 30 días que
           -- generaba un mes de más.
           date_trunc('month', CURRENT_DATE)
             - ((g.mes || ' months')::interval)
             -- En el mes en curso el desplazamiento se acota al día de hoy: si no,
             -- algunas OTs quedarían "creadas" en el futuro.
             + ((CASE
                     WHEN g.mes = 0
                     THEN LEAST(h.k * 10 + (m.maquina_id % 7),
                                GREATEST(EXTRACT(day FROM CURRENT_DATE)::int - 1, 0))
                     ELSE h.k * 10 + (m.maquina_id % 7)
                 END) * INTERVAL '1 day')
             + INTERVAL '8 hours' AS creacion,
           (m.sla_horas * 60)::int AS sla_min
    FROM maquinas m
    CROSS JOIN generate_series(0, 23) AS g(mes)
    CROSS JOIN generate_series(1, 2)  AS h(k)
),
clasificadas AS (
    SELECT gen.*,
           -- El mes en curso queda 100% abierto (pending / in_progress): así no hay
           -- OTs "cerradas" con fecha de cierre futura. Los dos meses anteriores
           -- suman por_validar, y del resto la mayoría son completed.
           CASE
               WHEN mes = 0                THEN (CASE WHEN dado % 2 = 0 THEN 'pending' ELSE 'in_progress' END)
               WHEN mes <= 2 AND dado < 40 THEN 'por_validar'
               WHEN dado >= 96             THEN 'cancelled'
               ELSE 'completed'
           END AS estado_final
    FROM gen
),
calculadas AS (
    SELECT c.*,
           -- 45%-85% del SLA: la mayoría cumple, y la cola deja ver incumplimientos.
           round(c.sla_min * (0.45 + (c.dado % 41) / 100.0))::int AS mttr,
           CASE
               WHEN c.mes * 7 % 4 = 0 THEN 'corrective'
               WHEN c.mes * 7 % 4 = 1 THEN 'preventive'
               WHEN c.mes * 7 % 4 = 2 THEN 'predictive'
               ELSE 'inspection'
           END AS tipo_final
    FROM clasificadas c
)
INSERT INTO orden_trabajo (
    numero_ot, maquina_id, tecnico_id, creado_por, tipo,
    descripcion_problema, descripcion_reparacion, resolution,
    priority, severity,
    fecha_creacion, fecha_inicio, fecha_cierre, fecha_vencimiento,
    tiempo_reparacion_min, downtime_minutes, costo_estimado, costo_real, estado
)
SELECT
    'REAL-' || c.codigo || '-' || lpad(c.mes::text, 2, '0') || '-' || c.k,
    c.maquina_id,
    -- técnico de la empresa, rotando entre los tres
    (SELECT array_agg(u.usuario_id ORDER BY u.usuario_id)
       FROM usuario u
      WHERE u.empresa_id = c.empresa_id AND u.rol = 'tecnico')[(c.maquina_id + c.mes + c.k) % 3 + 1],
    -- creador: el SUPERVISOR de la empresa, que es el rol que opera las OT en la
    -- matriz vigente (crea, asigna, valida y cierra). Si no hubiera supervisor, cae
    -- al admin para no romper la FK.
    COALESCE(
        (SELECT min(u.usuario_id)
           FROM usuario u
          WHERE u.empresa_id = c.empresa_id AND u.rol = 'supervisor'),
        (SELECT min(u.usuario_id)
           FROM usuario u
          WHERE u.empresa_id = c.empresa_id AND u.rol = 'admin')
    ),
    c.tipo_final::tipo_mantenimiento,
    -- descripción coherente con el tipo de intervención
    CASE c.tipo_final
        WHEN 'corrective'  THEN 'Detención no programada de ' || c.nombre || ': desgaste y fuga en el circuito principal.'
        WHEN 'preventive'  THEN 'Mantención preventiva programada por horómetro de ' || c.nombre || '.'
        WHEN 'predictive'  THEN 'Análisis de vibraciones fuera de rango en ' || c.nombre || '; se programa la intervención.'
        ELSE 'Inspección visual y de ajuste de ' || c.nombre || ' según manual del fabricante.'
    END,
    CASE WHEN c.estado_final IN ('completed', 'por_validar')
         THEN 'Se reemplazó el componente desgastado y se calibró según el manual del fabricante. Equipo operativo.'
    END,
    CASE WHEN c.estado_final = 'completed' THEN 'Intervención validada por el supervisor de turno.' END,
    -- prioridad: a SLA más corto, más urgente
    CASE WHEN c.sla_horas <= 4 THEN 'urgent'
         WHEN c.sla_horas <= 6 THEN 'high'
         WHEN c.sla_horas <= 10 THEN 'medium'
         ELSE 'low'
    END::prioridad_ot,
    CASE WHEN c.tipo_final = 'corrective' THEN 'high' ELSE 'medium' END::nivel_severidad,
    c.creacion,
    CASE WHEN c.estado_final IN ('in_progress', 'por_validar', 'completed')
         THEN c.creacion + INTERVAL '15 minutes'
    END,
    CASE WHEN c.estado_final = 'completed'
         THEN c.creacion + INTERVAL '15 minutes' + (c.mttr * INTERVAL '1 minute')
    END,
    -- vencimiento = creación + SLA del equipo (lo usa el cálculo de cumplimiento)
    c.creacion + (c.sla_horas * INTERVAL '1 hour'),
    CASE WHEN c.estado_final = 'completed' THEN c.mttr END,
    CASE WHEN c.estado_final = 'completed' THEN round(c.mttr * 0.6)::int END,
    CASE WHEN c.estado_final = 'completed'
         THEN round(c.mttr * c.costo_inactividad_minuto * 0.6, 2)
    END,
    CASE WHEN c.estado_final = 'completed'
         THEN round(c.mttr * c.costo_inactividad_minuto * 0.6 * (0.85 + (c.dado % 30) / 100.0), 2)
    END,
    c.estado_final::estado_ot
FROM calculadas c
WHERE NOT EXISTS (
    SELECT 1 FROM orden_trabajo ot
     WHERE ot.numero_ot = 'REAL-' || c.codigo || '-' || lpad(c.mes::text, 2, '0') || '-' || c.k
);

-- -----------------------------------------------------------------------------
-- 3. Repuestos (4 por empresa)
-- -----------------------------------------------------------------------------
INSERT INTO repuesto (
    empresa_id, codigo, part_number, nombre, descripcion, tipo, categoria,
    unidad, stock_actual, stock_minimo, stock_maximo, costo_unitario,
    proveedor, ubicacion_bodega, estado
)
SELECT e.empresa_id, v.codigo, v.part_number, v.nombre, v.descripcion,
       v.tipo, v.categoria, v.unidad, v.stock, v.stock_min, v.stock_max,
       v.costo, v.proveedor, v.ubicacion, 'active'::estado_repuesto
FROM empresa e
CROSS JOIN (VALUES
    -- Minera del Norte
    ('77.111.111-1', 'REP-MIN-001', 'S-2231-707', 'Manto de chancador Sandvik H8800',
     'Manto de desgaste para cámara de trituración del cono H8800.', 'desgaste', 'trituración',
     'unidad', 3, 1, 6, 1850000, 'Sandvik Chile', 'Bodega A-01'),
    ('77.111.111-1', 'REP-MIN-002', 'S-2231-708', 'Cóncavas de chancador H8800',
     'Juego de cóncavas para cámara de trituración, acero al manganeso.', 'desgaste', 'trituración',
     'juego', 2, 1, 4, 2450000, 'Sandvik Chile', 'Bodega A-02'),
    ('77.111.111-1', 'REP-MIN-003', 'KSB-ETA-45', 'Sello mecánico bomba KSB ETA',
     'Sello mecánico simple para bomba centrífuga de pulpa.', 'consumible', 'bombas',
     'unidad', 6, 2, 10, 320000, 'KSB Chile', 'Bodega B-01'),
    ('77.111.111-1', 'REP-MIN-004', 'SKF-23144', 'Rodamiento de chumacera molino SAG',
     'Rodamiento de rodillos a rótula para chumacera de descarga.', 'consumible', 'molienda',
     'unidad', 4, 2, 8, 780000, 'SKF Chile', 'Bodega B-02'),
    -- Planta de Alimentos
    ('77.222.222-2', 'REP-ALI-001', 'P-395L-FLT', 'Filtro de aceite compresor de amoníaco',
     'Filtro de aceite para compresor de tornillo del circuito de frío.', 'consumible', 'refrigeración',
     'unidad', 8, 3, 12, 145000, 'Frío Industrial SpA', 'Bodega F-01'),
    ('77.222.222-2', 'REP-ALI-002', 'P-395L-IGN', 'Electrodo de ignición caldera Parker WH395L',
     'Electrodo de encendido para quemador Low NOx.', 'consumible', 'vapor',
     'unidad', 5, 2, 8, 98000, 'Parker Chile', 'Bodega V-01'),
    ('77.222.222-2', 'REP-ALI-003', 'GF-CM-32', 'Sello mecánico bomba Grundfos CM',
     'Kit de sellos para bomba multietapa de alimentación de caldera.', 'consumible', 'bombas',
     'kit', 4, 2, 6, 210000, 'Grundfos Chile', 'Bodega V-02'),
    ('77.222.222-2', 'REP-ALI-004', 'P-395L-VAL', 'Válvula de seguridad caldera 10 bar',
     'Válvula de seguridad certificada para caldera de vapor.', 'seguridad', 'vapor',
     'unidad', 3, 1, 5, 265000, 'Parker Chile', 'Bodega V-03'),
    -- Manufactura Automotriz
    ('77.333.333-3', 'REP-AUT-001', 'KUKA-KR50-FLT', 'Filtro de aceite KUKA KR 50',
     'Filtro de aceite para reductor de eje del brazo paletizador.', 'consumible', 'robótica',
     'unidad', 6, 2, 10, 320000, 'KUKA Chile', 'Bodega R-01'),
    ('77.333.333-3', 'REP-AUT-002', 'KUKA-GRASA-2', 'Grasa de servo KUKA (cartucho 400 g)',
     'Grasa sintética para articulaciones y guías lineales.', 'consumible', 'robótica',
     'cartucho', 12, 4, 20, 78000, 'KUKA Chile', 'Bodega R-02'),
    ('77.333.333-3', 'REP-AUT-003', 'LZP-MANG-10T', 'Kit de mangueras prensa Larzep 10 t',
     'Mangueras hidráulicas de alta presión con conectores rápidos.', 'consumible', 'hidráulica',
     'kit', 3, 1, 6, 450000, 'Larzep Ibérica', 'Bodega H-01'),
    ('77.333.333-3', 'REP-AUT-004', 'GEN-BAT-12V', 'Batería generador de respaldo 12 V',
     'Batería de arranque para grupo electrógeno de respaldo.', 'consumible', 'eléctrica',
     'unidad', 2, 1, 4, 189000, 'Eléctrica Industrial', 'Bodega E-01')
) AS v(rut, codigo, part_number, nombre, descripcion, tipo, categoria, unidad,
       stock, stock_min, stock_max, costo, proveedor, ubicacion)
WHERE e.rut = v.rut
  AND NOT EXISTS (
      SELECT 1 FROM repuesto r WHERE r.empresa_id = e.empresa_id AND r.codigo = v.codigo
  );

-- -----------------------------------------------------------------------------
-- 4. Programas de mantenimiento preventivo (uno por máquina)
-- -----------------------------------------------------------------------------
INSERT INTO programa_mantenimiento (
    maquina_id, creado_por, nombre, descripcion, instrucciones,
    frecuencia, intervalo_dias, priority, duracion_estimada_min,
    costo_estimado, fecha_inicio, proxima_ejecucion, ultima_ejecucion, estado
)
SELECT m.maquina_id,
       (SELECT min(u.usuario_id)
          FROM usuario u
         WHERE u.empresa_id = p.empresa_id AND u.rol = 'admin'),
       v.nombre || ' — ' || m.nombre,
       v.descripcion,
       v.instrucciones,
       v.frecuencia::frecuencia_mant,
       v.intervalo_dias,
       v.prioridad::prioridad_mant,
       v.duracion,
       v.costo,
       CURRENT_DATE - INTERVAL '6 months',
       (CURRENT_DATE + (v.intervalo_dias - 15) * INTERVAL '1 day') + INTERVAL '9 hours',
       (CURRENT_DATE - 15 * INTERVAL '1 day') + INTERVAL '9 hours',
       'active'::estado_programa
FROM (VALUES
    ('CHA-001', 'Cambio de manto y revisión de cóncavas',
     'Desgaste de cámara de trituración: control de setting y granulometría.',
     'Medir apertura, revisar desgaste del manto, rotar cóncavas y registrar horómetro.',
     'monthly', 30, 'high', 240, 1850000),
    ('COR-001', 'Alineación y tensado de correa',
     'Revisión de alineación, tensado y estado de la banda overland.',
     'Verificar tensión, alineación de polines y temperatura de rodamientos.',
     'monthly', 30, 'medium', 120, 350000),
    ('MOL-001', 'Lubricación y control térmico del molino SAG',
     'Mantención del sistema de lubricación y del devanado del motor Siemens.',
     'Controlar presión de aceite, temperatura de devanado y vibración de chumacera.',
     'quarterly', 90, 'high', 480, 4200000),
    ('BOM-001', 'Revisión de sellos y cavitación bomba KSB',
     'Control de sellos mecánicos, presión de descarga y cavitación.',
     'Inspeccionar sello, medir presión y caudal, revisar ruido anómalo.',
     'monthly', 30, 'medium', 90, 320000),
    ('CAL-001', 'Mantención de caldera Parker WH395L',
     'Purgas, control de combustión y revisión del quemador Low NOx.',
     'Realizar purga, medir tiraje y CO, revisar electrodo de ignición.',
     'monthly', 30, 'high', 180, 500000),
    ('COM-001', 'Revisión del circuito de amoníaco',
     'Control de presiones, fugas y temperatura de descarga del compresor.',
     'Verificar presiones alta/baja, buscar fugas y revisar aceite.',
     'monthly', 30, 'high', 150, 620000),
    ('BOM-002', 'Mantención bomba Grundfos CM',
     'Revisión de sellos, caudal de alimentación y vibración.',
     'Cambiar sello si hay goteo, medir caudal y revisar alineación.',
     'monthly', 30, 'medium', 90, 260000),
    ('ROB-001', 'Preventivo por horas de operación KUKA KR 50',
     'Lubricación de articulaciones y calibración del paletizador.',
     'Engrasar ejes según manual, verificar juego y respaldar programa.',
     'quarterly', 90, 'high', 180, 480000),
    ('PLC-001', 'Respaldo y limpieza de gabinete PLC',
     'Respaldo de programa, limpieza de gabinete y control de temperatura.',
     'Exportar programa, limpiar filtros, medir temperatura y voltajes.',
     'monthly', 30, 'medium', 60, 180000),
    ('PRE-001', 'Revisión hidráulica prensa Larzep',
     'Control de presión, mangueras y purga del circuito hidráulico.',
     'Medir presión, revisar mangueras y purgar el circuito.',
     'monthly', 30, 'high', 120, 450000),
    ('GEN-001', 'Prueba de generador de respaldo',
     'Prueba de arranque, control de batería y de refrigerante.',
     'Arrancar en vacío 20 min, medir voltaje, revisar nivel de combustible.',
     'monthly', 30, 'medium', 60, 150000)
) AS v(codigo, nombre, descripcion, instrucciones, frecuencia, intervalo_dias,
       prioridad, duracion, costo)
JOIN planta p ON p.empresa_id IN (
        SELECT empresa_id FROM empresa
         WHERE rut IN ('77.111.111-1', '77.222.222-2', '77.333.333-3'))
JOIN maquina m ON m.planta_id = p.planta_id AND m.codigo = v.codigo
WHERE NOT EXISTS (
    SELECT 1 FROM programa_mantenimiento pm
     WHERE pm.maquina_id = m.maquina_id
       AND pm.nombre = v.nombre || ' — ' || m.nombre
);

-- -----------------------------------------------------------------------------
-- 5. Documentos: los 8 manuales reales del informe
-- -----------------------------------------------------------------------------
INSERT INTO documento (
    title, discipline_id, maquina_id, notes, original_name, stored_name,
    file_id, chunks_indexed, empresa_id, usuario_id, content_type, size_bytes, activo
)
SELECT v.title, m.disciplina_id, m.maquina_id,
       'Seed realista: manual de referencia del fabricante para el RAG.',
       v.original_name, v.stored_name, v.file_id, 3,
       p.empresa_id,
       (SELECT min(u.usuario_id)
          FROM usuario u
         WHERE u.empresa_id = p.empresa_id AND u.rol = 'engineer'
            OR (u.empresa_id = p.empresa_id AND u.rol = 'admin')),
       'application/pdf', v.size_bytes, true
FROM (VALUES
    ('77.111.111-1', 'CHA-001', 'Manual de operación y ajuste — Chancador de cono Sandvik H8800',
     'sandvik_h8800_manual.pdf', 'seed_realista/sandvik_h8800_manual.pdf',
     'seed-realista-sandvik-h8800', 4100000::bigint),
    ('77.111.111-1', 'MOL-001', 'Instrucciones de operación — Motor Siemens 1LE1/1FP1/1PC1',
     'siemens_motor_1le1.pdf', 'seed_realista/siemens_motor_1le1.pdf',
     'seed-realista-siemens-1le1', 11400000::bigint),
    ('77.222.222-2', 'CAL-001', 'Manual y partes — Caldera Parker WH395L (Low NOx, 395.000 BTU/h)',
     'parker_wh395l_manual.pdf', 'seed_realista/parker_wh395l_manual.pdf',
     'seed-realista-parker-wh395l', 2300000::bigint),
    ('77.222.222-2', 'COM-001', 'Guía del circuito de frío — Compresor de amoníaco',
     'amonaco_circuito_frio.pdf', 'seed_realista/amonaco_circuito_frio.pdf',
     'seed-realista-amonaco-frio', 5600000::bigint),
    ('77.333.333-3', 'ROB-001', 'Manual de operación y mantención — Brazo robótico KUKA KR 50 R2100',
     'kuka_kr50_manual.pdf', 'seed_realista/kuka_kr50_manual.pdf',
     'seed-realista-kuka-kr50', 3200000::bigint),
    ('77.333.333-3', 'PRE-001', 'Manual de prensa hidráulica — Larzep',
     'larzep_prensa_manual.pdf', 'seed_realista/larzep_prensa_manual.pdf',
     'seed-realista-larzep-prensa', 1800000::bigint),
    ('77.111.111-1', 'BOM-001', 'Manual de servicio — Bomba centrífuga KSB ETA',
     'ksb_eta_manual.pdf', 'seed_realista/ksb_eta_manual.pdf',
     'seed-realista-ksb-eta', 782000::bigint),
    ('77.222.222-2', 'BOM-002', 'Instrucciones de mantenimiento — Bomba multietapa Grundfos CM/CME',
     'grundfos_cm_manual.pdf', 'seed_realista/grundfos_cm_manual.pdf',
     'seed-realista-grundfos-cm', 1200000::bigint)
) AS v(rut, codigo, title, original_name, stored_name, file_id, size_bytes)
JOIN empresa e ON e.rut = v.rut
JOIN planta p ON p.empresa_id = e.empresa_id
JOIN maquina m ON m.planta_id = p.planta_id AND m.codigo = v.codigo
WHERE NOT EXISTS (SELECT 1 FROM documento d WHERE d.file_id = v.file_id);

-- Fuente real de cada manual, tomada de los links del informe
-- (PROPUESTA_DATOS_REALES.html). Va en un UPDATE y no en el INSERT para tener una
-- sola fuente de verdad: aplica tanto a las filas nuevas como a las que ya existían
-- sin la URL. Idempotente: solo escribe cuando el texto cambia.
UPDATE documento d
SET notes = v.notas
FROM (VALUES
    ('seed-realista-sandvik-h8800',
     'Seed realista · Fuente: http://opac.pucv.cl/pucv_txt/txt-5500/UCD5754_01.pdf (tesis PUCV, chancador Sandvik H8800)'),
    ('seed-realista-siemens-1le1',
     'Seed realista · Fuente: https://cache.industry.siemens.com/dl/files/362/32182362/att_1163332/v1/BG_1LE1_1FP1_1FP3_1PC1_1PC3_op_Instr_1123.pdf (instrucciones de operación 1LE1/1FP1/1PC1)'),
    ('seed-realista-parker-wh395l',
     'Seed realista · Fuente: https://parkerboiler.com/download/low-nox-395000-btu-boiler-drawing-model-wh395l-multiple-views/ (plano WH395L) y https://www.getmaintainx.com/assets/parker-hannifin-boiler-wh395l-a4f84411-c0ee-44c1-8ec5-dc3d22ae4ec0 (manual y partes)'),
    ('seed-realista-amonaco-frio',
     'Seed realista · Fuente: https://dspace.ups.edu.ec/bitstream/123456789/16151/1/UPS-ST003802.pdf (tesis UPS, refrigeración por amoníaco-agua)'),
    ('seed-realista-kuka-kr50',
     'Seed realista · Fuente: https://repositorio.usm.cl/bitstreams/a7b61037-ab38-460a-a9f3-808fc573c92d/download (tesis UTFSM, manual y plan de mantención KUKA KR 50 R2100)'),
    ('seed-realista-larzep-prensa',
     'Seed realista · Fuente: http://www.larzep.com/descargas/es/_ECZ02013-ESP.pdf (manual de prensa) y http://www.larzep.com/descargas/es/_ECM01113-ESP.pdf (prensa 10 t)'),
    ('seed-realista-ksb-eta',
     'Seed realista · Fuente: http://delta-ca.com/anexos/prod1191_59806347bddd6.pdf (manual de servicio KSB ETA, ES)'),
    ('seed-realista-grundfos-cm',
     'Seed realista · Fuente: https://api.grundfos.com/literature/Grundfosliterature-2186526.pdf (instrucciones de mantenimiento Grundfos CM/CME, ES)')
) AS v(file_id, notas)
WHERE d.file_id = v.file_id
  AND d.notes IS DISTINCT FROM v.notas;

-- -----------------------------------------------------------------------------
-- 6. Fragmentos de documento (3 por manual)
-- -----------------------------------------------------------------------------
-- 	sv es una columna GENERADA por Postgres (to_tsvector sobre contenido), así
-- que no se inserta: se calcula sola al insertar el texto.
INSERT INTO documento_chunk (documento_id, empresa_id, orden, contenido)
SELECT d.documento_id, d.empresa_id, c.orden, c.contenido
FROM (VALUES
    ('seed-realista-sandvik-h8800', 1,
     'Chancador de cono Sandvik H8800: el setting se ajusta con el sistema hidráulico de regulación. Antes de intervenir, detener la alimentación y verificar que la cámara esté libre. El torque de apriete de los pernos del manto es de 1.200 Nm.'),
    ('seed-realista-sandvik-h8800', 2,
     'Desgaste del manto y de las cóncavas: se inspecciona cada 250 horas de operación. Si la granulometría de salida se abre más de 15% respecto del setpoint, corresponde rotar el manto. El costo por minuto de detención de esta máquina justifica un SLA de 8 horas.'),
    ('seed-realista-sandvik-h8800', 3,
     'Fallas típicas: sobrecarga por alimentación excesiva, cavitación en el sistema de lubricación y desgaste desigual del manto. Ante una parada no programada, registrar el downtime y el tiempo de reparación en la orden de trabajo.'),
    ('seed-realista-siemens-1le1', 1,
     'Motor Siemens 1LE1 del molino SAG: verificar alineación con el acoplamiento antes del montaje. La tolerancia de alineación angular es de 0,05 mm. Aplicar la grasa indicada en la placa y controlar la temperatura de devanado (alarma a 130 °C).'),
    ('seed-realista-siemens-1le1', 2,
     'Protección térmica: el relé se ajusta al 105% de la corriente nominal. Las pautas de inspección incluyen medir aislamiento con megóhmetro (mínimo 5 MΩ) y revisar el estado de los rodamientos.'),
    ('seed-realista-siemens-1le1', 3,
     'Lubricación de rodamientos: recambio cada 4.000 horas de operación o una vez al año. Un aumento de vibración superior a 4,5 mm/s indica deterioro del rodamiento y debe programarse la intervención.'),
    ('seed-realista-parker-wh395l', 1,
     'Caldera Parker WH395L: quemador Low NOx de 395.000 BTU/h. La presión de trabajo del vapor es de 10 bar y la válvula de seguridad se calibra a esa presión. Antes de encender, purgar el circuito y verificar el nivel de agua.'),
    ('seed-realista-parker-wh395l', 2,
     'Mantención mensual: limpieza del electrodo de ignición, control de tiraje y medición de CO. La purga de fondo se realiza diariamente. El tratamiento químico del agua evita incrustaciones en el hogar.'),
    ('seed-realista-parker-wh395l', 3,
     'Fallas de encendido: revisar electrodo, presión de gas y fotocelda. Si la caldera queda fuera de servicio, la planta de vapor se detiene: el SLA definido es de 6 horas.'),
    ('seed-realista-amonaco-frio', 1,
     'Circuito de frío con amoníaco: el compresor opera con presión de alta de 12 bar y de baja de 2 bar. El amoníaco es tóxico: ante una fuga, evacuar el sector y usar equipo de respiración autónoma.'),
    ('seed-realista-amonaco-frio', 2,
     'Puesta en marcha: verificar válvulas abiertas, nivel de aceite y sentido de giro. La temperatura de descarga no debe superar los 110 °C. Revisar el separador de líquido.'),
    ('seed-realista-amonaco-frio', 3,
     'Mantención: cambio de filtro de aceite cada 1.000 horas, control de fugas con detector y revisión de presostatos. El túnel de frío tiene SLA de 4 horas por el riesgo de pérdida de producto.'),
    ('seed-realista-kuka-kr50', 1,
     'Brazo robótico KUKA KR 50 R2100: carga máxima 50 kg, alcance 2.100 mm. Antes de operar, verificar el anclaje a fundación y el par de apriete de los pernos según la ficha del fabricante.'),
    ('seed-realista-kuka-kr50', 2,
     'Mantención preventiva por horas de operación: lubricar los seis ejes con la grasa indicada, controlar el juego de las articulaciones y respaldar el programa del controlador. La calibración se valida contra el cero de cada eje.'),
    ('seed-realista-kuka-kr50', 3,
     'Fallas típicas del paletizador: error de seguimiento, colisión detectada y desgaste del reductor del eje 1. Ante un error de seguridad, reiniciar solo después de revisar la zona de trabajo.'),
    ('seed-realista-larzep-prensa', 1,
     'Prensa hidráulica Larzep: la presión de trabajo se ajusta con la válvula limitadora. Antes de intervenir, despresurizar el circuito y purgar el acumulador. Las mangueras se reemplazan ante cualquier signo de porosidad.'),
    ('seed-realista-larzep-prensa', 2,
     'Secuencia de avance y seguridad: verificar el funcionamiento de la cortina de luz y de los pulsadores bimanuales. El mantenimiento de cilindros incluye el cambio de retenes cuando aparece goteo.'),
    ('seed-realista-larzep-prensa', 3,
     'Fallas típicas: pérdida de presión por desgaste interno, fuga en mangueras y ruido en la bomba. Registrar el costo real de la intervención en la OT para el KPI de costo directo.'),
    ('seed-realista-ksb-eta', 1,
     'Bomba centrífuga KSB ETA: montaje con alineación entre bomba y motor, tolerancia de 0,1 mm. Verificar el sentido de giro antes de la puesta en marcha y purgar la succión para evitar cavitación.'),
    ('seed-realista-ksb-eta', 2,
     'Sellos mecánicos: un goteo continuo indica desgaste del sello y requiere reemplazo. La cavitación se detecta por ruido y vibración; corregir la altura de succión o la obstrucción del filtro.'),
    ('seed-realista-ksb-eta', 3,
     'Localización de fallas: caudal bajo por desgaste del impulsor, sobrecalentamiento por sobrecarga y vibración por desalineación. El manual incluye la tabla de fallas con su causa probable.'),
    ('seed-realista-grundfos-cm', 1,
     'Bomba multietapa Grundfos CM/CME: desmontaje y montaje con el kit de mantenimiento del fabricante. Antes de desarmar, despresurizar y cerrar las válvulas de corte.'),
    ('seed-realista-grundfos-cm', 2,
     'Mantención preventiva: revisar el sello, la presión de descarga y el consumo. La tabla de fallas del manual indica las causas de baja presión y de ruido en la bomba.'),
    ('seed-realista-grundfos-cm', 3,
     'Alimentación de caldera: la bomba debe mantener el caudal de diseño con la caldera en régimen. Una caída de caudal obliga a detener el vapor y afecta el SLA de la planta de alimentos.')
) AS c(file_id, orden, contenido)
JOIN documento d ON d.file_id = c.file_id
WHERE NOT EXISTS (
    SELECT 1 FROM documento_chunk ch
     WHERE ch.documento_id = d.documento_id AND ch.orden = c.orden
);

-- -----------------------------------------------------------------------------
-- 7. Lecturas de sensores — 6 por sensor, en los últimos 6 meses
-- -----------------------------------------------------------------------------
-- RESCATADO de seed_data.sql: los 28 sensores de 02_maestros.sql no tenían ninguna
-- lectura, así que la serie temporal del detalle de máquina salía vacía. El valor
-- es determinista (base por sensor × factor del mes) para que dos corridas den lo
-- mismo, y la última lectura de cada sensor queda en `critical` para que el
-- semáforo tenga algo que mostrar.

INSERT INTO lectura_sensor (sensor_id, valor, "timestamp", estado)
SELECT s.sensor_id,
       round((50 + (s.sensor_id % 30)) * v.factor, 2),
       date_trunc('month', CURRENT_DATE) - make_interval(months => v.meses_atras) + interval '12 days',
       v.estado::estado_lectura
FROM sensor s
JOIN maquina m ON m.maquina_id = s.maquina_id
JOIN planta p ON p.planta_id = m.planta_id
JOIN empresa e ON e.empresa_id = p.empresa_id
CROSS JOIN (VALUES
    (0, 1.00, 'normal'), (1, 1.03, 'normal'), (2, 1.08, 'warning'),
    (3, 1.02, 'normal'), (4, 1.01, 'normal'), (5, 1.15, 'critical')
) AS v(meses_atras, factor, estado)
WHERE e.rut IN ('77.111.111-1', '77.222.222-2', '77.333.333-3')
  AND NOT EXISTS (
    SELECT 1 FROM lectura_sensor l
     WHERE l.sensor_id = s.sensor_id
       AND l."timestamp" = date_trunc('month', CURRENT_DATE)
                           - make_interval(months => v.meses_atras) + interval '12 days'
  );

-- -----------------------------------------------------------------------------
-- 8. Repuestos consumidos en las OTs correctivas
-- -----------------------------------------------------------------------------
-- RESCATADO de seed_data.sql: relaciona la bodega (repuesto) con el trabajo real.

INSERT INTO ot_repuesto (ot_id, repuesto_id, cantidad, costo_unitario)
SELECT ot.ot_id, r.repuesto_id, 1 + (ot.ot_id % 2), r.costo_unitario
FROM orden_trabajo ot
JOIN maquina m ON m.maquina_id = ot.maquina_id
JOIN planta p ON p.planta_id = m.planta_id
JOIN empresa e ON e.empresa_id = p.empresa_id
JOIN repuesto r ON r.empresa_id = e.empresa_id
WHERE ot.numero_ot LIKE 'REAL-%'
  AND ot.tipo = 'corrective'
  AND (ot.ot_id + r.repuesto_id) % 5 = 0
  AND NOT EXISTS (
    SELECT 1 FROM ot_repuesto x
     WHERE x.ot_id = ot.ot_id AND x.repuesto_id = r.repuesto_id
  );

-- -----------------------------------------------------------------------------
-- 9. Histórico de cambios de las OTs (bitácora de la OT)
-- -----------------------------------------------------------------------------
-- RESCATADO de seed_data.sql: alimenta la línea de tiempo del detalle de la OT.
-- Dos hitos por OT: la creación (por el supervisor) y, si está cerrada, el cierre.

INSERT INTO ot_audit_log (ot_id, usuario_id, estado_anterior, estado_nuevo, comentario, "timestamp")
SELECT ot.ot_id, sup.usuario_id, NULL, 'pending', 'OT creada por el supervisor de turno',
       coalesce(ot.fecha_creacion, now())
FROM orden_trabajo ot
JOIN maquina m ON m.maquina_id = ot.maquina_id
JOIN planta p ON p.planta_id = m.planta_id
JOIN empresa e ON e.empresa_id = p.empresa_id
JOIN (SELECT empresa_id, min(usuario_id) AS usuario_id
        FROM usuario WHERE rol = 'supervisor' GROUP BY empresa_id) sup
  ON sup.empresa_id = e.empresa_id
WHERE ot.numero_ot LIKE 'REAL-%'
  AND NOT EXISTS (
    SELECT 1 FROM ot_audit_log a WHERE a.ot_id = ot.ot_id AND a.estado_nuevo = 'pending'
  );

INSERT INTO ot_audit_log (ot_id, usuario_id, estado_anterior, estado_nuevo, comentario, "timestamp")
SELECT ot.ot_id, sup.usuario_id, ot.estado, 'completed', 'Cierre validado por el supervisor',
       coalesce(ot.fecha_cierre, ot.fecha_creacion)
FROM orden_trabajo ot
JOIN maquina m ON m.maquina_id = ot.maquina_id
JOIN planta p ON p.planta_id = m.planta_id
JOIN empresa e ON e.empresa_id = p.empresa_id
JOIN (SELECT empresa_id, min(usuario_id) AS usuario_id
        FROM usuario WHERE rol = 'supervisor' GROUP BY empresa_id) sup
  ON sup.empresa_id = e.empresa_id
WHERE ot.numero_ot LIKE 'REAL-%'
  AND ot.estado = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM ot_audit_log a WHERE a.ot_id = ot.ot_id AND a.estado_nuevo = 'completed'
  );

-- -----------------------------------------------------------------------------
-- 10. Sesiones de diagnóstico, diagnósticos y reportes
-- -----------------------------------------------------------------------------
-- RESCATADO de seed_data.sql: es la cadena que alimenta el asistente (diagnóstico
-- por sesión) y el reporte que se genera a partir de ella.

INSERT INTO sesion_debug (empresa_id, maquina_id, tecnico_id, titulo, observaciones, created_at)
SELECT sel.empresa_id, sel.maquina_id, tec.usuario_id,
       'Diagnóstico ' || sel.codigo || ' · ' || sel.orden,
       'Sesión de análisis asistido sobre la máquina ' || sel.codigo || '.',
       now() - make_interval(days => ((10 - sel.orden) * 9)::int)
FROM (
    SELECT e.empresa_id, m.maquina_id, m.codigo,
           row_number() OVER (PARTITION BY e.empresa_id ORDER BY m.codigo) AS orden
      FROM maquina m
      JOIN planta p ON p.planta_id = m.planta_id
      JOIN empresa e ON e.empresa_id = p.empresa_id
     WHERE e.rut IN ('77.111.111-1', '77.222.222-2', '77.333.333-3')
) sel
JOIN (SELECT empresa_id, min(usuario_id) AS usuario_id
        FROM usuario WHERE rol = 'tecnico' GROUP BY empresa_id) tec
  ON tec.empresa_id = sel.empresa_id
WHERE sel.orden <= 2
  AND NOT EXISTS (
    SELECT 1 FROM sesion_debug s
     WHERE s.maquina_id = sel.maquina_id
       AND s.titulo = 'Diagnóstico ' || sel.codigo || ' · ' || sel.orden
  );

INSERT INTO diagnostico (sesion_id, descripcion, severidad)
SELECT s.sesion_id,
       CASE WHEN s.titulo LIKE '%· 1' THEN
            'Vibración fuera de rango en el eje de accionamiento: revisar alineación y rodamientos.'
       ELSE
            'Temperatura de operación por sobre el punto de consigna: verificar lubricación y ventilación.'
       END,
       CASE WHEN s.titulo LIKE '%· 1' THEN 'high'::nivel_severidad
            ELSE 'medium'::nivel_severidad END
FROM sesion_debug s
WHERE s.titulo LIKE 'Diagnóstico %· %'
  AND NOT EXISTS (
    SELECT 1 FROM diagnostico d WHERE d.sesion_id = s.sesion_id
  );

INSERT INTO reporte (report_number, sesion_id, diagnostico_id, maquina_id, tecnico_id,
                     summary, issue_description, resolution, severity, downtime_minutes,
                     estado, created_at)
SELECT 'RPT-REAL-' || lpad(sel.n::text, 3, '0'), s.sesion_id, d.diagnostico_id, s.maquina_id,
       s.tecnico_id,
       'Intervención sobre ' || m.codigo,
       CASE WHEN d.severidad = 'high' THEN 'Vibración y ruido en el accionamiento'
            ELSE 'Temperatura sobre el punto de consigna' END,
       'Se ajustó alineación, se reemplazó rodamiento y se verificó la temperatura en marcha.',
       d.severidad,
       90 + sel.n * 15,
       'approved'::estado_reporte,
       s.created_at
FROM (
    SELECT s2.sesion_id, s2.maquina_id, s2.tecnico_id, s2.created_at,
           row_number() OVER (ORDER BY s2.sesion_id) AS n
      FROM sesion_debug s2
     WHERE s2.titulo LIKE 'Diagnóstico %· %'
) sel
JOIN sesion_debug s ON s.sesion_id = sel.sesion_id
JOIN maquina m ON m.maquina_id = s.maquina_id
JOIN diagnostico d ON d.sesion_id = s.sesion_id
WHERE NOT EXISTS (
    SELECT 1 FROM reporte r WHERE r.report_number = 'RPT-REAL-' || lpad(sel.n::text, 3, '0')
);

-- -----------------------------------------------------------------------------
-- 11. Historial de conversaciones del chat (3 por empresa)
-- -----------------------------------------------------------------------------
-- RESCATADO de seed_data.sql: la pantalla de historial del chat arrancaba vacía.

INSERT INTO chat_session (empresa_id, titulo, saved_by, usuario_id, discipline,
                          plant_id, plant_name, machine_id, machine_name,
                          active_manual, messages, metadata, saved_at)
SELECT e.empresa_id, v.titulo, tec.nombre, tec.usuario_id, v.disciplina,
       p.planta_id::text, p.nombre, m.maquina_id::text, m.nombre,
       v.manual,
       jsonb_build_array(
           jsonb_build_object('role', 'user', 'content', v.pregunta, 'timestamp', 1760000000000),
           jsonb_build_object('role', 'assistant', 'content', v.respuesta, 'timestamp', 1760000010000)
       ),
       jsonb_build_object('modelo', 'demo', 'fuente', 'seed-realista'),
       now() - make_interval(days => v.dias_atras)
FROM (
    VALUES
      ('77.111.111-1', 'CHA-001', 'Mecánica',
       'Falla recurrente en el chancador de cono: ¿qué reviso antes de desmontar?',
       'Revisar el setting y el desgaste del manto. Si el consumo de potencia sube con el mismo setting, el manto está al límite. Ver el manual Sandvik del chancador antes de intervenir.',
       'Manual Chancador Sandvik H8800', 4, 'Diagnóstico chancador CHA-001'),
      ('77.111.111-1', 'MOL-001', 'Eléctrica',
       'El molino SAG dispara la protección térmica del motor.',
       'Verificar la ventilación del motor Siemens y la carga del molino. Una protección térmica recurrente sugiere sobrecarga o falla de refrigeración.',
       'Instrucciones Siemens 1LE1', 9, 'Protección térmica molino SAG'),
      ('77.111.111-1', 'BOM-001', 'Mecánica',
       'La bomba de pulpa pierde presión de descarga.',
       'Posibles causas: desgaste del impulsor, sello mecánico dañado o cavitación. Revisar la curva de la bomba KSB y el nivel del estanque.',
       'Manual KSB ETA', 14, 'Pérdida de presión bomba de pulpa'),
      ('77.222.222-2', 'CAL-001', 'Mecánica',
       'La caldera no alcanza la presión de trabajo a la hora de arranque.',
       'Revisar el tiempo de purga y el estado del quemador. Una caldera Parker WH395L que no llega a presión suele tener exceso de purga o boquilla sucia.',
       'Ficha Parker WH395L', 3, 'Caldera sin presión en arranque'),
      ('77.222.222-2', 'COM-001', 'Refrigeración',
       'Salta la alarma de amoníaco en el túnel de frío. ¿Cuál es el protocolo?',
       'Evacuar la zona, activar la ventilación forzada y verificar la detección con el equipo de protección. No ingresar sin autorización del supervisor.',
       'Protocolo de amoníaco', 7, 'Alarma de amoníaco en túnel de frío'),
      ('77.222.222-2', 'BOM-002', 'Mecánica',
       'La bomba de alimentación de caldera hace ruido y vibra.',
       'Revisar alineación, cavitación y estado de los rodamientos. En bombas Grundfos CM/CME el ruido suele venir de succión obstruida.',
       'Instrucciones Grundfos CM/CME', 18, 'Ruido en bomba de alimentación'),
      ('77.333.333-3', 'ROB-001', 'Automatización',
       'El brazo KUKA hace un movimiento brusco al paletizar.',
       'Revisar la calibración y el estado de los frenos de los ejes. Un movimiento brusco puede ser pérdida de referencia de encoder.',
       'Tesis UTFSM KUKA KR 50 R2100', 5, 'Movimiento brusco brazo KUKA'),
      ('77.333.333-3', 'PRE-001', 'Mecánica',
       'La prensa hidráulica no mantiene la presión en el punto muerto.',
       'Revisar la válvula de retención y la purga del circuito. Fuga interna del cilindro es la causa más común de caída de presión.',
       'Manual Larzep', 11, 'Prensa sin retención de presión'),
      ('77.333.333-3', 'PLC-001', 'Automatización',
       'El PLC pierde comunicación con el variador de la línea.',
       'Verificar el cableado del bus y la terminación. Revisar también el diagnóstico del puerto en el PLC Siemens.',
       'Manual PLC Siemens', 21, 'Pérdida de comunicación PLC-variador')
) AS v(rut, codigo, disciplina, pregunta, respuesta, manual, dias_atras, titulo)
JOIN empresa e ON e.rut = v.rut
JOIN maquina m ON m.codigo = v.codigo
JOIN planta p ON p.planta_id = m.planta_id
JOIN (SELECT empresa_id, min(usuario_id) AS usuario_id, min(nombre) AS nombre
        FROM usuario WHERE rol = 'tecnico' GROUP BY empresa_id) tec
  ON tec.empresa_id = e.empresa_id
WHERE NOT EXISTS (SELECT 1 FROM chat_session c WHERE c.titulo = v.titulo);

-- -----------------------------------------------------------------------------
-- 7. Triggers: ON de nuevo (si algo falla antes, el ROLLBACK los deja como estaban)
-- -----------------------------------------------------------------------------
ALTER TABLE orden_trabajo         ENABLE TRIGGER USER;
ALTER TABLE documento             ENABLE TRIGGER USER;
ALTER TABLE documento_chunk       ENABLE TRIGGER USER;
ALTER TABLE repuesto              ENABLE TRIGGER USER;
ALTER TABLE programa_mantenimiento ENABLE TRIGGER USER;
ALTER TABLE ot_repuesto            ENABLE TRIGGER USER;
ALTER TABLE diagnostico            ENABLE TRIGGER USER;
ALTER TABLE reporte                ENABLE TRIGGER USER;

COMMIT;

-- -----------------------------------------------------------------------------
-- Verificación (solo lectura)
-- -----------------------------------------------------------------------------
-- OTs del seed, por empresa y estado: esperado 528 en total (48 por máquina).
SELECT e.nombre AS empresa,
       count(*)                                        AS ots,
       count(*) FILTER (WHERE ot.estado = 'completed')  AS completadas,
       count(*) FILTER (WHERE ot.estado = 'cancelled')  AS canceladas,
       count(*) FILTER (WHERE ot.estado IN ('pending', 'in_progress', 'por_validar')) AS abiertas,
       round(avg(ot.tiempo_reparacion_min) FILTER (WHERE ot.estado = 'completed'))::int AS mttr_prom,
       round(sum(ot.downtime_minutes) FILTER (WHERE ot.estado = 'completed') / 60.0)::int AS horas_downtime
FROM orden_trabajo ot
JOIN maquina m ON m.maquina_id = ot.maquina_id
JOIN planta p  ON p.planta_id = m.planta_id
JOIN empresa e ON e.empresa_id = p.empresa_id
WHERE ot.numero_ot LIKE 'REAL-%'
GROUP BY e.nombre
ORDER BY e.nombre;

-- Cobertura mensual: exactamente 24 meses por empresa si el histórico quedó completo.
SELECT e.nombre AS empresa,
       count(DISTINCT date_trunc('month', ot.fecha_creacion)) AS meses_con_ots,
       min(ot.fecha_creacion)::date AS desde,
       max(ot.fecha_creacion)::date AS hasta
FROM orden_trabajo ot
JOIN maquina m ON m.maquina_id = ot.maquina_id
JOIN planta p  ON p.planta_id = m.planta_id
JOIN empresa e ON e.empresa_id = p.empresa_id
WHERE ot.numero_ot LIKE 'REAL-%'
GROUP BY e.nombre
ORDER BY e.nombre;

-- Documentos, fragmentos, repuestos y programas del seed.
SELECT (SELECT count(*) FROM documento WHERE file_id LIKE 'seed-realista-%')       AS documentos,
       (SELECT count(*) FROM documento_chunk ch
          JOIN documento d ON d.documento_id = ch.documento_id
         WHERE d.file_id LIKE 'seed-realista-%')                                    AS chunks,
       (SELECT count(*) FROM repuesto WHERE codigo LIKE 'REP-%')                    AS repuestos,
       (SELECT count(*) FROM programa_mantenimiento WHERE nombre LIKE '%—%')        AS programas;
