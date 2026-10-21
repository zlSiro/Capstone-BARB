# AGENTS.md

Reglas del repositorio para agentes y colaboradores. Aplican a todo el monorepo;
`frontend/AGENTS.md` añade las convenciones específicas de Angular.

## Base de datos

**REGLA DE BASE DE DATOS: No crear nuevos campos o atributos en las tablas existentes sin autorización explícita de JP, debido a que la base de datos es heredada.**

Alcance de la regla:

- Aplica a **cualquier** cambio de esquema sobre tablas que ya existen: columnas nuevas,
  cambios de tipo, `NOT NULL`, defaults, constraints (`UNIQUE`, `FOREIGN KEY`, `CHECK`) e
  índices sobre tablas pobladas.
- No aplica a tablas nuevas: esas se diseñan y se revisan en su propia migración, sin tocar
  lo que ya está.
- Toda migración que toque una tabla existente necesita el visto bueno de JP **antes** de
  mergearse a `main`, con el cambio descrito y su justificación en la HU correspondiente.

### Antes de escribir una migración

- Confirmar que el número de revisión está libre (`alembic heads` y las ramas abiertas).
- Recordar que `alembic_version.version_num` es `VARCHAR(32)`: el id de la revisión no puede
  pasar de 32 caracteres o el `upgrade` falla al registrar la versión.
- Las migraciones **no se aplican solas**: `render.yaml` despliega la API con
  `autoDeploy: true`, pero ningún paso del pipeline ejecuta `alembic upgrade head`. Mergear
  una migración sin aplicarla deja el código adelantado respecto del esquema y las consultas
  que usan las columnas nuevas fallan en producción.
