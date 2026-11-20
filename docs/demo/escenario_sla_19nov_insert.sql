-- =============================================================================
-- Escenario demo · SLA del 19 de noviembre de 2026
-- =============================================================================
-- Inserta 3 OTs de Minera del Norte, TODAS creadas y cerradas el 2026-11-19:
--
--   DEMO-SLA19-1  BOM-001 (SLA 6 h)   cerrada a las 3 h 30  -> dentro de SLA
--   DEMO-SLA19-2  CHA-001 (SLA 8 h)   cerrada a las 4 h 45  -> dentro de SLA
--   DEMO-SLA19-3  MOL-001 (SLA 12 h)  cerrada a las 14 h 15 -> fuera de SLA
--
-- Efecto esperado en la gráfica de SLA (rango "7 días", granularidad día):
--   el punto del 19 pasa a tener total_ots = 3, completadas = 3 y sla = 66.7 %
--   (2 de 3 dentro de plazo).
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
-- (auditoría y transacciones) para estas 3 filas. Las claves foráneas siguen activas.
-- =============================================================================

BEGIN;

ALTER TABLE orden_trabajo DISABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- 1 y 2: cerradas DENTRO del SLA (fecha_cierre <= fecha_vencimiento)
-- ---------------------------------------------------------------------------
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
    v.creacion, v.inicio, v.cierre, v.creacion + (m.sla_horas * INTERVAL '1 hour'),
    (EXTRACT(EPOCH FROM (v.cierre - v.inicio)) / 60)::int,
    round((EXTRACT(EPOCH FROM (v.cierre - v.inicio)) / 60) * 0.6)::int,
    round((EXTRACT(EPOCH FROM (v.cierre - v.inicio)) / 60) * 0.6 * m.costo_inactividad_minuto * 0.6, 2),
    round((EXTRACT(EPOCH FROM (v.cierre - v.inicio)) / 60) * 0.6 * m.costo_inactividad_minuto * 0.6, 2),
    'completed'::estado_ot
FROM (VALUES
    ('DEMO-SLA19-1', 'BOM-001', 4, 7, 'corrective',
     'Fuga en el sello mecánico de la bomba de pulpa: caída de presión en la descarga.',
     'Se reemplazó el sello mecánico y se verificó la curva de la bomba.',
     'Quedó sin fuga y con la presión de descarga en el valor de placa.',
     'high', 'high',
     TIMESTAMP '2026-11-19 08:00:00', TIMESTAMP '2026-11-19 08:15:00', TIMESTAMP '2026-11-19 11:30:00'),

    ('DEMO-SLA19-2', 'CHA-001', 5, 7, 'preventive',
     'Mantención preventiva por horómetro del chancador de cono.',
     'Se revisó el setting, el desgaste del manto y el sistema hidráulico.',
     'Equipo inspeccionado y ajustado según el manual Sandvik.',
     'medium', 'medium',
     TIMESTAMP '2026-11-19 10:00:00', TIMESTAMP '2026-11-19 10:15:00', TIMESTAMP '2026-11-19 15:00:00')
) AS v(numero_ot, codigo, tecnico_id, creado_por, tipo,
       problema, reparacion, resolution, priority, severity,
       creacion, inicio, cierre)
JOIN maquina m ON m.codigo = v.codigo
WHERE NOT EXISTS (
    SELECT 1 FROM orden_trabajo ot WHERE ot.numero_ot = v.numero_ot
);

-- ---------------------------------------------------------------------------
-- 3: cerrada FUERA del SLA (fecha_cierre > fecha_vencimiento)
--    MOL-001 tiene SLA de 12 h: cerró a las 14 h 15 del inicio.
-- ---------------------------------------------------------------------------
INSERT INTO orden_trabajo (
    numero_ot, maquina_id, tecnico_id, creado_por, tipo,
    descripcion_problema, descripcion_reparacion, resolution,
    priority, severity,
    fecha_creacion, fecha_inicio, fecha_cierre, fecha_vencimiento,
    tiempo_reparacion_min, downtime_minutes, costo_estimado, costo_real, estado
)
SELECT
    'DEMO-SLA19-3', m.maquina_id, 6, 7, 'corrective'::tipo_mantenimiento,
    'Vibración y ruido en el accionamiento del molino SAG; se detuvo la molienda.',
    'Se desmontó la chumacera, se cambió el rodamiento y se realineó el acoplamiento.',
    'El molino volvió a operar, pero la reparación excedió el plazo comprometido.',
    'urgent'::prioridad_ot, 'critical'::nivel_severidad,
    TIMESTAMP '2026-11-19 09:00:00',
    TIMESTAMP '2026-11-19 09:15:00',
    TIMESTAMP '2026-11-19 23:30:00',
    TIMESTAMP '2026-11-19 09:00:00' + (m.sla_horas * INTERVAL '1 hour'),
    (EXTRACT(EPOCH FROM (TIMESTAMP '2026-11-19 23:30:00' - TIMESTAMP '2026-11-19 09:15:00')) / 60)::int,
    round((EXTRACT(EPOCH FROM (TIMESTAMP '2026-11-19 23:30:00' - TIMESTAMP '2026-11-19 09:15:00')) / 60) * 0.6)::int,
    round((EXTRACT(EPOCH FROM (TIMESTAMP '2026-11-19 23:30:00' - TIMESTAMP '2026-11-19 09:15:00')) / 60) * 0.6 * m.costo_inactividad_minuto * 0.6, 2),
    round((EXTRACT(EPOCH FROM (TIMESTAMP '2026-11-19 23:30:00' - TIMESTAMP '2026-11-19 09:15:00')) / 60) * 0.6 * m.costo_inactividad_minuto * 0.6, 2),
    'completed'::estado_ot
FROM maquina m
WHERE m.codigo = 'MOL-001'
  AND NOT EXISTS (SELECT 1 FROM orden_trabajo ot WHERE ot.numero_ot = 'DEMO-SLA19-3');

ALTER TABLE orden_trabajo ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- Verificación: las 3 filas con su cumplimiento
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

COMMIT;
