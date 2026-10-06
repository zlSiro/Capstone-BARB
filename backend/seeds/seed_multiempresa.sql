-- =============================================================================
-- DATOS FICTICIOS MULTI-EMPRESA (complementa seed_data.sql; requiere migración 0004)
-- =============================================================================
-- Lo aplica `scripts/seed.py` una sola vez (si no existe super@barb.com).
-- Las contraseñas se insertan en texto plano a propósito: seed.py las convierte
-- a bcrypt al final (_ensure_passwords_hashed). Solo para desarrollo/demo.
--
-- Credenciales de prueba (todas ficticias):
--   super_usuario      super@barb.com               / super123      (sin empresa, ve todo)
--   admin  empresa 1   admin@barb.com               / admin123      (Planta Demo BARB)
--   engineer empresa 1 engineer1@planta.com         / engineer123   (puede subir documentos)
--   visitante empresa 1 visitante@planta.com        / visitante123
--   admin  empresa 2   admin@mineranorte.cl         / minera123     (Minera Norte S.A.)
--   gerente empresa 2  gerente@mineranorte.cl       / minera123
--   tecnico empresa 2  pedro@mineranorte.cl         / minera123
--   admin  empresa 3   admin@trialcorp.cl           / trial123      (Demo Trial Corp)
--   admin  empresa 4   admin@constructorasur.cl     / sur12345      (SUSPENDIDA: no puede entrar)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------------
INSERT INTO empresa (nombre, rut, pais, industria, contacto_nombre, contacto_email, plan, estado, max_usuarios, max_plantas, licencia_inicio, licencia_fin)
VALUES ('Constructora Sur Ltda.', '76.000.004-8', 'Chile', 'Construcción', 'María Fuentes', 'mfuentes@constructorasur.cl',
        'starter', 'suspended', 10, 1, CURRENT_DATE - INTERVAL '1 year', CURRENT_DATE - INTERVAL '1 day');

-- ---------------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------------
-- Super usuario: empresa_id NULL (permitido solo para este rol por ck_usuario_empresa_rol).
INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
VALUES (NULL, 'Super Usuario BARB', 'super@barb.com', 'super123', 'super_usuario');

-- Empresa 1 (Planta Demo BARB): usuario visitante para probar el modo solo lectura.
INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
SELECT empresa_id, 'Visita Auditoría', 'visitante@planta.com', 'visitante123', 'visitante'
FROM empresa WHERE nombre = 'Planta Demo BARB';

-- Empresa 2 (Minera Norte S.A.)
INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
SELECT e.empresa_id, v.nombre, v.email, v.pw, v.rol
FROM empresa e,
     (VALUES
        ('Juan Pérez',        'admin@mineranorte.cl',      'minera123', 'admin'),
        ('Camila Rojas',      'gerente@mineranorte.cl',    'minera123', 'gerente'),
        ('Diego Fuentes',     'supervisor@mineranorte.cl', 'minera123', 'supervisor'),
        ('Valentina Castro',  'engineer@mineranorte.cl',   'minera123', 'engineer'),
        ('Pedro Alarcón',     'pedro@mineranorte.cl',      'minera123', 'tecnico'),
        ('Marta Vidal',       'marta@mineranorte.cl',      'minera123', 'tecnico'),
        ('Luis Navarro',      'operador@mineranorte.cl',   'minera123', 'operador')
     ) AS v(nombre, email, pw, rol)
WHERE e.nombre = 'Minera Norte S.A.';

-- Empresa 3 (Demo Trial Corp)
INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
SELECT e.empresa_id, v.nombre, v.email, v.pw, v.rol
FROM empresa e,
     (VALUES
        ('Admin Trial',    'admin@trialcorp.cl',   'trial123', 'admin'),
        ('Tomás Herrera',  'tomas@trialcorp.cl',   'trial123', 'tecnico')
     ) AS v(nombre, email, pw, rol)
WHERE e.nombre = 'Demo Trial Corp';

-- Empresa 4 (suspendida)
INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
SELECT empresa_id, 'Admin Constructora Sur', 'admin@constructorasur.cl', 'sur12345', 'admin'
FROM empresa WHERE nombre = 'Constructora Sur Ltda.';

-- ---------------------------------------------------------------------------
-- Plantas, disciplinas y máquinas
-- ---------------------------------------------------------------------------
INSERT INTO planta (empresa_id, nombre, ubicacion)
SELECT e.empresa_id, v.nombre, v.ubicacion
FROM (VALUES
        ('Minera Norte S.A.',      'Planta Concentradora Calama', 'Calama, Región de Antofagasta, Chile'),
        ('Minera Norte S.A.',      'Faena Chancado Norte',        'Sierra Gorda, Región de Antofagasta, Chile'),
        ('Demo Trial Corp',        'Planta Piloto Trial',         'Santiago, Chile'),
        ('Constructora Sur Ltda.', 'Planta Hormigón Sur',         'Osorno, Región de Los Lagos, Chile')
     ) AS v(empresa, nombre, ubicacion)
JOIN empresa e ON e.nombre = v.empresa;

INSERT INTO disciplina (empresa_id, nombre, color)
SELECT e.empresa_id, v.nombre, v.color
FROM (VALUES
        ('Minera Norte S.A.', 'Mecánica',    'blue'),
        ('Minera Norte S.A.', 'Eléctrica',   'yellow'),
        ('Minera Norte S.A.', 'Hidráulica',  'cyan'),
        ('Minera Norte S.A.', 'Lubricación', 'indigo'),
        ('Demo Trial Corp',   'Mecánica',    'blue'),
        ('Demo Trial Corp',   'Eléctrica',   'yellow')
     ) AS v(empresa, nombre, color)
JOIN empresa e ON e.nombre = v.empresa;

-- Códigos de máquina únicos globalmente (prefijo MN-/TR-) para poder referenciarlos fácil más abajo.
INSERT INTO maquina (planta_id, disciplina_id, nombre, codigo)
SELECT p.planta_id, d.disciplina_id, v.nombre, v.codigo
FROM (VALUES
        ('Planta Concentradora Calama', 'Mecánica',    'Molino SAG 1',              'MN-SAG-01'),
        ('Planta Concentradora Calama', 'Hidráulica',  'Bomba de Pulpa BP-3',       'MN-BOM-03'),
        ('Planta Concentradora Calama', 'Eléctrica',   'Celda de Flotación CF-2',   'MN-FLO-02'),
        ('Planta Concentradora Calama', 'Lubricación', 'Sistema Lubricación Molino', 'MN-LUB-01'),
        ('Faena Chancado Norte',        'Mecánica',    'Chancador Primario CH-01',  'MN-CHA-01'),
        ('Faena Chancado Norte',        'Mecánica',    'Correa Overland CV-12',     'MN-COR-12'),
        ('Faena Chancado Norte',        'Eléctrica',   'Subestación Eléctrica SE-4', 'MN-SUB-04')
     ) AS v(planta, disciplina, nombre, codigo)
JOIN planta p     ON p.nombre = v.planta
JOIN disciplina d ON d.empresa_id = p.empresa_id AND d.nombre = v.disciplina;

INSERT INTO maquina (planta_id, disciplina_id, nombre, codigo)
SELECT p.planta_id, d.disciplina_id, v.nombre, v.codigo
FROM (VALUES
        ('Mecánica',  'Compresor Piloto',  'TR-COM-01'),
        ('Eléctrica', 'Tablero Principal', 'TR-TAB-01')
     ) AS v(disciplina, nombre, codigo)
JOIN planta p     ON p.nombre = 'Planta Piloto Trial'
JOIN disciplina d ON d.empresa_id = p.empresa_id AND d.nombre = v.disciplina;

-- ---------------------------------------------------------------------------
-- Órdenes de trabajo (fechas relativas a hoy para que las gráficas de 14 días tengan datos)
-- ---------------------------------------------------------------------------
INSERT INTO orden_trabajo (numero_ot, maquina_id, tecnico_id, creado_por, tipo, descripcion_problema, descripcion_reparacion,
                           priority, severity, fecha_creacion, fecha_inicio, fecha_cierre, tiempo_reparacion_min,
                           downtime_minutes, costo_estimado, costo_real, estado)
SELECT v.numero_ot, m.maquina_id, t.usuario_id, c.usuario_id,
       v.tipo::tipo_mantenimiento, v.problema, v.reparacion,
       v.prioridad::prioridad_ot, v.severidad::nivel_severidad,
       NOW() - (v.dias || ' days')::interval,
       CASE WHEN v.estado IN ('in_progress', 'completed') THEN NOW() - (v.dias || ' days')::interval + INTERVAL '30 minutes' END,
       CASE WHEN v.estado = 'completed' THEN NOW() - (v.dias || ' days')::interval + (30 + v.duracion) * INTERVAL '1 minute' END,
       CASE WHEN v.estado = 'completed' THEN v.duracion END,
       CASE WHEN v.estado = 'completed' THEN v.duracion END,
       v.costo_est, CASE WHEN v.estado = 'completed' THEN v.costo_real END,
       v.estado::estado_ot
FROM (VALUES
  -- numero_ot       maquina       tecnico                  creador                   tipo          problema                                   reparacion                      prioridad  severidad  dias duracion costo_est costo_real estado
  ('OT-2026-101', 'MN-CHA-01', 'pedro@mineranorte.cl', 'gerente@mineranorte.cl', 'corrective',  'Vibración excesiva en chancador primario',  'Cambio de rodamiento excéntrico', 'urgent',  'critical', 12,  380, 4500.00, 5200.00, 'completed'),
  ('OT-2026-102', 'MN-SAG-01', 'marta@mineranorte.cl', 'gerente@mineranorte.cl', 'preventive',  'Cambio programado de revestimientos',       'Reemplazo de revestimientos',     'high',    'medium',   10,  720, 9000.00, 8650.00, 'completed'),
  ('OT-2026-103', 'MN-BOM-03', 'pedro@mineranorte.cl', 'gerente@mineranorte.cl', 'corrective',  'Fuga en sello mecánico de bomba de pulpa',  'Cambio de sello mecánico',        'high',    'high',      8,  150, 1200.00, 1350.00, 'completed'),
  ('OT-2026-104', 'MN-COR-12', 'marta@mineranorte.cl', 'gerente@mineranorte.cl', 'inspection',  'Desalineación de correa overland',          'Ajuste de rodillos de retorno',   'medium',  'medium',    6,   90,  300.00,  280.00, 'completed'),
  ('OT-2026-105', 'MN-FLO-02', 'pedro@mineranorte.cl', 'gerente@mineranorte.cl', 'predictive',  'Termografía detecta punto caliente en motor', NULL,                            'medium',  'medium',    3, NULL,  400.00,    NULL, 'in_progress'),
  ('OT-2026-106', 'MN-LUB-01', 'marta@mineranorte.cl', 'gerente@mineranorte.cl', 'preventive',  'Cambio de aceite y filtros del sistema',    NULL,                              'low',     'low',       2, NULL,  250.00,    NULL, 'assigned'),
  ('OT-2026-107', 'MN-SUB-04', 'pedro@mineranorte.cl', 'gerente@mineranorte.cl', 'corrective',  'Disparo intermitente de interruptor 13.8 kV', NULL,                            'urgent',  'critical',  1, NULL, 2000.00,    NULL, 'pending'),
  ('OT-2026-108', 'MN-CHA-01', 'marta@mineranorte.cl', 'gerente@mineranorte.cl', 'preventive',  'Inspección mensual de blindajes',           NULL,                              'medium',  'low',      20, NULL,  500.00,    NULL, 'overdue')
) AS v(numero_ot, maq, tec, creador, tipo, problema, reparacion, prioridad, severidad, dias, duracion, costo_est, costo_real, estado)
JOIN maquina m ON m.codigo = v.maq
JOIN usuario t ON t.email = v.tec
JOIN usuario c ON c.email = v.creador;

INSERT INTO orden_trabajo (numero_ot, maquina_id, tecnico_id, creado_por, tipo, descripcion_problema, priority, severity,
                           fecha_creacion, costo_estimado, estado)
SELECT v.numero_ot, m.maquina_id, t.usuario_id, t.usuario_id, v.tipo::tipo_mantenimiento, v.problema,
       v.prioridad::prioridad_ot, v.severidad::nivel_severidad, NOW() - (v.dias || ' days')::interval, 100.00, v.estado::estado_ot
FROM (VALUES
  ('OT-2026-201', 'TR-COM-01', 'corrective',  'Compresor piloto no alcanza presión', 'medium', 'medium', 2, 'pending'),
  ('OT-2026-202', 'TR-TAB-01', 'inspection',  'Revisión de tablero principal',       'low',    'low',    1, 'assigned')
) AS v(numero_ot, maq, tipo, problema, prioridad, severidad, dias, estado)
JOIN maquina m ON m.codigo = v.maq
JOIN usuario t ON t.email = 'tomas@trialcorp.cl';

-- ---------------------------------------------------------------------------
-- Documentación por empresa (base de conocimiento del chat IA)
-- ---------------------------------------------------------------------------
-- Los archivos son ficticios: solo existen los metadatos y los fragmentos indexados.
INSERT INTO documento (empresa_id, usuario_id, title, notes, original_name, stored_name, file_id, content_type, size_bytes, chunks_indexed, activo)
SELECT e.empresa_id, u.usuario_id, v.title, v.notes, v.original_name, 'seed-' || v.file_id || '.txt', 'seed-' || v.file_id,
       'text/plain', v.size_bytes, v.chunks, v.activo
FROM (VALUES
  ('Planta Demo BARB',  'engineer1@planta.com',  'Manual Compresor A1',                 'Mantenimiento y parámetros del compresor A1',      'manual_compresor_a1.txt',   'p1-comp',  18200, 3, TRUE),
  ('Planta Demo BARB',  'engineer1@planta.com',  'Procedimiento Prensa Hidráulica B3',  'Despresurización, fugas y torques de la prensa B3', 'procedimiento_prensa_b3.txt', 'p1-press', 24500, 3, TRUE),
  ('Planta Demo BARB',  'engineer1@planta.com',  'Plan de Lubricación Planta Central',  'Grasas, intervalos y torques de rodamientos',      'plan_lubricacion.txt',      'p1-lub',   12800, 2, TRUE),
  ('Planta Demo BARB',  'engineer1@planta.com',  'Manual Generador G1 (versión obsoleta)', 'Desactivado: reemplazado por manual v2',            'manual_generador_v1.txt',   'p1-gen',    9100, 1, FALSE),
  ('Minera Norte S.A.', 'admin@mineranorte.cl',  'Manual Chancador Primario CH-01',     'Parámetros operacionales y mantenimiento',         'manual_chancador_ch01.txt', 'mn-cha',  31200, 3, TRUE),
  ('Minera Norte S.A.', 'admin@mineranorte.cl',  'Procedimiento Molino SAG 1',          'Revestimientos, llenado y velocidad',              'procedimiento_sag1.txt',    'mn-sag',  27600, 2, TRUE),
  ('Minera Norte S.A.', 'engineer@mineranorte.cl', 'Pauta Correa Overland CV-12',       'Inspección y tensado de correa',                   'pauta_correa_cv12.txt',     'mn-cor',  14300, 2, TRUE),
  ('Demo Trial Corp',   'admin@trialcorp.cl',    'Guía Rápida Compresor Piloto',        'Documento de ejemplo de la cuenta trial',          'guia_compresor_piloto.txt', 'tr-guia',  4200, 1, TRUE)
) AS v(empresa, subido_por, title, notes, original_name, file_id, size_bytes, chunks, activo)
JOIN empresa e ON e.nombre = v.empresa
JOIN usuario u ON u.email  = v.subido_por;

INSERT INTO documento_chunk (documento_id, empresa_id, orden, contenido)
SELECT d.documento_id, d.empresa_id, v.orden, v.contenido
FROM (VALUES
  -- ===== Empresa 1: Planta Demo BARB =====
  ('Manual Compresor A1', 0, 'Compresor A1 (COMP-A1). Presión de trabajo nominal: 8 bar. Presión máxima de operación: 10 bar. Temperatura normal del aceite entre 70 y 85 grados Celsius. Si la temperatura supera 95 grados el compresor se detiene por alarma de alta temperatura.'),
  ('Manual Compresor A1', 1, 'Mantenimiento mensual del compresor A1: 1) Cambio del filtro de aire cada 500 horas de operación. 2) Verificar el nivel de aceite ISO VG 46. 3) Drenar el condensado del estanque. 4) Inspección visual de correas de transmisión. 5) Registrar la presión de trabajo en la bitácora.'),
  ('Manual Compresor A1', 2, 'Cambio de aceite del compresor A1: cada 2000 horas o 12 meses, lo que ocurra primero. Capacidad del cárter: 18 litros de aceite sintético ISO VG 46. Reemplazar siempre el filtro de aceite junto con el aceite. Torque de la tapa del cárter: 25 Nm.'),
  ('Procedimiento Prensa Hidráulica B3', 0, 'Prensa hidráulica B3. Ante una caída de presión de más de 50 bar en 30 segundos se sospecha fuga activa. Pasos: 1) Despresurizar el sistema y aplicar bloqueo LOTO. 2) Inspeccionar mangueras de alta presión. 3) Revisar sellos del cilindro principal. 4) Verificar nivel de aceite hidráulico HLP 68.'),
  ('Procedimiento Prensa Hidráulica B3', 1, 'Torques de la prensa B3: pernos de la tapa del cilindro principal 120 Nm; pernos de montaje de la bomba 85 Nm; conexiones de mangueras de alta presión 45 Nm. Usar llave dinamométrica calibrada. Presión máxima de trabajo del circuito: 250 bar.'),
  ('Procedimiento Prensa Hidráulica B3', 2, 'Filtros de la prensa B3: filtro hidráulico de 10 micrones, cambio cada 1000 horas o cuando el indicador diferencial señale obstrucción. Código de repuesto REP-001. El aceite hidráulico HLP 68 se analiza cada 6 meses.'),
  ('Plan de Lubricación Planta Central', 0, 'Rodamientos: el rodamiento FAG 6308 del motor D1 se aprieta con un torque de 85 Nm. Engrasar con grasa de litio EP2 cada 500 horas de operación, entre 15 y 20 gramos por punto. No mezclar grasas de distinta base.'),
  ('Plan de Lubricación Planta Central', 1, 'Cinta transportadora C1: lubricar rodillos de retorno cada 250 horas con grasa EP2. Verificar tensión de la banda semanalmente. Ante alarma de sobrecarga, revisar primero material atascado y luego medir la corriente del motor.'),
  ('Manual Generador G1 (versión obsoleta)', 0, 'Generador G1 versión 1 (obsoleta). Frecuencia nominal 50 Hz. Revisar el regulador AVR si la frecuencia no se estabiliza bajo carga parcial. Este documento fue reemplazado y está desactivado para el asistente.'),

  -- ===== Empresa 2: Minera Norte S.A. =====
  ('Manual Chancador Primario CH-01', 0, 'Chancador primario CH-01. Abertura de descarga (setting) estándar: 150 mm. Temperatura máxima del aceite de lubricación: 65 grados Celsius; sobre ese valor detener el equipo. Presión mínima del circuito de lubricación: 2,5 bar.'),
  ('Manual Chancador Primario CH-01', 1, 'Blindajes del chancador CH-01: inspección mensual y reemplazo cada 6 meses o al llegar a 30 por ciento de espesor remanente. Torque de pernos de los blindajes: 450 Nm con secuencia en cruz. Registrar el desgaste en la pauta de inspección.'),
  ('Manual Chancador Primario CH-01', 2, 'Vibración del chancador CH-01: el nivel de alarma es 7,1 mm/s RMS y el de disparo 11 mm/s. Una vibración alta suele indicar desgaste del rodamiento excéntrico o material no triturable atascado. Notificar al supervisor de mantenimiento mecánico.'),
  ('Procedimiento Molino SAG 1', 0, 'Molino SAG 1. Velocidad de operación: 74 por ciento de la velocidad crítica. Nivel de llenado de bolas: 12 por ciento y llenado total de carga: 28 por ciento. Nunca arrancar el molino con la carga asentada sin usar el motor de giro lento (inching).'),
  ('Procedimiento Molino SAG 1', 1, 'Cambio de revestimientos del molino SAG 1: torque de los pernos de revestimiento 1200 Nm. Se requiere manipulador de revestimientos y bloqueo LOTO del motor principal. Duración estimada de la intervención: 12 horas con dos cuadrillas.'),
  ('Pauta Correa Overland CV-12', 0, 'Correa overland CV-12. Velocidad de la correa: 4,2 m/s. Inspeccionar rodillos de retorno cada 250 horas y rodillos de carga cada 500 horas. Verificar la alineación semanalmente y reportar cualquier desvío superior a 50 mm.'),
  ('Pauta Correa Overland CV-12', 1, 'Tensado de la correa CV-12: ajustar el contrapeso según la carga de diseño y registrar la tensión en la bitácora. Ante deslizamiento sobre el tambor motriz revisar el revestimiento cerámico del tambor y la tensión de la correa antes de reiniciar.'),

  -- ===== Empresa 3: Demo Trial Corp =====
  ('Guía Rápida Compresor Piloto', 0, 'Compresor piloto de Demo Trial Corp. Presión de trabajo: 6 bar. Drenar el condensado semanalmente y revisar el filtro de aire cada 300 horas. Documento de ejemplo de la cuenta de prueba.')
) AS v(titulo, orden, contenido)
JOIN documento d ON d.title = v.titulo;
