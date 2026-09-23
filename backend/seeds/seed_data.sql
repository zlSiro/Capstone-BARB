-- Empresa demo: cliente base para todos los datos de ejemplo.
INSERT INTO EMPRESA (nombre, rut, pais, industria, contacto_nombre, contacto_email, plan, estado, max_usuarios, max_plantas, licencia_inicio, licencia_fin) VALUES
('Planta Demo BARB', '76.000.001-K', 'Chile', 'Manufactura', 'Administrador BARB', 'admin@barb.com', 'professional', 'active', 50, 5, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year'),
('Minera Norte S.A.', '76.000.002-1', 'Chile', 'Minería', 'Juan Pérez', 'jperez@mineranorte.cl', 'enterprise', 'active', 100, 10, CURRENT_DATE, CURRENT_DATE + INTERVAL '2 years'),
('Demo Trial Corp', NULL, 'Chile', 'Manufactura', NULL, NULL, 'trial', 'demo', 5, 1, CURRENT_DATE, CURRENT_DATE + INTERVAL '14 days');

-- Plantas
INSERT INTO PLANTA (empresa_id, nombre, ubicacion) VALUES
(1, 'Planta Central San Bernardo', 'San Bernardo, Región Metropolitana, Chile'),
(1, 'Planta Norte Antofagasta', 'Antofagasta, Chile'),
(1, 'Planta Sur Concepción', 'Concepción, Chile');

-- Usuarios (12 usuarios)
INSERT INTO USUARIO (empresa_id, nombre, email, password_hash, rol) VALUES
(1, 'Administrador BARB',     'admin@barb.com',         'admin123',    'admin'),
(1, 'Director Mantenimiento', 'gerente1@planta.com',    'gerente123',  'gerente'),
(1, 'Subgerente Operaciones', 'gerente2@planta.com',    'gerente123',  'gerente'),
(1, 'Carlos Mendoza',         'carlos@planta.com',      'tecnico123',  'tecnico'),
(1, 'Ana Silva',              'ana@planta.com',         'tecnico123',  'tecnico'),
(1, 'Roberto Tapia',          'roberto@planta.com',     'tecnico123',  'tecnico'),
(1, 'Luisa Martínez',         'luisa@planta.com',       'tecnico123',  'tecnico'),
(1, 'Jorge Soto',             'jorge@planta.com',       'tecnico123',  'tecnico'),
(1, 'Ingeniero de Procesos',  'engineer1@planta.com',   'engineer123', 'engineer'),
(1, 'Supervisor Turno A',     'supervisor1@planta.com', 'super123',    'supervisor'),
(1, 'Operador Molino',        'operador1@planta.com',   'operador123', 'operador'),
(1, 'Operador Grúa',          'operador2@planta.com',   'operador123', 'operador');

-- Disciplinas (10 disciplinas)
INSERT INTO DISCIPLINA (empresa_id, nombre, color) VALUES
(1, 'Mecánica',        'blue'),
(1, 'Eléctrica',       'yellow'),
(1, 'Hidráulica',      'cyan'),
(1, 'Neumática',       'purple'),
(1, 'Automatización',  'green'),
(1, 'Estructural',     'gray'),
(1, 'HVAC',            'orange'),
(1, 'Instrumentación', 'teal'),
(1, 'Lubricación',     'indigo'),
(1, 'Robótica',        'pink');

-- Máquinas (12 máquinas)
INSERT INTO MAQUINA (planta_id, disciplina_id, nombre, codigo) VALUES
(1, 1, 'Compressor A1', 'COMP-A1'),
(1, 2, 'Motor Drive D1', 'MOTOR-D1'),
(1, 3, 'Hydraulic Press B3', 'PRESS-B3'),
(1, 3, 'Pump E4', 'PUMP-E4'),
(1, 4, 'Compresor Neumático N2', 'COMP-N2'),
(1, 10, 'Brazo Robótico KUKA 1', 'ROB-K1'),
(1, 5, 'PLC Siemens S7 Principal', 'PLC-S7'),
(1, 1, 'Cinta Transportadora C1', 'CINT-C1'),
(1, 2, 'Generador de Respaldo G1', 'GEN-G1'),
(1, 3, 'Válvula de Presión V8', 'VALV-V8'),
(1, 7, 'Sistema Chiller Central', 'CHILL-01'),
(1, 8, 'Analizador de Gases', 'GAS-001');

-- Repuestos (12 repuestos)
INSERT INTO REPUESTO (empresa_id, codigo, part_number, nombre, descripcion, tipo, categoria, unidad, stock_actual, stock_minimo, costo_unitario, estado) VALUES
(1, 'REP-001', 'FIL-1029', 'Filtro Hidráulico',     'Filtro de 10 micrones',     'Consumible', 'Hidráulica',      'Unidad', 15,  5,  45.00,  'active'),
(1, 'REP-002', 'VAL-9921', 'Válvula Proporcional',  'Válvula 24V DC',            'Componente', 'Automatización',  'Unidad', 2,   1,  350.00, 'active'),
(1, 'REP-003', 'SENS-011', 'Sensor Vibración',      'Sensor piezoeléctrico',     'Sensor',     'Instrumentación', 'Unidad', 8,   3,  120.00, 'active'),
(1, 'REP-004', 'BELT-44',  'Correa Transmisión',    'Correa de caucho',          'Consumible', 'Mecánica',        'Unidad', 20,  10, 25.00,  'active'),
(1, 'REP-005', 'PLC-MOD',  'Módulo E/S PLC',        '16 entradas',               'Electrónica','Automatización',  'Unidad', 4,   2,  450.00, 'active'),
(1, 'REP-006', 'BRG-608',  'Rodamiento 608ZZ',      'Acero inox',                'Consumible', 'Mecánica',        'Unidad', 50,  20, 5.00,   'active'),
(1, 'REP-007', 'LUB-001',  'Aceite Sintético',      'Tambor 20L',                'Consumible', 'Lubricación',     'Litro',  100, 40, 12.00,  'active'),
(1, 'REP-008', 'FUS-10A',  'Fusible 10A',           'Cerámico',                  'Consumible', 'Eléctrica',       'Unidad', 200, 50, 1.50,   'active'),
(1, 'REP-009', 'MOT-3HP',  'Motor 3HP',             'Trifásico',                 'Componente', 'Eléctrica',       'Unidad', 3,   1,  600.00, 'active'),
(1, 'REP-010', 'CYL-PN',   'Cilindro Neumático',    'Doble efecto',              'Componente', 'Neumática',       'Unidad', 5,   2,  180.00, 'active'),
(1, 'REP-011', 'TER-01',   'Termocupla Tipo K',     'Alta temp',                 'Sensor',     'Instrumentación', 'Unidad', 12,  5,  35.00,  'active'),
(1, 'REP-012', 'BOM-AG',   'Bomba Centrífuga',      'Acero Inox',                'Componente', 'Hidráulica',      'Unidad', 2,   1,  850.00, 'active');

-- Sensores (10 sensores)
INSERT INTO SENSOR (maquina_id, nombre, codigo) VALUES
(1, 'Temp. Compresor', 'ST-COMP1'),
(1, 'Presión Salida', 'SP-COMP1'),
(3, 'Nivel Aceite Prensa', 'SL-PRESS3'),
(3, 'Vibración Cilindro', 'SV-PRESS3'),
(2, 'Temp. Motor D1', 'ST-MOT1'),
(6, 'Encoder Eje X', 'SE-ROB1'),
(7, 'Temp. Procesador PLC', 'ST-PLC1'),
(8, 'Velocidad Cinta', 'SS-CINT1'),
(9, 'Voltaje Generador', 'SV-GEN1'),
(11, 'Flujo Chiller', 'SF-CHILL1');

-- Lecturas de Sensores (20 lecturas)
INSERT INTO LECTURA_SENSOR (sensor_id, valor, estado) VALUES
(1, 85.5, 'normal'), (1, 86.1, 'normal'), (1, 95.0, 'warning'), (1, 105.0, 'critical'),
(2, 120.4, 'normal'), (2, 118.9, 'normal'),
(3, 45.2, 'warning'), (3, 40.1, 'critical'),
(4, 2.3, 'normal'), (4, 4.8, 'critical'),
(5, 60.0, 'normal'), (5, 62.5, 'normal'),
(6, 1500.0, 'normal'), (6, 1495.0, 'normal'),
(7, 45.0, 'normal'), (7, 46.5, 'normal'),
(8, 5.0, 'normal'), (8, 0.0, 'critical'),
(9, 220.0, 'normal'), (10, 50.0, 'normal');

-- Topología: Zonas (10 zonas)
INSERT INTO TOPOLOGIA_ZONA (planta_id, nombre, color, descripcion) VALUES
(1, 'Zona de Control', '#3b82f6', 'Gabinete eléctrico principal'),
(1, 'Zona de Potencia y Motores', '#ef4444', 'Servomotores X,Y,Z'),
(1, 'Zona de Fluidos', '#06b6d4', 'Refrigeración'),
(1, 'Zona de Prensado', '#f59e0b', 'Prensas y troqueladoras'),
(1, 'Línea de Empaque', '#10b981', 'Robótica final'),
(1, 'Cuarto de Compresores', '#8b5cf6', 'Aire comprimido'),
(1, 'Subestación Eléctrica', '#f97316', 'Energía y respaldo'),
(1, 'Laboratorio Calidad', '#14b8a6', 'Análisis gases'),
(1, 'Zona de Soldadura', '#ec4899', 'Robots soldadores'),
(1, 'Bodega de Materia Prima', '#64748b', 'Almacenamiento');

-- Topología: Nodos (12 nodos mezclando máquinas y hubs)
INSERT INTO TOPOLOGIA_NODO (planta_id, maquina_id, tipo, nombre, categoria, position_x, position_y, estado) VALUES
(1, NULL, 'hub', 'HMI Panel Control', 'Control', 100, 250, 'operational'),
(1, 7, 'controller', 'PLC Siemens S7', 'Control', 250, 250, 'operational'),
(1, NULL, 'controller', 'Variador Frecuencia', 'Potencia', 400, 100, 'operational'),
(1, 2, 'machine', 'Motor Husillo', 'Motriz', 550, 100, 'operational'),
(1, NULL, 'controller', 'Servo Driver X', 'Potencia', 400, 220, 'operational'),
(1, 6, 'machine', 'Brazo Robótico X', 'Robótica', 550, 220, 'warning'),
(1, 3, 'machine', 'Prensa Hidráulica', 'Prensado', 700, 220, 'error'),
(1, 4, 'machine', 'Bomba Refrigerante', 'Fluidos', 400, 460, 'operational'),
(1, 1, 'machine', 'Compresor Aire', 'Neumática', 250, 460, 'warning'),
(1, NULL, 'sensor', 'Sensor Flujo Main', 'Instrumentación', 100, 460, 'operational'),
(1, 8, 'machine', 'Cinta Transportadora', 'Logística', 850, 220, 'operational'),
(1, 9, 'machine', 'Generador', 'Eléctrica', 250, 600, 'operational');

-- Topología: Conexiones (15 conexiones)
INSERT INTO TOPOLOGIA_CONEXION (nodo_origen_id, nodo_destino_id, tipo, label, bidirectional) VALUES
(1, 2, 'data', 'Control Ethernet', true),
(2, 3, 'data', 'Modbus RTU', true),
(3, 4, 'electrical', 'Potencia 380V', false),
(2, 5, 'data', 'Profibus', true),
(5, 6, 'electrical', 'Potencia y Feedback', true),
(6, 7, 'mechanical', 'Fuerza de prensado', false),
(2, 8, 'electrical', 'Relé 24V', false),
(8, 7, 'hydraulic', 'Línea de aceite', false),
(9, 7, 'pneumatic', 'Línea de aire', false),
(10, 2, 'data', 'Señal 4-20mA', false),
(6, 11, 'mechanical', 'Transferencia piezas', false),
(2, 11, 'data', 'Control VDF Cinta', true),
(12, 2, 'electrical', 'Respaldo UPS', false),
(12, 1, 'electrical', 'Respaldo UPS', false),
(12, 3, 'electrical', 'Respaldo UPS', false);

-- Órdenes de Trabajo (20 OTs para gráficas completas)
INSERT INTO ORDEN_TRABAJO (numero_ot, maquina_id, tecnico_id, creado_por, tipo, descripcion_problema, descripcion_reparacion, priority, severity, fecha_creacion, fecha_inicio, fecha_cierre, tiempo_reparacion_min, costo_estimado, costo_real, estado) VALUES
('OT-2026-001', 1, 4, 2, 'preventive', 'Mant. preventivo', 'Cambio filtros', 'low', 'low', '2026-05-10 08:00:00', '2026-05-10 08:30:00', '2026-05-10 10:30:00', 120, 150.00, 145.00, 'completed'),
('OT-2026-002', 3, 4, 2, 'corrective', 'Fuga hidráulica', 'Reemplazo manguera', 'urgent', 'critical', '2026-05-11 14:15:00', '2026-05-11 14:20:00', '2026-05-11 15:05:00', 45, 500.00, 620.00, 'completed'),
('OT-2026-003', 2, 5, 2, 'inspection', 'Ruido anómalo', NULL, 'low', 'medium', '2026-05-17 09:00:00', NULL, NULL, NULL, 50.00, NULL, 'pending'),
('OT-2026-004', 4, 6, 2, 'predictive', 'Alerta vibración', 'Alineación', 'high', 'high', '2026-05-18 10:00:00', '2026-05-18 10:30:00', NULL, NULL, 300.00, NULL, 'in_progress'),
('OT-2026-005', 1, 4, 2, 'corrective', 'Falla eléctrica', 'Botón atascado', 'medium', 'low', '2026-05-12 11:00:00', '2026-05-12 11:10:00', '2026-05-12 11:15:00', 5, 0.00, 0.00, 'cancelled'),
('OT-2026-006', 2, 5, 2, 'preventive', 'Calibración', NULL, 'medium', 'medium', '2026-05-01 08:00:00', NULL, NULL, NULL, 100.00, NULL, 'overdue'),
('OT-2026-007', 3, 4, 2, 'corrective', 'Error E-041', 'Reset válvula', 'high', 'high', '2026-05-15 16:00:00', '2026-05-15 16:05:00', '2026-05-15 16:35:00', 30, 0.00, 15.00, 'completed'),
('OT-2026-008', 4, 6, 2, 'inspection', 'Revisión aceite', NULL, 'low', 'low', '2026-05-18 07:00:00', NULL, NULL, NULL, 30.00, NULL, 'assigned'),
('OT-2026-009', 8, 5, 2, 'corrective', 'Corte banda', 'Empalme térmico', 'urgent', 'critical', '2026-05-14 02:00:00', '2026-05-14 02:15:00', '2026-05-14 06:15:00', 240, 1200.00, 1450.00, 'completed'),
('OT-2026-010', 7, 4, 2, 'predictive', 'Punto caliente', 'Reapriete', 'medium', 'medium', '2026-05-16 09:00:00', '2026-05-16 09:30:00', '2026-05-16 10:15:00', 45, 80.00, 45.00, 'completed'),
('OT-2026-011', 5, 6, 2, 'corrective', 'Fuga manguera', 'Cambio manguera', 'high', 'high', '2026-05-19 14:00:00', '2026-05-19 14:15:00', '2026-05-19 15:30:00', 75, 120.00, 95.00, 'completed'),
('OT-2026-012', 6, 5, 2, 'predictive', 'Anomalía encoder', 'Recalibración', 'medium', 'medium', '2026-05-20 09:30:00', '2026-05-20 10:00:00', '2026-05-20 10:45:00', 45, 0.00, 0.00, 'completed'),
('OT-2026-013', 7, 4, 2, 'preventive', 'Update firmware', 'Flasheo', 'low', 'low', '2026-05-21 23:00:00', '2026-05-21 23:15:00', '2026-05-22 00:15:00', 60, 0.00, 0.00, 'completed'),
('OT-2026-014', 8, 6, 2, 'corrective', 'Cinta atascada', 'Ajuste tensores', 'urgent', 'critical', '2026-05-22 11:00:00', '2026-05-22 11:05:00', '2026-05-22 12:45:00', 100, 200.00, 250.00, 'completed'),
('OT-2026-015', 9, 5, 2, 'inspection', 'Prueba carga', NULL, 'medium', 'medium', '2026-05-23 08:00:00', NULL, NULL, NULL, 50.00, NULL, 'assigned'),
('OT-2026-016', 10, 4, 2, 'corrective', 'Válvula no cierra', 'Cambio sellos', 'high', 'high', '2026-05-24 15:30:00', '2026-05-24 16:00:00', '2026-05-24 17:15:00', 75, 80.00, 90.00, 'completed'),
('OT-2026-017', 3, 6, 2, 'corrective', 'Ruido extremo', 'Cambio guías', 'urgent', 'critical', '2026-05-25 10:00:00', '2026-05-25 10:15:00', '2026-05-25 13:30:00', 195, 450.00, 500.00, 'completed'),
('OT-2026-018', 1, 5, 2, 'predictive', 'Termografía ALTA', NULL, 'medium', 'medium', '2026-05-26 09:00:00', '2026-05-26 09:30:00', NULL, NULL, 150.00, NULL, 'in_progress'),
('OT-2026-019', 2, 4, 2, 'preventive', 'Lubricación', 'Engrase', 'low', 'low', '2026-05-26 14:00:00', '2026-05-26 14:30:00', '2026-05-26 15:00:00', 30, 25.00, 20.00, 'completed'),
('OT-2026-020', 4, 6, 2, 'corrective', 'Falla rodamientos', NULL, 'high', 'critical', '2026-05-27 08:00:00', NULL, NULL, NULL, 600.00, NULL, 'pending');

-- OT Repuestos (15 items)
INSERT INTO OT_REPUESTO (ot_id, repuesto_id, cantidad, costo_unitario) VALUES
(2, 1, 2, 45.00), (9, 4, 1, 25.00), (17, 2, 1, 350.00), (1, 1, 1, 45.00), (11, 10, 1, 180.00),
(14, 4, 2, 25.00), (16, 2, 1, 350.00), (19, 7, 5, 12.00), (4, 3, 1, 120.00), (7, 2, 1, 350.00);

-- Sesiones Debug y Diagnóstico de IA (10 sesiones)
INSERT INTO SESION_DEBUG (empresa_id, maquina_id, tecnico_id, titulo) VALUES
(1, 3, 4, 'Diagnóstico fuga hidráulica prensa'),
(1, 3, 6, 'Análisis vibración eje Z'),
(1, 1, 4, 'Revisión botón parada'),
(1, 8, 5, 'Inspección cinta transportadora'),
(1, 6, 5, 'Calibración encoder brazo robótico'),
(1, 7, 4, 'Revisión firmware PLC'),
(1, 10, 4, 'Prueba válvula presión'),
(1, 2, 5, 'Diagnóstico ruido motor'),
(1, 4, 6, 'Análisis rodamiento bomba'),
(1, 9, 5, 'Test carga generador');

INSERT INTO DIAGNOSTICO (sesion_id, descripcion, severidad) VALUES
(1, 'IA: Fuga detectada en manguera P2. Rápida caída de presión analizada.', 'critical'),
(2, 'IA: Vibración armónica sugiere desgaste en guías de bronce eje Z.', 'critical'),
(3, 'IA: Botón de parada atascado mecánicamente.', 'low'),
(4, 'IA: Sobrecarga del motor por tensor desalineado.', 'high'),
(5, 'IA: Fallo de encoder por suciedad en disco óptico.', 'medium'),
(6, 'IA: Firmware obsoleto causando reinicios aleatorios.', 'low'),
(7, 'IA: Sellos tóricos de la válvula degradados por temperatura.', 'high'),
(8, 'IA: Resonancia acústica normal, requiere lubricación estándar.', 'low'),
(9, 'IA: Falla catastrófica inminente en rodamiento principal.', 'critical'),
(10, 'IA: Ciclo de carga del generador requiere calibración de AVR.', 'medium');

-- Programas Preventivos (10 programas)
INSERT INTO PROGRAMA_MANTENIMIENTO (maquina_id, creado_por, nombre, frecuencia, intervalo_dias, priority, duracion_estimada_min, fecha_inicio) VALUES
(1, 2, 'Revisión Filtros', 'monthly', 30, 'medium', 45, '2026-01-01'),
(3, 2, 'Cambio Aceite', 'yearly', 365, 'high', 240, '2026-01-15'),
(6, 2, 'Calibración Brazo', 'quarterly', 90, 'high', 120, '2026-02-01'),
(7, 2, 'Respaldo PLC', 'monthly', 30, 'low', 30, '2026-01-10'),
(8, 2, 'Tensión Cintas', 'weekly', 7, 'medium', 60, '2026-01-05'),
(9, 2, 'Prueba Generador', 'monthly', 30, 'high', 120, '2026-01-20'),
(2, 2, 'Engrase Motores', 'quarterly', 90, 'medium', 90, '2026-03-01'),
(10, 2, 'Test Estanqueidad', 'yearly', 365, 'high', 180, '2026-04-01'),
(11, 2, 'Limpieza Chiller', 'quarterly', 90, 'medium', 200, '2026-02-15'),
(12, 2, 'Calibración Gases', 'monthly', 30, 'high', 60, '2026-01-02');

-- Reportes (10 reportes)
INSERT INTO REPORTE (report_number, sesion_id, diagnostico_id, maquina_id, tecnico_id, summary, issue_description, severity, estado) VALUES
('RPT-2026-001', 1, 1, 3, 4, 'Reemplazo manguera', 'Pérdida de presión', 'critical', 'approved'),
('RPT-2026-002', 2, 2, 3, 6, 'Cambio guías', 'Ruido extremo', 'critical', 'approved'),
('RPT-2026-003', 3, 3, 1, 4, 'Destrabe botón', 'No encendía', 'low', 'approved'),
('RPT-2026-004', 4, 4, 8, 5, 'Empalme térmico', 'Cinta cortada', 'critical', 'approved'),
('RPT-2026-005', 5, 5, 6, 5, 'Limpieza encoder', 'Perdía posición', 'medium', 'approved'),
('RPT-2026-006', 6, 6, 7, 4, 'Flasheo PLC', 'Reinicios', 'low', 'approved'),
('RPT-2026-007', 7, 7, 10, 4, 'Cambio sellos', 'No cerraba', 'high', 'approved'),
('RPT-2026-008', 8, 8, 2, 5, 'Lubricación 3', 'Ruido ligero', 'low', 'generated'),
('RPT-2026-009', 9, 9, 4, 6, 'Cambio rodamiento', 'Falla inminente', 'critical', 'draft'),
('RPT-2026-010', 10, 10, 9, 5, 'Ajuste AVR', 'Fluctuación', 'medium', 'draft');

-- Enlazando OTs a Reportes
UPDATE ORDEN_TRABAJO SET reporte_id = 1 WHERE numero_ot = 'OT-2026-002';
UPDATE ORDEN_TRABAJO SET reporte_id = 2 WHERE numero_ot = 'OT-2026-017';
UPDATE ORDEN_TRABAJO SET reporte_id = 3 WHERE numero_ot = 'OT-2026-005';
UPDATE ORDEN_TRABAJO SET reporte_id = 4 WHERE numero_ot = 'OT-2026-009';

-- OT Audit Log (10 logs de estados de OTs)
INSERT INTO OT_AUDIT_LOG (ot_id, usuario_id, estado_anterior, estado_nuevo, comentario) VALUES
(1, 2, NULL, 'pending', 'Creada por sistema'),
(1, 2, 'pending', 'assigned', 'Asignada a Ana'),
(1, 4, 'assigned', 'in_progress', 'Inicio trabajos'),
(1, 4, 'in_progress', 'completed', 'Fin trabajos'),
(2, 2, NULL, 'pending', 'Reporte falla'),
(2, 2, 'pending', 'assigned', 'Urgente para Ana'),
(2, 4, 'assigned', 'in_progress', 'Corte suministro hidráulico'),
(2, 4, 'in_progress', 'completed', 'Reparación exitosa'),
(5, 2, NULL, 'pending', 'Botón trabado'),
(5, 4, 'pending', 'cancelled', 'Cancelada, operario lo destrabó manualmente');

-- Chat Sessions — conversaciones guardadas desde DocChat (10 ejemplos)
INSERT INTO CHAT_SESSION (empresa_id, titulo, saved_by, usuario_id, discipline, plant_id, plant_name, machine_id, machine_name, active_manual, messages, metadata, saved_at) VALUES
(1, 'Diagnóstico fuga hidráulica prensa B3', 'Carlos Mendoza', 4,
 'Hidráulica', '1', 'Planta Central San Bernardo', '3', 'Hydraulic Press B3', NULL,
 '[{"role":"user","content":"La prensa B3 muestra una caída de presión de 50 bar en 30 segundos. ¿Cuál es el procedimiento?","timestamp":1748000000000},{"role":"assistant","content":"⚠️ Esto indica una fuga activa. Pasos: 1) Despresurizar el sistema. 2) Inspeccionar mangueras de alta presión. 3) Revisar sellos del cilindro principal.","timestamp":1748000010000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '5 days'),

(1, 'Procedimiento cambio rodamiento motor D1', 'Ana Silva', 5,
 'Mecánica', '1', 'Planta Central San Bernardo', '2', 'Motor Drive D1', 'manual_motor_d1.pdf',
 '[{"role":"user","content":"¿Cuál es el torque de apriete para el rodamiento FAG 6308 en el motor D1?","timestamp":1748100000000},{"role":"assistant","content":"Según el manual (p.47), el torque de apriete es 85 Nm. Use llave dinamométrica calibrada.","timestamp":1748100008000}]'::jsonb,
 '{"lang":"es","message_count":2,"ot_context":"OT-2026-003"}'::jsonb, NOW() - INTERVAL '4 days'),

(1, 'Calibración PLC Siemens S7 tras actualización', 'Carlos Mendoza', 4,
 'Automatización', '1', 'Planta Central San Bernardo', '7', 'PLC Siemens S7 Principal', NULL,
 '[{"role":"user","content":"Tras flashear el firmware el PLC muestra error E-041. ¿Cómo reseteo la configuración?","timestamp":1748200000000},{"role":"assistant","content":"Error E-041 = parámetro DB fuera de rango. Pasos: 1) STOP el PLC. 2) Restaurar DB desde respaldo. 3) START y verificar I/O.","timestamp":1748200012000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '3 days'),

(1, 'Análisis vibración brazo robótico KUKA', 'Roberto Tapia', 6,
 'Robótica', '1', 'Planta Central San Bernardo', '6', 'Brazo Robótico KUKA 1', NULL,
 '[{"role":"user","content":"El brazo KUKA muestra vibración en eje X a 800 RPM. ¿Es normal?","timestamp":1748300000000},{"role":"assistant","content":"No es normal para ese rango. Posibles causas: encoder sucio, juego en reductor, o desbalance. Recomiendo termografía y análisis espectral.","timestamp":1748300009000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '2 days'),

(1, 'Mantenimiento preventivo compresor A1', 'Ana Silva', 5,
 'Neumática', '1', 'Planta Central San Bernardo', '1', 'Compressor A1', 'manual_compresor.pdf',
 '[{"role":"user","content":"¿Qué incluye el mantenimiento mensual del compresor A1?","timestamp":1748400000000},{"role":"assistant","content":"Según manual p.23: 1) Cambio filtro de aire. 2) Verificar nivel aceite. 3) Drenar condensado. 4) Inspección visual correas. 5) Registro de presión de trabajo.","timestamp":1748400007000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '1 day'),

(1, 'Falla cinta transportadora C1', 'Jorge Soto', 8,
 'Mecánica', '1', 'Planta Central San Bernardo', '8', 'Cinta Transportadora C1', NULL,
 '[{"role":"user","content":"La cinta C1 se detuvo con alarma de sobrecarga. ¿Qué reviso primero?","timestamp":1748500000000},{"role":"assistant","content":"⚠️ Secuencia: 1) Verificar que no haya material atascado. 2) Revisar tensión de banda. 3) Inspeccionar rodillos de retorno. 4) Medir corriente del motor con pinza amperimétrica.","timestamp":1748500011000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '12 hours'),

(1, 'Consulta repuestos válvula V8', 'Carlos Mendoza', 4,
 'Hidráulica', '1', 'Planta Central San Bernardo', '10', 'Válvula de Presión V8', NULL,
 '[{"role":"user","content":"¿Qué sellos necesito para la válvula V8 modelo Parker D3W020BNKF?","timestamp":1748600000000},{"role":"assistant","content":"Para Parker D3W020BNKF se requiere kit de sellos P/N 023768, incluye: 2x O-ring Viton 18x2.5 y 1x sello PTFE 22x3.","timestamp":1748600006000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '6 hours'),

(1, 'Inspección generador G1 carga parcial', 'Ana Silva', 5,
 'Eléctrica', '1', 'Planta Central San Bernardo', '9', 'Generador de Respaldo G1', 'manual_generador.pdf',
 '[{"role":"user","content":"El generador G1 no estabiliza la frecuencia en 50Hz bajo carga parcial. ¿Causa probable?","timestamp":1748700000000},{"role":"assistant","content":"Posibles causas: 1) Regulador AVR descalibrado. 2) Inyectores sucios. 3) Gobernador de velocidad con desgaste. Revisar en ese orden según manual p.88.","timestamp":1748700010000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '3 hours'),

(1, 'Consulta lubricación sistema chiller', 'Luisa Martínez', 7,
 'HVAC', '1', 'Planta Central San Bernardo', '11', 'Sistema Chiller Central', NULL,
 '[{"role":"user","content":"¿Cada cuánto se cambia el aceite del compresor en el chiller Carrier 30XA?","timestamp":1748800000000},{"role":"assistant","content":"Según Carrier, el aceite POE Suniso 3GS debe cambiarse cada 3000 horas de operación o 2 años, lo que ocurra primero. Verificar acidez con kit colorimétrico antes.","timestamp":1748800008000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '1 hour'),

(1, 'Diagnóstico analizador de gases sin señal', 'Roberto Tapia', 6,
 'Instrumentación', '1', 'Planta Central San Bernardo', '12', 'Analizador de Gases', 'manual_analizador.pdf',
 '[{"role":"user","content":"El analizador GAS-001 muestra señal 0mA en salida 4-20mA. ¿Loop abierto o falla interna?","timestamp":1748900000000},{"role":"assistant","content":"⚠️ Señal 0mA indica loop abierto o falla de alimentación. Verificar: 1) Tensión 24VDC en bornes. 2) Continuidad del cable. 3) Si alimentación OK, posible falla del transmisor interno.","timestamp":1748900009000}]'::jsonb,
 '{"lang":"es","message_count":2}'::jsonb, NOW() - INTERVAL '30 minutes');

-- System Audit Log — historial de acciones del sistema (15 registros ejemplo)
INSERT INTO SYSTEM_AUDIT_LOG (empresa_id, usuario_id, usuario_nombre, usuario_rol, accion, modulo, entidad_tipo, entidad_id, descripcion, exitoso, ip_address, endpoint) VALUES
(1, 2, 'Director Mantenimiento', 'gerente',  'login',           'Auth',     NULL,             NULL,   'Inicio de sesión exitoso',                          TRUE,  '192.168.1.10', '/api/auth/login'),
(1, 4, 'Carlos Mendoza',         'tecnico',  'login',           'Auth',     NULL,             NULL,   'Inicio de sesión exitoso',                          TRUE,  '192.168.1.21', '/api/auth/login'),
(1, 4, 'Carlos Mendoza',         'tecnico',  'create',          'OT',       'ORDEN_TRABAJO',  '1',    'Creó OT-2026-001 para Compressor A1',               TRUE,  '192.168.1.21', '/api/work-orders'),
(1, 4, 'Carlos Mendoza',         'tecnico',  'update',          'OT',       'ORDEN_TRABAJO',  '1',    'Cambió estado de pending a in_progress',            TRUE,  '192.168.1.21', '/api/work-orders/1'),
(1, 5, 'Ana Silva',              'tecnico',  'login',           'Auth',     NULL,             NULL,   'Inicio de sesión exitoso',                          TRUE,  '192.168.1.22', '/api/auth/login'),
(1, 5, 'Ana Silva',              'tecnico',  'chat_query',      'DocChat',  'CHAT_SESSION',   NULL,   'Consulta IA: diagnóstico prensa hidráulica',        TRUE,  '192.168.1.22', '/api/chat'),
(1, 5, 'Ana Silva',              'tecnico',  'chat_save',       'DocChat',  'CHAT_SESSION',   '1',    'Guardó sesión DocChat: Diagnóstico prensa B3',      TRUE,  '192.168.1.22', '/api/chat-sessions'),
(1, 6, 'Roberto Tapia',          'tecnico',  'upload',          'Reporte',  'REPORTE',        '1',    'Subió RPT-2026-001 al repositorio',                 TRUE,  '192.168.1.23', '/api/reports/1/upload'),
(1, 2, 'Director Mantenimiento', 'gerente',  'approve',         'Reporte',  'REPORTE',        '1',    'Aprobó reporte RPT-2026-001',                       TRUE,  '192.168.1.10', '/api/reports/1/approve'),
(1, 4, 'Carlos Mendoza',         'tecnico',  'report_generate', 'Reporte',  'REPORTE',        '2',    'Generó PDF para RPT-2026-002',                      TRUE,  '192.168.1.21', '/api/reports/2/generate'),
(1, 1, 'Administrador BARB',     'admin',    'create',          'Usuario',  'USUARIO',        '12',   'Creó usuario Operador Grúa',                        TRUE,  '192.168.1.1',  '/api/users'),
(1, 1, 'Administrador BARB',     'admin',    'update',          'Empresa',  'EMPRESA',        '1',    'Actualizó licencia empresa Planta Demo BARB',       TRUE,  '192.168.1.1',  '/api/companies/1'),
(1, 7, 'Luisa Martínez',         'tecnico',  'view',            'DocChat',  'CHAT_SESSION',   '9',    'Consultó sesión guardada: lubricación chiller',     TRUE,  '192.168.1.24', '/api/chat-sessions/9'),
(1, 4, 'Carlos Mendoza',         'tecnico',  'export',          'OT',       'ORDEN_TRABAJO',  NULL,   'Exportó listado de OTs a CSV',                      TRUE,  '192.168.1.21', '/api/work-orders/export'),
(1, 3, 'Subgerente Operaciones', 'gerente',  'login',           'Auth',     NULL,             NULL,   'Intento de login fallido — contraseña incorrecta', FALSE, '192.168.1.11', '/api/auth/login');
