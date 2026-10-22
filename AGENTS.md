# AGENTS.md

Reglas del repositorio para agentes y colaboradores. Aplican a todo el monorepo;
`frontend/AGENTS.md` añade las convenciones específicas de Angular.

## Base de datos

**REGLA DE BASE DE DATOS: Por decisión del equipo, queda prohibido crear nuevas migraciones o modificar el esquema de la base de datos. Cualquier cambio estructural debe ser autorizado y gestionado por JP.**

Alcance de la regla:

- **No se crean migraciones nuevas** en `backend/migrations/versions/`, ni siquiera
  aditivas (`ADD COLUMN`, `CREATE INDEX`, `UNIQUE`). Que una migración no borre datos no la
  hace aceptable: el problema es el orden de aplicación frente a la base heredada.
- **No se modifica el esquema por ningún otro medio**: SQL manual, `CREATE TABLE` en código,
  `ALTER` fuera de una migración, ni escrituras sobre `alembic_version`.
- **Las tablas nuevas tampoco**: no se diseñan ni se mergean sin pasar antes por JP.
- Si una funcionalidad necesita un cambio estructural, se **propone a JP** con el cambio, su
  justificación y el impacto sobre la base heredada. No se implementa "de paso" en un PR.

### Por qué

La base de producción (Supabase) **no está al día con `main`**. Su `alembic_version` quedó en
`0007_tickets_conversacionales` y le faltan `0007_auditoria_cambios`, `0008_transacciones`,
`0009_transacciones_triggers` y `0010_merge_heads` — trabajo previo ya mergeado en el repo, de
otros autores. Cualquier migración nueva hereda esa deuda y queda "atrasada" respecto de
producción, que es exactamente lo que bloqueó el PR #36.

### Estado conocido del entorno local

El 2026-10-21 se aplicó en una base **local (Docker)** la migración
`0011_planta_activa_unica`, que después se eliminó del repo por esta regla. Consecuencia:

- La base local conserva la columna `planta.activa` y la fila `0011_planta_activa_unica` en
  `alembic_version`.
- Como el archivo de la migración ya no existe, **`alembic current` y `alembic upgrade`
  fallan en local** con `Can't locate revision identified by '0011_planta_activa_unica'`.
- **No se corrige con comandos de base de datos.** Queda así por decisión del equipo hasta
  que JP defina qué hacer con esa base. No "arreglar" el `alembic_version` a mano, ni
  recrear la migración para tapar el error.
- El código y los tests **no dependen** de esa columna: no la consultan ni la escriben.

### Cosas útiles de saber antes de tocar migraciones

- `alembic_version.version_num` es `VARCHAR(32)`: un id de revisión más largo rompe el
  `upgrade` al registrar la versión.
- El despliegue (`render.yaml`, `autoDeploy: true`) **no ejecuta `alembic upgrade`**: el
  `buildCommand` sólo instala dependencias y el `startCommand` sólo levanta uvicorn. Mergear
  una migración no la aplica, pero deja el código adelantado respecto del esquema.
