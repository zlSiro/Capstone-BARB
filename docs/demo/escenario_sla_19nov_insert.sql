-- =============================================================================
-- Escenario demo · SLA del 19 de noviembre de 2026
-- =============================================================================
-- Inserta 6 OTs de Minera del Norte, TODAS creadas y cerradas el 2026-11-19:
--
--   DEMO-SLA19-1  BOM-001 (SLA 6 h)   08:00 → 11:30   EN SLA   (3 h 30)
--   DEMO-SLA19-2  CHA-001 (SLA 8 h)   10:00 → 15:00   EN SLA   (4 h 45)
--   DEMO-SLA19-3  MOL-001 (SLA 12 h)  09:00 → 23:30   FUERA    (14 h 15)
--   DEMO-SLA19-4  COR-001 (SLA 10 h)  07:00 → 12:00   EN SLA   (4 h 45)
--   DEMO-SLA19-5  BOM-001 (SLA 6 h)   13:00 → 16:30   EN SLA   (3 h 15)
--   DEMO-SLA19-6  CHA-001 (SLA 8 h)   14:30 → 19:15   EN SLA   (4 h 30)
--
-- Efecto esperado en la gráfica de SLA (rango "all", granularidad mes):
--   el punto de noviembre pasa a total_ots = 14, completadas = 6 y sla = 83.3 %
--   (5 de 6 dentro de plazo). Con 3 OTs el denominador era demasiado chico (66.7 %).
--
-- Por qué existe: el seed ancla sus fechas a CURRENT_DATE en el momento en que se
-- ejecutó (14-nov en esta base), así que no hay actividad después de esa fecha y el
-- gráfico no tiene punto para el 19. Estas filas son SOLO para la demo y se borran
-- con `escenario_sla_19nov_delete.sql`.
--
-- Cómo se aplica (desde la raíz del repo):
--   docker exec -i barb_capstone_postgres psql -U barb_admin -d barb_database ^
--     -v ON_ERROR_STOP=1 < docs\demo\escenario_sla_19nov_insert.sql
--
-- NOTA sobre los triggers: igual que el seed, se desactivan los triggers de usuario
-- (auditoría y transacciones) para estas filas. Las claves foráneas siguen activas.
-- =============================================================================

BEGIN;

ALTER TABLE orden_trabajo DISABLE TRIGGER USER;

INSERT INTO orden_trabajo (
    numero_ot, maquina_id, tecnico_id, creado_por, tipo,
    descripcion_problema, descripcion_reparacion, resolution,
    priority, severity,
    fecha_creacion, fecha_inicio, fecha_cierre, fecha_vencimiento,
    tiempo_reparacion_min, downtime_minutes, costo_estimado, costo_real, estado
)
SELECT
    v.numero_ot, m.maquina_id, v.tecnico_id, v.creado_por, v.tipo::tipo_mantenimiento,
    v.problema, v.reparacion, v.resolution,
    v.priority::prioridad_ot, v.severity::nivel_severidad,
    v.creacion, v.inicio,
    -- La única que rompe el plazo cierra 4 h pasado el vencimiento (MOL-001); el resto
    -- cierra antes. La lógica se deja explícita para que el escenario se lea solo.
    CASE WHEN v.fuera_de_sla
         THEN v.creacion + (m.sla_horas * INTERVAL '1 hour') + INTERVAL '4 hours'
         ELSE v.cierre
    END AS fecha_cierre,
    v.creacion + (m.sla_horas * INTERVAL '1 hour') AS fecha_vencimiento,
    (EXTRACT(EPOCH FROM (
        (CASE WHEN v.fuera_de_sla
              THEN v.creacion + (m.sla_horas * INTERVAL '1 hour') + INTERVAL '4 hours'
              ELSE v.cierre END) - v.inicio)) / 60)::int AS minutos,
    round((EXTRACT(EPOCH FROM (
        (CASE WHEN v.fuera_de_sla
              THEN v.creacion + (m.sla_horas * INTERVAL '1 hour') + INTERVAL '4 hours'
              ELSE v.cierre END) - v.inicio)) / 60) * 0.6)::int AS downtime,
    round((EXTRACT(EPOCH FROM (
        (CASE WHEN v.fuera_de_sla
              THEN v.creacion + (m.sla_horas * INTERVAL '1 hour') + INTERVAL '4 hours'
              ELSE v.cierre END) - v.inicio)) / 60) * 0.6 * m.costo_inactividad_minuto * 0.6, 2) AS costo_est,
    round((EXTRACT(EPOCH FROM (
        (CASE WHEN v.fuera_de_sla
              THEN v.creacion + (m.sla_horas * INTERVAL '1 hour') + INTERVAL '4 hours'
              ELSE v.cierre END) - v.inicio)) / 60) * 0.6 * m.costo_inactividad_minuto * 0.6, 2) AS costo_real,
    'completed'::estado_ot
FROM (VALUES
    ('DEMO-SLA19-1', 'BOM-001', 4, 7, 'corrective',
     'Fuga en el sello mecánico de la bomba de pulpa: caída de presión en la descarga.',
     'Se reemplazó el sello mecánico y se verificó la curva de la bomba.',
     'Quedó sin fuga y con la presión de descarga en el valor de placa.',
     'high', 'high',
     TIMESTAMP '2026-11-19 08:00:00', TIMESTAMP '2026-11-19 08:15:00', TIMESTAMP '2026-11-19 11:30:00', false),

    ('DEMO-SLA19-2', 'CHA-001', 5, 7, 'preventive',
     'Mantención preventiva por horómetro del chancador de cono.',
     'Se revisó el setting, el desgaste del manto y el sistema hidráulico.',
     'Equipo inspeccionado y ajustado según el manual Sandvik.',
     'medium', 'medium',
     TIMESTAMP '2026-11-19 10:00:00', TIMESTAMP '2026-11-19 10:15:00', TIMESTAMP '2026-11-19 15:00:00', false),

    ('DEMO-SLA19-3', 'MOL-001', 6, 7, 'corrective',
     'Vibración y ruido en el accionamiento del molino SAG; se detuvo la molienda.',
     'Se desmontó la chumacera, se cambió el rodamiento y se realineó el acoplamiento.',
     'El molino volvió a operar, pero la reparación excedió el plazo comprometido.',
     'urgent', 'critical',
     TIMESTAMP '2026-11-19 09:00:00', TIMESTAMP '2026-11-19 09:15:00', TIMESTAMP '2026-11-19 23:30:00', true),

    ('DEMO-SLA19-4', 'COR-001', 4, 7, 'corrective',
     'Desalineación de la correa transportadora: se salía del tambor de cola.',
     'Se corrigió la tensión y se alineó el tambor de cola.',
     'La correa volvió a centrar sin desviarse.',
     'high', 'high',
     TIMESTAMP '2026-11-19 07:00:00', TIMESTAMP '2026-11-19 07:20:00', TIMESTAMP '2026-11-19 12:00:00', false),

    ('DEMO-SLA19-5', 'BOM-001', 5, 7, 'preventive',
     'Cambio de rodamientos programado en la bomba de pulpa.',
     'Se cambiaron los rodamientos y se verificó la alineación con el motor.',
     'Equipo operativo dentro del horómetro planificado.',
     'medium', 'medium',
     TIMESTAMP '2026-11-19 13:00:00', TIMESTAMP '2026-11-19 13:15:00', TIMESTAMP '2026-11-19 16:30:00', false),

    ('DEMO-SLA19-6', 'CHA-001', 6, 7, 'inspection',
     'Inspección visual del manto y las cóncavas del chancador.',
     'Se midió el desgaste del manto y se revisó la granulometría de salida.',
     'Manto dentro de tolerancia; se reprograma la inspección.',
     'low', 'low',
     TIMESTAMP '2026-11-19 14:30:00', TIMESTAMP '2026-11-19 14:45:00', TIMESTAMP '2026-11-19 19:15:00', false)
) AS v(numero_ot, codigo, tecnico_id, creado_por, tipo,
       problema, reparacion, resolution, priority, severity,
       creacion, inicio, cierre, fuera_de_sla)
JOIN maquina m ON m.codigo = v.codigo
WHERE NOT EXISTS (
    SELECT 1 FROM orden_trabajo ot WHERE ot.numero_ot = v.numero_ot
);

-- La inspección no detiene la planta: su inactividad es 0 (misma regla que el seed).
UPDATE orden_trabajo
   SET downtime_minutes = 0
 WHERE numero_ot LIKE 'DEMO-SLA19-%'
   AND tipo = 'inspection';

ALTER TABLE orden_trabajo ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- Verificación: las 6 filas con su cumplimiento
-- ---------------------------------------------------------------------------
SELECT
    ot.numero_ot,
    m.codigo AS maquina,
    to_char(ot.fecha_creacion, 'HH24:MI') AS creada,
    to_char(ot.fecha_vencimiento, 'HH24:MI') AS vence,
    to_char(ot.fecha_cierre, 'HH24:MI') AS cerrada,
    CASE WHEN ot.fecha_cierre <= ot.fecha_vencimiento THEN 'EN SLA' ELSE 'FUERA DE SLA' END AS cumplimiento,
    ot.tiempo_reparacion_min AS reparacion_min,
    ot.downtime_minutes,
    ot.costo_real
FROM orden_trabajo ot
JOIN maquina m ON m.maquina_id = ot.maquina_id
WHERE ot.numero_ot LIKE 'DEMO-SLA19-%'
ORDER BY ot.numero_ot;

-- Y el agregado del día, que es lo que va a mostrar la gráfica:
SELECT
    COUNT(*) AS completadas,
    COUNT(*) FILTER (WHERE fecha_cierre <= fecha_vencimiento) AS en_sla,
    ROUND(100.0 * COUNT(*) FILTER (WHERE fecha_cierre <= fecha_vencimiento) / COUNT(*), 1) AS sla_pct
FROM orden_trabajo
WHERE numero_ot LIKE 'DEMO-SLA19-%';

COMMIT;
