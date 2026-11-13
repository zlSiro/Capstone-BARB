-- =============================================================================
-- 02_maestros.sql — Empresas y usuarios base de las 3 empresas reales
-- =============================================================================
-- Proyecto: BARB (Capstone DUOC UC) · Rama: feat/seed-realista
--
-- QUÉ HACE
--   Carga el catálogo completo de las 3 empresas del informe de datos reales:
--     3 empresas · 21 usuarios · 11 disciplinas · 6 plantas · 11 máquinas · 28 sensores
--
--   Usuarios por empresa (7): 1 admin, 2 gerentes, 3 técnicos y 1 **supervisor**.
--   El supervisor es el rol que opera las OT en la matriz vigente (crea, asigna,
--   valida y cierra), así que las OTs de 03_operativos.sql lo usan como creador.
--
--   Empresa                    RUT             Industria    Dominio
--   Minera del Norte           77.111.111-1    Minería      mineradelnorte.cl
--   Planta de Alimentos        77.222.222-2    Alimentos    alimentos.cl
--   Manufactura Automotriz     77.333.333-3    Automotriz   automotriz.cl
--
--   Plantas y equipos (marca y modelo reales, según el informe):
--   Minera del Norte
--     Chancado Primario · Chancador de cono Sandvik H8800, Correa Overland
--     Molienda SAG       · Molino SAG con motor Siemens, Bomba de pulpa KSB
--   Planta de Alimentos
--     Planta de Vapor    · Caldera Parker WH395L, Bomba de alimentación Grundfos
--     Túnel de Frío      · Compresor de Amoníaco
--   Manufactura Automotriz
--     Línea de Paletizado· Brazo Robótico KUKA KR 50, PLC de Línea Siemens
--     Línea de Estampado · Prensa Hidráulica Larzep, Generador de Respaldo
--
--   El SLA y el costo de inactividad por equipo salen del informe: la minería es
--   el caso más caro por minuto detenido (SLA 8-12 h · 3.000-5.000 CLP/min).
--
-- CREDENCIALES DE DEMO (bcrypt ya calculado; solo desarrollo/demo)
--   Minera del Norte       admin@mineradelnorte.cl    / mineria123
--                          supervisor@mineradelnorte.cl / mineria123
--                          gerente@mineradelnorte.cl  / mineria123
--   Planta de Alimentos    admin@alimentos.cl         / alimentos123
--                          supervisor@alimentos.cl    / alimentos123
--                          gerente@alimentos.cl       / alimentos123
--   Manufactura Automotriz admin@automotriz.cl        / automotriz123
--                          supervisor@automotriz.cl   / automotriz123
--                          gerente@automotriz.cl      / automotriz123
--   (los técnicos usan la misma contraseña de su empresa)
--
-- QUÉ **NO** HACE
--   - No borra nada: no hay TRUNCATE ni DELETE en este archivo.
--   - No toca las empresas que ya existían en la base (Planta Demo BARB,
--     Minera Norte S.A., etc.). Los RUT 77.* son nuevos, así que no chocan con
--     el índice único `empresa_rut_key`.
--   - No crea órdenes de trabajo, lecturas de sensores ni documentos: eso va en
--     el 03_operativos.sql.
--
-- IDEMPOTENTE
--   - Empresas: INSERT ... ON CONFLICT (rut) DO NOTHING.
--   - Usuarios: INSERT ... WHERE NOT EXISTS (email). Se puede correr dos veces y
--     el resultado es el mismo (0 filas nuevas la segunda vez).
--   El pivote es SIEMPRE el RUT, nunca el nombre: si alguien renombra la empresa,
--   los usuarios se siguen insertando en la correcta.
--
-- CÓMO SE APLICA (después de 01_estructura.sql, desde backend/)
--   Windows (cmd, recomendado):
--     docker exec -i barb_capstone_postgres psql -U barb_admin -d barb_database
--       -v ON_ERROR_STOP=1 < seeds\02_maestros.sql
--   Linux/macOS:
--     docker exec -i barb_capstone_postgres psql -U barb_admin -d barb_database \
--       -v ON_ERROR_STOP=1 < seeds/02_maestros.sql
--
-- ⚠ NO uses "Get-Content archivo.sql | docker exec -i ..." en PowerShell: la
--   tubería re-codifica a la página ANSI de la consola y los nombres con tilde
--   terminan doble-codificados ("Sepúlveda" se guarda como "SepÃºlveda"). Los
--   ejemplos de arriba usan la redirección `<` del shell, que pasa los bytes tal
--   cual. Los archivos están en UTF-8 sin BOM.
--
-- Requiere el esquema en la revisión 0015 (roles sin `visitante`, estado `demo`
-- eliminado). Correr 01_estructura.sql primero verifica justamente eso.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Empresas
-- -----------------------------------------------------------------------------
INSERT INTO empresa (
    nombre, rut, pais, industria,
    contacto_nombre, contacto_email, contacto_telefono,
    plan, estado, max_usuarios, max_plantas,
    licencia_inicio, licencia_fin, notas
)
VALUES
    (
        'Minera del Norte', '77.111.111-1', 'Chile', 'Minería',
        'Carolina Sepúlveda', 'carolina.sepulveda@mineradelnorte.cl', '+56 55 234 5678',
        'enterprise', 'active', 30, 5,
        CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year',
        'Seed realista: faena de cobre en el norte. Datos demo.'
    ),
    (
        'Planta de Alimentos', '77.222.222-2', 'Chile', 'Alimentos',
        'Francisca Toledo', 'francisca.toledo@alimentos.cl', '+56 2 2876 4321',
        'professional', 'active', 20, 3,
        CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year',
        'Seed realista: planta de proceso y envasado. Datos demo.'
    ),
    (
        'Manufactura Automotriz', '77.333.333-3', 'Chile', 'Automotriz',
        'Ignacio Herrera', 'ignacio.herrera@automotriz.cl', '+56 2 2654 9876',
        'professional', 'active', 20, 3,
        CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year',
        'Seed realista: línea de ensamble de autopartes. Datos demo.'
    )
ON CONFLICT (rut) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Usuarios base
-- -----------------------------------------------------------------------------
-- Cada bloque pivota por el RUT de la empresa y por el email del usuario, así
-- que es seguro re-ejecutarlo. Los ids de empresa nunca se escriben a mano.
-- El CHECK `ck_usuario_empresa_rol` exige empresa_id para todos los roles que no
-- sean super_usuario, y acá todos la tienen.

-- 2.1 Minera del Norte --------------------------------------------------------
INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
SELECT e.empresa_id, v.nombre, v.email, v.password_hash, v.rol
FROM empresa e
CROSS JOIN (VALUES
    -- password: mineria123
    ('Administrador Minera del Norte', 'admin@mineradelnorte.cl',
     '$2b$12$TJrykEFiGHr649wpNCuhruIXyqI6nxUU7QaWwfJUxQX8tvWxUdemK', 'admin'),
    ('Carolina Sepúlveda', 'gerente@mineradelnorte.cl',
     '$2b$12$TJrykEFiGHr649wpNCuhruIXyqI6nxUU7QaWwfJUxQX8tvWxUdemK', 'gerente'),
    ('Rodrigo Fuentes', 'gerente2@mineradelnorte.cl',
     '$2b$12$TJrykEFiGHr649wpNCuhruIXyqI6nxUU7QaWwfJUxQX8tvWxUdemK', 'gerente'),
    ('Matías Contreras', 'tecnico1@mineradelnorte.cl',
     '$2b$12$TJrykEFiGHr649wpNCuhruIXyqI6nxUU7QaWwfJUxQX8tvWxUdemK', 'tecnico'),
    ('Paula Riquelme', 'tecnico2@mineradelnorte.cl',
     '$2b$12$TJrykEFiGHr649wpNCuhruIXyqI6nxUU7QaWwfJUxQX8tvWxUdemK', 'tecnico'),
    ('Sebastián Araya', 'tecnico3@mineradelnorte.cl',
     '$2b$12$TJrykEFiGHr649wpNCuhruIXyqI6nxUU7QaWwfJUxQX8tvWxUdemK', 'tecnico'),
    -- supervisor: es el rol que opera las OT (crea, asigna, valida y cierra)
    ('Javiera Soto', 'supervisor@mineradelnorte.cl',
     '$2b$12$TJrykEFiGHr649wpNCuhruIXyqI6nxUU7QaWwfJUxQX8tvWxUdemK', 'supervisor')
) AS v(nombre, email, password_hash, rol)
WHERE e.rut = '77.111.111-1'
  AND NOT EXISTS (SELECT 1 FROM usuario u WHERE u.email = v.email);

-- 2.2 Planta de Alimentos -----------------------------------------------------
INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
SELECT e.empresa_id, v.nombre, v.email, v.password_hash, v.rol
FROM empresa e
CROSS JOIN (VALUES
    -- password: alimentos123
    ('Administrador Planta de Alimentos', 'admin@alimentos.cl',
     '$2b$12$b6zQavSoWrduNh3z6UKnJePAExmSsbo3Jt7MNoF8v2uxffKiAqbSG', 'admin'),
    ('Francisca Toledo', 'gerente@alimentos.cl',
     '$2b$12$b6zQavSoWrduNh3z6UKnJePAExmSsbo3Jt7MNoF8v2uxffKiAqbSG', 'gerente'),
    ('Andrés Bravo', 'gerente2@alimentos.cl',
     '$2b$12$b6zQavSoWrduNh3z6UKnJePAExmSsbo3Jt7MNoF8v2uxffKiAqbSG', 'gerente'),
    ('Camila Paredes', 'tecnico1@alimentos.cl',
     '$2b$12$b6zQavSoWrduNh3z6UKnJePAExmSsbo3Jt7MNoF8v2uxffKiAqbSG', 'tecnico'),
    ('Jorge Salinas', 'tecnico2@alimentos.cl',
     '$2b$12$b6zQavSoWrduNh3z6UKnJePAExmSsbo3Jt7MNoF8v2uxffKiAqbSG', 'tecnico'),
    ('Daniela Vera', 'tecnico3@alimentos.cl',
     '$2b$12$b6zQavSoWrduNh3z6UKnJePAExmSsbo3Jt7MNoF8v2uxffKiAqbSG', 'tecnico'),
    -- supervisor: es el rol que opera las OT (crea, asigna, valida y cierra)
    ('Manuel Ortiz', 'supervisor@alimentos.cl',
     '$2b$12$b6zQavSoWrduNh3z6UKnJePAExmSsbo3Jt7MNoF8v2uxffKiAqbSG', 'supervisor')
) AS v(nombre, email, password_hash, rol)
WHERE e.rut = '77.222.222-2'
  AND NOT EXISTS (SELECT 1 FROM usuario u WHERE u.email = v.email);

-- 2.3 Manufactura Automotriz --------------------------------------------------
INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
SELECT e.empresa_id, v.nombre, v.email, v.password_hash, v.rol
FROM empresa e
CROSS JOIN (VALUES
    -- password: automotriz123
    ('Administrador Manufactura Automotriz', 'admin@automotriz.cl',
     '$2b$12$Qj2ynleWgWiKueQMpnTK4OlEoKmBsHadePh9fWXkWwUkK//URI1MK', 'admin'),
    ('Ignacio Herrera', 'gerente@automotriz.cl',
     '$2b$12$Qj2ynleWgWiKueQMpnTK4OlEoKmBsHadePh9fWXkWwUkK//URI1MK', 'gerente'),
    ('Valentina Rojas', 'gerente2@automotriz.cl',
     '$2b$12$Qj2ynleWgWiKueQMpnTK4OlEoKmBsHadePh9fWXkWwUkK//URI1MK', 'gerente'),
    ('Felipe Guzmán', 'tecnico1@automotriz.cl',
     '$2b$12$Qj2ynleWgWiKueQMpnTK4OlEoKmBsHadePh9fWXkWwUkK//URI1MK', 'tecnico'),
    ('Antonia Reyes', 'tecnico2@automotriz.cl',
     '$2b$12$Qj2ynleWgWiKueQMpnTK4OlEoKmBsHadePh9fWXkWwUkK//URI1MK', 'tecnico'),
    ('Marcelo Díaz', 'tecnico3@automotriz.cl',
     '$2b$12$Qj2ynleWgWiKueQMpnTK4OlEoKmBsHadePh9fWXkWwUkK//URI1MK', 'tecnico'),
    -- supervisor: es el rol que opera las OT (crea, asigna, valida y cierra)
    ('Constanza Lagos', 'supervisor@automotriz.cl',
     '$2b$12$Qj2ynleWgWiKueQMpnTK4OlEoKmBsHadePh9fWXkWwUkK//URI1MK', 'supervisor')
) AS v(nombre, email, password_hash, rol)
WHERE e.rut = '77.333.333-3'
  AND NOT EXISTS (SELECT 1 FROM usuario u WHERE u.email = v.email);

-- -----------------------------------------------------------------------------
-- 3. Disciplinas
-- -----------------------------------------------------------------------------
-- `disciplina` cuelga de la EMPRESA (no de la planta): se comparte entre plantas.
-- Único: (empresa_id, nombre).
INSERT INTO disciplina (empresa_id, nombre, color)
SELECT e.empresa_id, v.nombre, v.color
FROM empresa e
CROSS JOIN (VALUES
    ('Mecánica', '#ef4444'),
    ('Eléctrica', '#f59e0b'),
    ('Instrumentación', '#3b82f6')
) AS v(nombre, color)
WHERE e.rut = '77.111.111-1'
  AND NOT EXISTS (
      SELECT 1 FROM disciplina d WHERE d.empresa_id = e.empresa_id AND d.nombre = v.nombre
  );

INSERT INTO disciplina (empresa_id, nombre, color)
SELECT e.empresa_id, v.nombre, v.color
FROM empresa e
CROSS JOIN (VALUES
    ('Mecánica', '#ef4444'),
    ('Eléctrica', '#f59e0b'),
    ('Instrumentación', '#3b82f6'),
    ('Refrigeración', '#06b6d4')
) AS v(nombre, color)
WHERE e.rut = '77.222.222-2'
  AND NOT EXISTS (
      SELECT 1 FROM disciplina d WHERE d.empresa_id = e.empresa_id AND d.nombre = v.nombre
  );

INSERT INTO disciplina (empresa_id, nombre, color)
SELECT e.empresa_id, v.nombre, v.color
FROM empresa e
CROSS JOIN (VALUES
    ('Mecánica', '#ef4444'),
    ('Eléctrica', '#f59e0b'),
    ('Instrumentación', '#3b82f6'),
    ('Automatización', '#8b5cf6')
) AS v(nombre, color)
WHERE e.rut = '77.333.333-3'
  AND NOT EXISTS (
      SELECT 1 FROM disciplina d WHERE d.empresa_id = e.empresa_id AND d.nombre = v.nombre
  );

-- -----------------------------------------------------------------------------
-- 4. Plantas (2 por empresa)
-- -----------------------------------------------------------------------------
-- `planta` no tiene clave natural única, así que la idempotencia se resuelve con
-- NOT EXISTS por (empresa_id, nombre).
INSERT INTO planta (empresa_id, nombre, ubicacion)
SELECT e.empresa_id, v.nombre, v.ubicacion
FROM empresa e
CROSS JOIN (VALUES
    ('Chancado Primario', 'Calama, Región de Antofagasta, Chile'),
    ('Molienda SAG', 'Calama, Región de Antofagasta, Chile')
) AS v(nombre, ubicacion)
WHERE e.rut = '77.111.111-1'
  AND NOT EXISTS (SELECT 1 FROM planta p WHERE p.empresa_id = e.empresa_id AND p.nombre = v.nombre);

INSERT INTO planta (empresa_id, nombre, ubicacion)
SELECT e.empresa_id, v.nombre, v.ubicacion
FROM empresa e
CROSS JOIN (VALUES
    ('Planta de Vapor', 'San Bernardo, Región Metropolitana, Chile'),
    ('Túnel de Frío', 'San Bernardo, Región Metropolitana, Chile')
) AS v(nombre, ubicacion)
WHERE e.rut = '77.222.222-2'
  AND NOT EXISTS (SELECT 1 FROM planta p WHERE p.empresa_id = e.empresa_id AND p.nombre = v.nombre);

INSERT INTO planta (empresa_id, nombre, ubicacion)
SELECT e.empresa_id, v.nombre, v.ubicacion
FROM empresa e
CROSS JOIN (VALUES
    ('Línea de Paletizado', 'Quilicura, Región Metropolitana, Chile'),
    ('Línea de Estampado', 'Quilicura, Región Metropolitana, Chile')
) AS v(nombre, ubicacion)
WHERE e.rut = '77.333.333-3'
  AND NOT EXISTS (SELECT 1 FROM planta p WHERE p.empresa_id = e.empresa_id AND p.nombre = v.nombre);

-- -----------------------------------------------------------------------------
-- 5. Máquinas (equipos reales con marca y modelo)
-- -----------------------------------------------------------------------------
-- Se resuelve la planta por nombre y la disciplina por nombre dentro de la misma
-- empresa. `maquina` tiene UNIQUE (planta_id, codigo), así que el código interno
-- es el que da la idempotencia.
-- SLA y costo de inactividad salen del informe: minería es lo más caro por minuto
-- detenido (SLA 8-12 h · 3.000-5.000 CLP/min).
INSERT INTO maquina (planta_id, disciplina_id, nombre, codigo, sla_horas, costo_inactividad_minuto)
SELECT p.planta_id, d.disciplina_id, v.nombre, v.codigo, v.sla_horas, v.costo
FROM empresa e
CROSS JOIN (VALUES
    ('Chancado Primario', 'Mecánica',        'Chancador de cono Sandvik H8800', 'CHA-001', 8,  5000),
    ('Chancado Primario', 'Mecánica',        'Correa Overland',                 'COR-001', 10, 3000),
    ('Molienda SAG',      'Eléctrica',       'Molino SAG con motor Siemens',    'MOL-001', 12, 4500),
    ('Molienda SAG',      'Mecánica',        'Bomba de pulpa KSB',              'BOM-001', 8,  3500)
) AS v(planta, disciplina, nombre, codigo, sla_horas, costo)
JOIN planta p ON p.empresa_id = e.empresa_id AND p.nombre = v.planta
LEFT JOIN disciplina d ON d.empresa_id = e.empresa_id AND d.nombre = v.disciplina
WHERE e.rut = '77.111.111-1'
  AND NOT EXISTS (
      SELECT 1 FROM maquina m WHERE m.planta_id = p.planta_id AND m.codigo = v.codigo
  );

INSERT INTO maquina (planta_id, disciplina_id, nombre, codigo, sla_horas, costo_inactividad_minuto)
SELECT p.planta_id, d.disciplina_id, v.nombre, v.codigo, v.sla_horas, v.costo
FROM empresa e
CROSS JOIN (VALUES
    ('Planta de Vapor', 'Mecánica',      'Caldera Parker WH395L',             'CAL-001', 6, 4000),
    ('Planta de Vapor', 'Mecánica',      'Bomba de alimentación Grundfos',    'BOM-002', 6, 3000),
    ('Túnel de Frío',   'Refrigeración', 'Compresor de Amoníaco',             'COM-001', 4, 5000)
) AS v(planta, disciplina, nombre, codigo, sla_horas, costo)
JOIN planta p ON p.empresa_id = e.empresa_id AND p.nombre = v.planta
LEFT JOIN disciplina d ON d.empresa_id = e.empresa_id AND d.nombre = v.disciplina
WHERE e.rut = '77.222.222-2'
  AND NOT EXISTS (
      SELECT 1 FROM maquina m WHERE m.planta_id = p.planta_id AND m.codigo = v.codigo
  );

INSERT INTO maquina (planta_id, disciplina_id, nombre, codigo, sla_horas, costo_inactividad_minuto)
SELECT p.planta_id, d.disciplina_id, v.nombre, v.codigo, v.sla_horas, v.costo
FROM empresa e
CROSS JOIN (VALUES
    ('Línea de Paletizado', 'Automatización',  'Brazo Robótico KUKA KR 50',   'ROB-001', 8, 4000),
    ('Línea de Paletizado', 'Automatización',  'PLC de Línea Siemens',        'PLC-001', 4, 6000),
    ('Línea de Estampado',  'Mecánica',        'Prensa Hidráulica Larzep',    'PRE-001', 8, 3500),
    ('Línea de Estampado',  'Eléctrica',       'Generador de Respaldo',       'GEN-001', 6, 5000)
) AS v(planta, disciplina, nombre, codigo, sla_horas, costo)
JOIN planta p ON p.empresa_id = e.empresa_id AND p.nombre = v.planta
LEFT JOIN disciplina d ON d.empresa_id = e.empresa_id AND d.nombre = v.disciplina
WHERE e.rut = '77.333.333-3'
  AND NOT EXISTS (
      SELECT 1 FROM maquina m WHERE m.planta_id = p.planta_id AND m.codigo = v.codigo
  );

-- -----------------------------------------------------------------------------
-- 6. Sensores (2-3 por máquina, los que alimentan las lecturas del 03_)
-- -----------------------------------------------------------------------------
-- `sensor.codigo` es ÚNICO GLOBAL, por eso se prefija con el código de la máquina.
INSERT INTO sensor (maquina_id, nombre, codigo)
SELECT m.maquina_id, v.nombre, v.codigo
FROM empresa e
CROSS JOIN (VALUES
    -- Minera del Norte
    ('CHA-001', 'Vibración de carcasa',    'CHA-001-VIB'),
    ('CHA-001', 'Temperatura de aceite',   'CHA-001-TEMP'),
    ('CHA-001', 'Corriente del motor',     'CHA-001-AMP'),
    ('COR-001', 'Velocidad de banda',      'COR-001-VEL'),
    ('COR-001', 'Temperatura de rodamiento', 'COR-001-TEMP'),
    ('MOL-001', 'Vibración de chumacera',  'MOL-001-VIB'),
    ('MOL-001', 'Temperatura de devanado', 'MOL-001-TEMP'),
    ('MOL-001', 'Velocidad de giro',       'MOL-001-RPM'),
    ('BOM-001', 'Presión de descarga',     'BOM-001-PRES'),
    ('BOM-001', 'Vibración de eje',        'BOM-001-VIB'),
    ('BOM-001', 'Corriente del motor',     'BOM-001-AMP')
) AS v(maquina_codigo, nombre, codigo)
JOIN planta p ON p.empresa_id = e.empresa_id
JOIN maquina m ON m.planta_id = p.planta_id AND m.codigo = v.maquina_codigo
WHERE e.rut = '77.111.111-1'
  AND NOT EXISTS (SELECT 1 FROM sensor s WHERE s.codigo = v.codigo);

INSERT INTO sensor (maquina_id, nombre, codigo)
SELECT m.maquina_id, v.nombre, v.codigo
FROM empresa e
CROSS JOIN (VALUES
    -- Planta de Alimentos
    ('CAL-001', 'Presión de vapor',        'CAL-001-PRES'),
    ('CAL-001', 'Temperatura de gases',    'CAL-001-TEMP'),
    ('CAL-001', 'Nivel de agua',           'CAL-001-NIV'),
    ('BOM-002', 'Presión de descarga',     'BOM-002-PRES'),
    ('BOM-002', 'Caudal de alimentación',  'BOM-002-CAUD'),
    ('COM-001', 'Presión de alta',         'COM-001-PALT'),
    ('COM-001', 'Presión de baja',         'COM-001-PBAJ'),
    ('COM-001', 'Temperatura de descarga', 'COM-001-TEMP')
) AS v(maquina_codigo, nombre, codigo)
JOIN planta p ON p.empresa_id = e.empresa_id
JOIN maquina m ON m.planta_id = p.planta_id AND m.codigo = v.maquina_codigo
WHERE e.rut = '77.222.222-2'
  AND NOT EXISTS (SELECT 1 FROM sensor s WHERE s.codigo = v.codigo);

INSERT INTO sensor (maquina_id, nombre, codigo)
SELECT m.maquina_id, v.nombre, v.codigo
FROM empresa e
CROSS JOIN (VALUES
    -- Manufactura Automotriz
    ('ROB-001', 'Temperatura de servo',    'ROB-001-TEMP'),
    ('ROB-001', 'Vibración de eje',        'ROB-001-VIB'),
    ('PLC-001', 'Temperatura de gabinete', 'PLC-001-TEMP'),
    ('PLC-001', 'Voltaje de control',      'PLC-001-VOLT'),
    ('PRE-001', 'Presión hidráulica',      'PRE-001-PRES'),
    ('PRE-001', 'Temperatura de aceite',   'PRE-001-TEMP'),
    ('GEN-001', 'Temperatura de refrigerante', 'GEN-001-TEMP'),
    ('GEN-001', 'Voltaje de salida',       'GEN-001-VOLT'),
    ('GEN-001', 'Nivel de combustible',    'GEN-001-NIV')
) AS v(maquina_codigo, nombre, codigo)
JOIN planta p ON p.empresa_id = e.empresa_id
JOIN maquina m ON m.planta_id = p.planta_id AND m.codigo = v.maquina_codigo
WHERE e.rut = '77.333.333-3'
  AND NOT EXISTS (SELECT 1 FROM sensor s WHERE s.codigo = v.codigo);

COMMIT;

-- -----------------------------------------------------------------------------
-- Verificación (solo lectura): catálogo completo por empresa.
-- Esperado: 21 usuarios · 11 disciplinas · 6 plantas · 11 máquinas · 28 sensores.
-- -----------------------------------------------------------------------------
SELECT e.nombre,
       e.industria,
       e.rut,
       (SELECT count(*) FROM usuario u WHERE u.empresa_id = e.empresa_id)     AS usuarios,
       (SELECT count(*) FROM disciplina d WHERE d.empresa_id = e.empresa_id)  AS disciplinas,
       (SELECT count(*) FROM planta p WHERE p.empresa_id = e.empresa_id)      AS plantas,
       (SELECT count(*)
          FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = e.empresa_id)                                  AS maquinas,
       (SELECT count(*)
          FROM sensor s
          JOIN maquina m ON m.maquina_id = s.maquina_id
          JOIN planta p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = e.empresa_id)                                  AS sensores
FROM empresa e
WHERE e.rut IN ('77.111.111-1', '77.222.222-2', '77.333.333-3')
ORDER BY e.nombre;

-- Detalle de equipos, para revisar de un vistazo planta → disciplina → máquina.
SELECT e.nombre AS empresa,
       p.nombre AS planta,
       m.codigo,
       m.nombre AS maquina,
       d.nombre AS disciplina,
       m.sla_horas,
       m.costo_inactividad_minuto AS costo_min,
       (SELECT count(*) FROM sensor s WHERE s.maquina_id = m.maquina_id) AS sensores
FROM maquina m
JOIN planta p ON p.planta_id = m.planta_id
JOIN empresa e ON e.empresa_id = p.empresa_id
LEFT JOIN disciplina d ON d.disciplina_id = m.disciplina_id
WHERE e.rut IN ('77.111.111-1', '77.222.222-2', '77.333.333-3')
ORDER BY e.nombre, p.nombre, m.codigo;
