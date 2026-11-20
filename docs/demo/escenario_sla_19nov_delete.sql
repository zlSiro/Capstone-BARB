-- =============================================================================
-- Limpieza del escenario demo · SLA del 19 de noviembre
-- =============================================================================
-- Borra EXACTAMENTE las 3 OTs que crea `escenario_sla_19nov_insert.sql`.
-- No toca ninguna OT del seed: todas las del seed empiezan con 'REAL-'.
--
-- Cómo se aplica (desde la raíz del repo):
--   docker exec -i barb_capstone_postgres psql -U barb_admin -d barb_database ^
--     -v ON_ERROR_STOP=1 < docs\demo\escenario_sla_19nov_delete.sql
--
-- Si en la demo se usaron esos registros para generar repuestos, bitácora o fotos,
-- también se limpian (hoy no los crea el escenario, pero la limpieza queda completa).
-- =============================================================================

BEGIN;

ALTER TABLE orden_trabajo DISABLE TRIGGER USER;

DELETE FROM ot_foto      WHERE ot_id IN (SELECT ot_id FROM orden_trabajo WHERE numero_ot LIKE 'DEMO-SLA19-%');
DELETE FROM ot_repuesto  WHERE ot_id IN (SELECT ot_id FROM orden_trabajo WHERE numero_ot LIKE 'DEMO-SLA19-%');
DELETE FROM ot_audit_log WHERE ot_id IN (SELECT ot_id FROM orden_trabajo WHERE numero_ot LIKE 'DEMO-SLA19-%');

DELETE FROM orden_trabajo WHERE numero_ot LIKE 'DEMO-SLA19-%';

ALTER TABLE orden_trabajo ENABLE TRIGGER USER;

-- Verificación: debe dar 0, y las OTs del seed tienen que seguir intactas.
SELECT
    (SELECT COUNT(*) FROM orden_trabajo WHERE numero_ot LIKE 'DEMO-SLA19-%')     AS quedan_demo,
    (SELECT COUNT(*) FROM orden_trabajo WHERE numero_ot LIKE 'REAL-%')           AS seed_real,
    (SELECT COUNT(*) FROM orden_trabajo)                                         AS total;

COMMIT;
