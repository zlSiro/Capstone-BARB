"""initial schema — core domain tables (port of backend/initScripts/01_tablas.sql)

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-09-22

Puerto 1:1 del DDL legado (enums + tablas + indices de negocio). No incluye
`DROP SCHEMA public CASCADE` del script original: Alembic asume un schema
`public` ya existente y gestionado por migraciones desde ahora en adelante.
"""

from __future__ import annotations

from alembic import op

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None

_DDL_UP = r'''
CREATE TYPE nivel_severidad   AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE estado_reporte    AS ENUM ('draft', 'generated', 'uploaded', 'approved', 'archived');
CREATE TYPE tipo_mantenimiento AS ENUM ('corrective', 'preventive', 'predictive', 'inspection');
CREATE TYPE prioridad_ot      AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE estado_ot         AS ENUM ('pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'overdue');
CREATE TYPE estado_repuesto   AS ENUM ('active', 'discontinued', 'out_of_stock');
CREATE TYPE tipo_nodo         AS ENUM ('machine', 'controller', 'sensor', 'hub');
CREATE TYPE estado_nodo       AS ENUM ('operational', 'warning', 'error', 'offline');
CREATE TYPE tipo_conexion     AS ENUM ('electrical', 'mechanical', 'data', 'hydraulic', 'pneumatic');
CREATE TYPE estado_conexion   AS ENUM ('active', 'inactive');
CREATE TYPE frecuencia_mant   AS ENUM ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom');
CREATE TYPE prioridad_mant    AS ENUM ('low', 'medium', 'high');
CREATE TYPE estado_programa   AS ENUM ('active', 'paused', 'inactive');
CREATE TYPE estado_ejecucion  AS ENUM ('scheduled', 'completed', 'skipped', 'overdue');
CREATE TYPE estado_lectura    AS ENUM ('normal', 'warning', 'critical');
-- Enums incorporados en v3.0 para soporte multi-tenant y auditoría.
CREATE TYPE plan_empresa      AS ENUM ('trial', 'starter', 'professional', 'enterprise');
CREATE TYPE estado_empresa    AS ENUM ('active', 'suspended', 'cancelled', 'demo');
CREATE TYPE accion_audit      AS ENUM (
    'login', 'logout', 'create', 'update', 'delete', 'view',
    'export', 'import', 'approve', 'reject', 'assign', 'upload',
    'download', 'chat_query', 'chat_save', 'report_generate'
);

-- =============================================================================
-- TABLAS MAESTRAS
-- =============================================================================
--
-- Entidades base del modelo multi-tenant: empresas, usuarios, plantas y
-- repuestos.
--

-- EMPRESA: tabla raíz multi-tenant. Cada cliente compra una licencia de
-- BARB y todos los datos quedan aislados por empresa_id.
CREATE TABLE EMPRESA (
    empresa_id        SERIAL PRIMARY KEY,
    nombre            VARCHAR(150) NOT NULL,
    rut               VARCHAR(20)  UNIQUE,          -- RUT/NIT/RFC según país
    pais              VARCHAR(60)  NOT NULL DEFAULT 'Chile',
    industria         VARCHAR(100),                 -- 'Minería', 'Manufactura', etc.
    contacto_nombre   VARCHAR(100),
    contacto_email    VARCHAR(100),
    contacto_telefono VARCHAR(30),
    logo_url          VARCHAR(500),
    plan              plan_empresa  NOT NULL DEFAULT 'trial',
    estado            estado_empresa NOT NULL DEFAULT 'active',
    max_usuarios      INT           NOT NULL DEFAULT 10,
    max_plantas       INT           NOT NULL DEFAULT 1,
    licencia_inicio   DATE,
    licencia_fin      DATE,
    notas             TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE USUARIO (
    usuario_id    SERIAL PRIMARY KEY,
    empresa_id    INT          NOT NULL,
    nombre        VARCHAR(100) NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol           VARCHAR(50)  NOT NULL,
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_login  TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuario_empresa FOREIGN KEY (empresa_id) REFERENCES EMPRESA(empresa_id)
);

CREATE TABLE PLANTA (
    planta_id  SERIAL PRIMARY KEY,
    empresa_id INT          NOT NULL,
    nombre     VARCHAR(120) NOT NULL,
    ubicacion  VARCHAR(255),
    CONSTRAINT fk_planta_empresa FOREIGN KEY (empresa_id) REFERENCES EMPRESA(empresa_id)
);

CREATE TABLE REPUESTO (
    repuesto_id      SERIAL PRIMARY KEY,
    empresa_id       INT          NOT NULL,
    codigo           VARCHAR(50)  NOT NULL,
    part_number      VARCHAR(80),
    nombre           VARCHAR(150) NOT NULL,
    descripcion      TEXT,
    tipo             VARCHAR(60),
    categoria        VARCHAR(60),
    unidad           VARCHAR(20)  NOT NULL,
    stock_actual     DECIMAL(12,2) NOT NULL DEFAULT 0,
    stock_minimo     DECIMAL(12,2) NOT NULL DEFAULT 0,
    stock_maximo     DECIMAL(12,2),
    costo_unitario   DECIMAL(12,2),
    proveedor        VARCHAR(120),
    ubicacion_bodega VARCHAR(80),
    imagen_url       VARCHAR(255),
    estado           estado_repuesto NOT NULL DEFAULT 'active',
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (empresa_id, codigo),
    CONSTRAINT fk_repuesto_empresa FOREIGN KEY (empresa_id) REFERENCES EMPRESA(empresa_id)
);

-- =============================================================================
-- INFRAESTRUCTURA
-- =============================================================================
--
-- Modelo físico de plantas: disciplinas, máquinas y sensores.
--
CREATE TABLE DISCIPLINA (
    disciplina_id SERIAL PRIMARY KEY,
    empresa_id    INT         NOT NULL,
    nombre        VARCHAR(50) NOT NULL,
    color         VARCHAR(20),
    UNIQUE (empresa_id, nombre),
    CONSTRAINT fk_disciplina_empresa FOREIGN KEY (empresa_id) REFERENCES EMPRESA(empresa_id)
);

CREATE TABLE MAQUINA (
    maquina_id    SERIAL PRIMARY KEY,
    planta_id     INT NOT NULL,
    disciplina_id INT,
    nombre        VARCHAR(100) NOT NULL,
    codigo        VARCHAR(50)  NOT NULL,
    UNIQUE (planta_id, codigo),
    CONSTRAINT fk_maquina_planta      FOREIGN KEY (planta_id)     REFERENCES PLANTA(planta_id),
    CONSTRAINT fk_maquina_disciplina  FOREIGN KEY (disciplina_id) REFERENCES DISCIPLINA(disciplina_id)
);

CREATE TABLE SENSOR (
    sensor_id  SERIAL PRIMARY KEY,
    maquina_id INT NOT NULL,
    nombre     VARCHAR(100) NOT NULL,
    codigo     VARCHAR(50)  UNIQUE NOT NULL,
    CONSTRAINT fk_sensor_maquina FOREIGN KEY (maquina_id) REFERENCES MAQUINA(maquina_id)
);

-- =============================================================================
-- TOPOLOGÍA
-- =============================================================================
--
-- Modelo del mapa interactivo de planta: zonas, nodos y sus conexiones.
--
CREATE TABLE TOPOLOGIA_ZONA (
    zona_id     SERIAL PRIMARY KEY,
    planta_id   INT NOT NULL,
    nombre      VARCHAR(120) NOT NULL,
    color       VARCHAR(20),
    descripcion VARCHAR(255),
    CONSTRAINT fk_zona_planta FOREIGN KEY (planta_id) REFERENCES PLANTA(planta_id)
);

CREATE TABLE TOPOLOGIA_NODO (
    nodo_id    SERIAL PRIMARY KEY,
    planta_id  INT NOT NULL,
    maquina_id INT,
    sensor_id  INT,
    tipo       tipo_nodo NOT NULL,
    nombre     VARCHAR(120) NOT NULL,
    categoria  VARCHAR(60),
    position_x DECIMAL(10,2) NOT NULL,
    position_y DECIMAL(10,2) NOT NULL,
    position_z DECIMAL(10,2),
    estado     estado_nodo NOT NULL DEFAULT 'operational',
    updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_nodo_planta   FOREIGN KEY (planta_id)  REFERENCES PLANTA(planta_id),
    CONSTRAINT fk_nodo_maquina  FOREIGN KEY (maquina_id) REFERENCES MAQUINA(maquina_id),
    CONSTRAINT fk_nodo_sensor   FOREIGN KEY (sensor_id)  REFERENCES SENSOR(sensor_id)
);

CREATE TABLE ZONA_NODO (
    zona_id INT NOT NULL,
    nodo_id INT NOT NULL,
    PRIMARY KEY (zona_id, nodo_id),
    CONSTRAINT fk_zn_zona FOREIGN KEY (zona_id) REFERENCES TOPOLOGIA_ZONA(zona_id) ON DELETE CASCADE,
    CONSTRAINT fk_zn_nodo FOREIGN KEY (nodo_id) REFERENCES TOPOLOGIA_NODO(nodo_id) ON DELETE CASCADE
);

CREATE TABLE TOPOLOGIA_CONEXION (
    conexion_id     SERIAL PRIMARY KEY,
    nodo_origen_id  INT NOT NULL,
    nodo_destino_id INT NOT NULL,
    tipo            tipo_conexion NOT NULL,
    label           VARCHAR(120),
    bidirectional   BOOLEAN NOT NULL DEFAULT FALSE,
    bandwidth       VARCHAR(40),
    strength        INT,
    estado          estado_conexion NOT NULL DEFAULT 'active',
    CONSTRAINT fk_conexion_origen  FOREIGN KEY (nodo_origen_id)  REFERENCES TOPOLOGIA_NODO(nodo_id) ON DELETE CASCADE,
    CONSTRAINT fk_conexion_destino FOREIGN KEY (nodo_destino_id) REFERENCES TOPOLOGIA_NODO(nodo_id) ON DELETE CASCADE
);

-- =============================================================================
-- DIAGNÓSTICO
-- =============================================================================
--
-- Sesiones de diagnóstico manual, auditoría de chat y del sistema.
--

-- SESION_DEBUG: sesiones de diagnóstico manual (herramienta Debug de BARB).
CREATE TABLE SESION_DEBUG (
    sesion_id    SERIAL PRIMARY KEY,
    empresa_id   INT         NOT NULL,
    maquina_id   INT         NOT NULL,
    tecnico_id   INT         NOT NULL,
    titulo       VARCHAR(200),
    observaciones TEXT,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sesion_empresa  FOREIGN KEY (empresa_id) REFERENCES EMPRESA(empresa_id),
    CONSTRAINT fk_sesion_maquina  FOREIGN KEY (maquina_id) REFERENCES MAQUINA(maquina_id),
    CONSTRAINT fk_sesion_tecnico  FOREIGN KEY (tecnico_id) REFERENCES USUARIO(usuario_id)
);

CREATE TABLE DIAGNOSTICO (
    diagnostico_id SERIAL PRIMARY KEY,
    sesion_id      INT NOT NULL,
    descripcion    TEXT NOT NULL,
    severidad      nivel_severidad NOT NULL,
    CONSTRAINT fk_diagnostico_sesion FOREIGN KEY (sesion_id) REFERENCES SESION_DEBUG(sesion_id)
);

-- CHAT_SESSION: conversaciones del DocChat guardadas, para auditar,
-- revisar y reutilizar como contexto RAG.
CREATE TABLE CHAT_SESSION (
    session_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id    INT          NOT NULL,
    titulo        VARCHAR(200) NOT NULL,
    saved_by      VARCHAR(100),                    -- nombre del usuario (desnormalizado para velocidad)
    usuario_id    INT,                             -- FK opcional (puede ser null si usuario fue eliminado)
    discipline    VARCHAR(100),
    plant_id      VARCHAR(40),
    plant_name    VARCHAR(120),
    machine_id    VARCHAR(40),
    machine_name  VARCHAR(120),
    active_manual VARCHAR(255),
    messages      JSONB        NOT NULL,           -- [{role, content, timestamp}]
    metadata      JSONB,                           -- {lang, message_count, ot_context, ...}
    saved_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_chat_session_empresa  FOREIGN KEY (empresa_id) REFERENCES EMPRESA(empresa_id),
    CONSTRAINT fk_chat_session_usuario  FOREIGN KEY (usuario_id) REFERENCES USUARIO(usuario_id) ON DELETE SET NULL
);

-- Índices para búsquedas frecuentes en la sección Debug
CREATE INDEX idx_chat_session_empresa     ON CHAT_SESSION(empresa_id);
CREATE INDEX idx_chat_session_discipline  ON CHAT_SESSION(empresa_id, discipline);
CREATE INDEX idx_chat_session_machine     ON CHAT_SESSION(empresa_id, machine_id);
CREATE INDEX idx_chat_session_saved_at    ON CHAT_SESSION(saved_at DESC);
CREATE INDEX idx_chat_session_usuario     ON CHAT_SESSION(usuario_id);

-- SYSTEM_AUDIT_LOG: auditoría completa de las acciones del sistema (quién
-- hizo qué, cuándo, desde dónde y sobre qué entidad).
CREATE TABLE SYSTEM_AUDIT_LOG (
    audit_id      BIGSERIAL    PRIMARY KEY,
    empresa_id    INT          NOT NULL,
    usuario_id    INT,                             -- NULL si acción de sistema/anónima
    usuario_nombre VARCHAR(100),                   -- desnormalizado para historial inmutable
    usuario_rol   VARCHAR(50),
    accion        accion_audit NOT NULL,
    modulo        VARCHAR(60)  NOT NULL,           -- 'OT', 'DocChat', 'Reporte', 'Usuario', etc.
    entidad_tipo  VARCHAR(60),                     -- nombre de la tabla/recurso afectado
    entidad_id    VARCHAR(80),                     -- ID del registro afectado (string para flexibilidad)
    descripcion   TEXT,                            -- resumen legible de la acción
    datos_antes   JSONB,                           -- snapshot del registro antes del cambio
    datos_despues JSONB,                           -- snapshot del registro después del cambio
    ip_address    VARCHAR(45),                     -- IPv4 o IPv6
    user_agent    TEXT,
    endpoint      VARCHAR(255),                    -- ruta del API llamada
    duracion_ms   INT,                             -- tiempo de respuesta
    exitoso       BOOLEAN      NOT NULL DEFAULT TRUE,
    error_detalle TEXT,                            -- mensaje de error si exitoso=false
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_audit_empresa  FOREIGN KEY (empresa_id) REFERENCES EMPRESA(empresa_id),
    CONSTRAINT fk_audit_usuario  FOREIGN KEY (usuario_id) REFERENCES USUARIO(usuario_id) ON DELETE SET NULL
);

-- Índices para consultas de auditoría (panel Debug)
CREATE INDEX idx_audit_empresa_ts       ON SYSTEM_AUDIT_LOG(empresa_id, timestamp DESC);
CREATE INDEX idx_audit_usuario          ON SYSTEM_AUDIT_LOG(usuario_id, timestamp DESC);
CREATE INDEX idx_audit_accion           ON SYSTEM_AUDIT_LOG(empresa_id, accion);
CREATE INDEX idx_audit_modulo           ON SYSTEM_AUDIT_LOG(empresa_id, modulo);
CREATE INDEX idx_audit_entidad          ON SYSTEM_AUDIT_LOG(entidad_tipo, entidad_id);
CREATE INDEX idx_audit_timestamp        ON SYSTEM_AUDIT_LOG(timestamp DESC);

-- =============================================================================
-- GESTIÓN Y OPERACIÓN
-- =============================================================================
--
-- Órdenes de trabajo, reportes de sesión y evidencia fotográfica asociada.
--
CREATE TABLE REPORTE (
    reporte_id       SERIAL PRIMARY KEY,
    report_number    VARCHAR(40) UNIQUE NOT NULL,
    sesion_id        INT,
    diagnostico_id   INT,
    maquina_id       INT NOT NULL,
    tecnico_id       INT NOT NULL,
    summary          TEXT,
    issue_description TEXT NOT NULL,
    resolution       TEXT,
    actions_taken    JSONB,
    additional_notes TEXT,
    severity         nivel_severidad NOT NULL,
    downtime_minutes INT,
    pdf_url          VARCHAR(500),
    repository_url   VARCHAR(500),
    estado           estado_reporte NOT NULL DEFAULT 'draft',
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uploaded_at      TIMESTAMP,
    approved_by      INT,
    CONSTRAINT fk_reporte_sesion    FOREIGN KEY (sesion_id)      REFERENCES SESION_DEBUG(sesion_id),
    CONSTRAINT fk_reporte_diag      FOREIGN KEY (diagnostico_id) REFERENCES DIAGNOSTICO(diagnostico_id),
    CONSTRAINT fk_reporte_maquina   FOREIGN KEY (maquina_id)     REFERENCES MAQUINA(maquina_id),
    CONSTRAINT fk_reporte_tecnico   FOREIGN KEY (tecnico_id)     REFERENCES USUARIO(usuario_id),
    CONSTRAINT fk_reporte_aprobador FOREIGN KEY (approved_by)    REFERENCES USUARIO(usuario_id)
);

CREATE TABLE ORDEN_TRABAJO (
    ot_id                 SERIAL PRIMARY KEY,
    numero_ot             VARCHAR(40) UNIQUE NOT NULL,
    maquina_id            INT NOT NULL,
    tecnico_id            INT NOT NULL,
    creado_por            INT NOT NULL,
    diagnostico_id        INT,
    reporte_id            INT,
    tipo                  tipo_mantenimiento NOT NULL,
    descripcion_problema  TEXT,
    descripcion_reparacion TEXT,
    resolution            TEXT,
    priority              prioridad_ot NOT NULL,
    severity              nivel_severidad,
    fecha_creacion        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_inicio          TIMESTAMP,
    fecha_cierre          TIMESTAMP,
    fecha_vencimiento     TIMESTAMP,
    tiempo_reparacion_min INT,
    downtime_minutes      INT,
    costo_estimado        DECIMAL(12,2),
    costo_real            DECIMAL(12,2),
    estado                estado_ot NOT NULL DEFAULT 'pending',
    CONSTRAINT fk_ot_maquina     FOREIGN KEY (maquina_id)     REFERENCES MAQUINA(maquina_id),
    CONSTRAINT fk_ot_tecnico     FOREIGN KEY (tecnico_id)     REFERENCES USUARIO(usuario_id),
    CONSTRAINT fk_ot_creador     FOREIGN KEY (creado_por)     REFERENCES USUARIO(usuario_id),
    CONSTRAINT fk_ot_diagnostico FOREIGN KEY (diagnostico_id) REFERENCES DIAGNOSTICO(diagnostico_id),
    CONSTRAINT fk_ot_reporte     FOREIGN KEY (reporte_id)     REFERENCES REPORTE(reporte_id)
);

CREATE TABLE OT_FOTO (
    ot_foto_id    SERIAL PRIMARY KEY,
    ot_id         INT NOT NULL,
    file_name     VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    content_type  VARCHAR(100) NOT NULL,
    file_path     VARCHAR(500) NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ot_foto_ot FOREIGN KEY (ot_id) REFERENCES ORDEN_TRABAJO(ot_id) ON DELETE CASCADE
);

-- =============================================================================
-- PLANIFICACIÓN PREVENTIVA
-- =============================================================================
--
-- Programas de mantenimiento y el registro de sus ejecuciones.
--
CREATE TABLE PROGRAMA_MANTENIMIENTO (
    programa_id           SERIAL PRIMARY KEY,
    maquina_id            INT NOT NULL,
    creado_por            INT NOT NULL,
    nombre                VARCHAR(150) NOT NULL,
    descripcion           TEXT,
    instrucciones         TEXT,
    frecuencia            frecuencia_mant NOT NULL,
    intervalo_dias        INT,
    priority              prioridad_mant NOT NULL,
    duracion_estimada_min INT,
    costo_estimado        DECIMAL(12,2),
    fecha_inicio          DATE NOT NULL,
    proxima_ejecucion     TIMESTAMP,
    ultima_ejecucion      TIMESTAMP,
    estado                estado_programa NOT NULL DEFAULT 'active',
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_prog_maquina  FOREIGN KEY (maquina_id) REFERENCES MAQUINA(maquina_id),
    CONSTRAINT fk_prog_usuario  FOREIGN KEY (creado_por) REFERENCES USUARIO(usuario_id)
);

CREATE TABLE EJECUCION_PROGRAMA (
    ejecucion_id    SERIAL PRIMARY KEY,
    programa_id     INT NOT NULL,
    ot_id           INT,
    tecnico_id      INT,
    fecha_programada TIMESTAMP NOT NULL,
    fecha_ejecutada  TIMESTAMP,
    estado           estado_ejecucion NOT NULL DEFAULT 'scheduled',
    notes            TEXT,
    CONSTRAINT fk_ejec_programa FOREIGN KEY (programa_id) REFERENCES PROGRAMA_MANTENIMIENTO(programa_id) ON DELETE CASCADE,
    CONSTRAINT fk_ejec_ot       FOREIGN KEY (ot_id)       REFERENCES ORDEN_TRABAJO(ot_id),
    CONSTRAINT fk_ejec_tecnico  FOREIGN KEY (tecnico_id)  REFERENCES USUARIO(usuario_id)
);

-- =============================================================================
-- CONSUMO Y TRAZABILIDAD
-- =============================================================================
--
-- Registro de repuestos consumidos por orden de trabajo, auditoría de
-- cambios de estado y lecturas de sensores.
--
CREATE TABLE OT_REPUESTO (
    ot_repuesto_id SERIAL PRIMARY KEY,
    ot_id          INT NOT NULL,
    repuesto_id    INT NOT NULL,
    cantidad       DECIMAL(10,2) NOT NULL,
    costo_unitario DECIMAL(12,2),
    notas          VARCHAR(255),
    fecha_uso      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ot_repuesto_ot   FOREIGN KEY (ot_id)       REFERENCES ORDEN_TRABAJO(ot_id) ON DELETE CASCADE,
    CONSTRAINT fk_ot_repuesto_item FOREIGN KEY (repuesto_id) REFERENCES REPUESTO(repuesto_id)
);

CREATE TABLE OT_AUDIT_LOG (
    audit_id       SERIAL PRIMARY KEY,
    ot_id          INT NOT NULL,
    usuario_id     INT NOT NULL,
    estado_anterior VARCHAR(40),
    estado_nuevo   VARCHAR(40) NOT NULL,
    comentario     VARCHAR(500),
    timestamp      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_ot      FOREIGN KEY (ot_id)      REFERENCES ORDEN_TRABAJO(ot_id) ON DELETE CASCADE,
    CONSTRAINT fk_audit_usuario FOREIGN KEY (usuario_id) REFERENCES USUARIO(usuario_id)
);

CREATE TABLE LECTURA_SENSOR (
    lectura_id SERIAL PRIMARY KEY,
    sensor_id  INT NOT NULL,
    valor      DECIMAL(14,4) NOT NULL,
    timestamp  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado     estado_lectura NOT NULL DEFAULT 'normal',
    CONSTRAINT fk_lectura_sensor FOREIGN KEY (sensor_id) REFERENCES SENSOR(sensor_id) ON DELETE CASCADE
);

'''

_DDL_DOWN = r'''
DROP TABLE IF EXISTS lectura_sensor CASCADE;
DROP TABLE IF EXISTS ot_audit_log CASCADE;
DROP TABLE IF EXISTS ot_repuesto CASCADE;
DROP TABLE IF EXISTS ejecucion_programa CASCADE;
DROP TABLE IF EXISTS programa_mantenimiento CASCADE;
DROP TABLE IF EXISTS ot_foto CASCADE;
DROP TABLE IF EXISTS orden_trabajo CASCADE;
DROP TABLE IF EXISTS reporte CASCADE;
DROP TABLE IF EXISTS system_audit_log CASCADE;
DROP TABLE IF EXISTS chat_session CASCADE;
DROP TABLE IF EXISTS diagnostico CASCADE;
DROP TABLE IF EXISTS sesion_debug CASCADE;
DROP TABLE IF EXISTS zona_nodo CASCADE;
DROP TABLE IF EXISTS topologia_conexion CASCADE;
DROP TABLE IF EXISTS topologia_nodo CASCADE;
DROP TABLE IF EXISTS topologia_zona CASCADE;
DROP TABLE IF EXISTS sensor CASCADE;
DROP TABLE IF EXISTS maquina CASCADE;
DROP TABLE IF EXISTS disciplina CASCADE;
DROP TABLE IF EXISTS repuesto CASCADE;
DROP TABLE IF EXISTS planta CASCADE;
DROP TABLE IF EXISTS usuario CASCADE;
DROP TABLE IF EXISTS empresa CASCADE;

DROP TYPE IF EXISTS accion_audit;
DROP TYPE IF EXISTS estado_empresa;
DROP TYPE IF EXISTS plan_empresa;
DROP TYPE IF EXISTS estado_lectura;
DROP TYPE IF EXISTS estado_ejecucion;
DROP TYPE IF EXISTS estado_programa;
DROP TYPE IF EXISTS prioridad_mant;
DROP TYPE IF EXISTS frecuencia_mant;
DROP TYPE IF EXISTS estado_conexion;
DROP TYPE IF EXISTS tipo_conexion;
DROP TYPE IF EXISTS estado_nodo;
DROP TYPE IF EXISTS tipo_nodo;
DROP TYPE IF EXISTS estado_repuesto;
DROP TYPE IF EXISTS estado_ot;
DROP TYPE IF EXISTS prioridad_ot;
DROP TYPE IF EXISTS tipo_mantenimiento;
DROP TYPE IF EXISTS estado_reporte;
DROP TYPE IF EXISTS nivel_severidad;
'''


def upgrade() -> None:
    op.execute(_DDL_UP)


def downgrade() -> None:
    op.execute(_DDL_DOWN)
