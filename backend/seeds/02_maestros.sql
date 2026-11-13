-- =============================================================================
-- 02_maestros.sql — Empresas y usuarios base de las 3 empresas reales
-- =============================================================================
-- Proyecto: BARB (Capstone DUOC UC) · Rama: feat/seed-realista
--
-- QUÉ HACE
--   Crea las 3 empresas del informe de datos reales y sus usuarios base
--   (1 admin + 2 gerentes + 3 técnicos por empresa = 18 usuarios).
--
--   Empresa                    RUT             Industria    Dominio
--   Minera del Norte           77.111.111-1    Minería      mineradelnorte.cl
--   Planta de Alimentos        77.222.222-2    Alimentos    alimentos.cl
--   Manufactura Automotriz     77.333.333-3    Automotriz   automotriz.cl
--
-- CREDENCIALES DE DEMO (bcrypt ya calculado; solo desarrollo/demo)
--   Minera del Norte       admin@mineradelnorte.cl    / mineria123
--                          gerente@mineradelnorte.cl  / mineria123
--   Planta de Alimentos    admin@alimentos.cl         / alimentos123
--                          gerente@alimentos.cl       / alimentos123
--   Manufactura Automotriz admin@automotriz.cl        / automotriz123
--                          gerente@automotriz.cl      / automotriz123
--   (los técnicos usan la misma contraseña de su empresa)
--
-- QUÉ **NO** HACE
--   - No borra nada: no hay TRUNCATE ni DELETE en este archivo.
--   - No toca las empresas que ya existían en la base (Planta Demo BARB,
--     Minera Norte S.A., etc.). Los RUT 77.* son nuevos, así que no chocan con
--     el índice único `empresa_rut_key`.
--   - No crea plantas, máquinas ni OTs: eso va en el archivo siguiente.
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
     '$2b$12$TJrykEFiGHr649wpNCuhruIXyqI6nxUU7QaWwfJUxQX8tvWxUdemK', 'tecnico')
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
     '$2b$12$b6zQavSoWrduNh3z6UKnJePAExmSsbo3Jt7MNoF8v2uxffKiAqbSG', 'tecnico')
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
     '$2b$12$Qj2ynleWgWiKueQMpnTK4OlEoKmBsHadePh9fWXkWwUkK//URI1MK', 'tecnico')
) AS v(nombre, email, password_hash, rol)
WHERE e.rut = '77.333.333-3'
  AND NOT EXISTS (SELECT 1 FROM usuario u WHERE u.email = v.email);

COMMIT;

-- -----------------------------------------------------------------------------
-- Verificación (solo lectura): debería mostrar 3 empresas y 18 usuarios, con 6
-- por empresa y los roles 1 admin / 2 gerentes / 3 técnicos.
-- -----------------------------------------------------------------------------
SELECT e.nombre,
       e.industria,
       e.rut,
       count(u.usuario_id)                                        AS usuarios,
       count(*) FILTER (WHERE u.rol = 'admin')                    AS admins,
       count(*) FILTER (WHERE u.rol = 'gerente')                  AS gerentes,
       count(*) FILTER (WHERE u.rol = 'tecnico')                  AS tecnicos
FROM empresa e
LEFT JOIN usuario u ON u.empresa_id = e.empresa_id
WHERE e.rut IN ('77.111.111-1', '77.222.222-2', '77.333.333-3')
GROUP BY e.empresa_id, e.nombre, e.industria, e.rut
ORDER BY e.nombre;
