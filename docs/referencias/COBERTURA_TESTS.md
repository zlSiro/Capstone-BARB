# Cobertura de tests del backend (HU-14)

Reporte de cobertura (`pytest-cov`, con ramas) de `backend/src/barb`, segmentado por los tres flujos críticos definidos por Alloxentric: **Autenticación**, **OTs** y **Métricas**. Solo backend; solo procedimiento local (sin CI ni umbral mínimo).

> El reporte mide **qué código ejecutan los tests**, no si las reglas están bien validadas. Un 100 % en `permissions.py` no prueba que cada rol tenga el privilegio correcto.

---

## Requisitos

- Docker (BD `pgvector/pgvector:pg17`) y [`uv`](https://docs.astral.sh/uv/).
- Los tests corren contra **Postgres real** (no SQLite) usando `DATABASE_URL` de `backend/.env`. Orden obligatorio: **BD → migraciones → seed → tests**. Sin seed los tests fallan en masa y la cobertura sale falsamente baja.

## Procedimiento en entorno limpio

Verificado desde un clon fresco con BD Docker vacía.

```bash
git clone <repo> && cd Capstone-BARB

# 1. Variables de entorno (.env no viene en el clon; con la plantilla basta para BD local)
cp backend/.env.example backend/.env

# 2. BD vacía
docker compose down -v          # ⚠ borra el volumen de la BD local
docker compose up -d db         # esperar estado "healthy"

# 3. Dependencias, migraciones y datos semilla
cd backend
uv sync
uv run alembic upgrade head     # head: 0015_eliminar_estado_demo
uv run python scripts/seed.py   # incluye el historial sintético; no requiere seed_history aparte
```

> ⚠ `docker-compose.yml` fija `container_name: barb_capstone_postgres` y el puerto `5432`. Si ya tienes la BD de desarrollo levantada, el `up` falla por conflicto de nombre. `down -v` en la carpeta del proyecto **borra tu BD de desarrollo**. Para no perderla, renombra su contenedor (`docker rename`) o párala sin `-v` antes de probar.

## Comando único

Desde `backend/`:

```bash
uv run pytest --cov --cov-report=term-missing --cov-report=html --cov-report=xml --cov-report=json
uv run python scripts/coverage_flujos.py
```

`pytest` sale con código distinto de 0 si algún test falla, pero **el reporte se genera igual**. La configuración (`source = ["src/barb"]`, `branch = true`) vive en `[tool.coverage.*]` de `backend/pyproject.toml`; `--cov` solo no necesita más flags.

Artefactos (todos en `.gitignore`):

| Archivo | Uso |
|---|---|
| `backend/htmlcov/index.html` | Reporte navegable por archivo (líneas no cubiertas resaltadas) |
| `backend/coverage.xml` | Formato Cobertura, para herramientas externas |
| `backend/coverage.json` | Entrada de `coverage_flujos.py` |
| `backend/.coverage` | Datos crudos de `coverage` |

## Cómo leer el reporte

- **HTML:** abrir `htmlcov/index.html`; columna *missing* = líneas sin ejecutar, `a->b` = rama no tomada.
- **Tabla por flujo:** `scripts/coverage_flujos.py` suma líneas y ramas de los módulos de cada flujo. El **TOTAL** es el de todo `src/barb`, no la suma de los tres flujos.
- El script avisa (código de salida 2) si un archivo del mapeo no existe en el repo o no aparece en `coverage.json`. El mapeo `FLUJOS` está versionado en el script (quitar `avisos.py` del flujo OTs es un cambio de una línea).

| Flujo | Módulos | Tests que lo ejercitan |
|---|---|---|
| Autenticación | `routers/auth.py`, `core/permissions.py`, `core/security.py` | `test_auth.py`, `test_permissions.py` |
| OTs | `routers/work_orders.py`, `core/work_order_states.py`, `routers/avisos.py`, `schemas/work_orders.py` | `test_work_orders_create.py`, `test_work_orders_status.py`, `test_work_orders_asignacion.py`, `test_work_order_states.py`, `test_crear_ot.py`, `test_candado_ot.py`, `test_sla_prioridad.py`, `test_avisos.py` |
| Métricas | `routers/stats.py` | `test_stats_*.py` |

## Resultado de referencia

Clon fresco, BD vacía + migraciones + seed, `.env` = `.env.example` (2026-11-09). **47 failed, 740 passed.**

| Flujo | Líneas | Ramas |
|---|---|---|
| Autenticación | 88.8 % (127/143) | 75.0 % (33/44) |
| OTs | 84.4 % (410/486) | 80.5 % (95/118) |
| Métricas | 81.8 % (171/209) | 79.2 % (38/48) |
| **TOTAL `src/barb`** | **81.5 %** (3089/3790) | **70.6 %** (655/928) |

Con un `.env` completo (keys de LLM / multimodal) y BD de desarrollo: 24 failed + 14 errors, TOTAL 82.7 % líneas / 71.2 % ramas. El número exacto depende de la configuración y del estado de la BD.

## Huecos observados

**Baja cobertura / líneas sin ejecutar** (de `term-missing`):

- `core/security.py` 68 %: líneas 20-22, 55, 61-65.
- `routers/work_orders.py` 79 %: 227-229, 417-422, 438-465, 700-716 entre otros.
- `routers/stats.py` 81 %: 174-258 (bloque completo sin ejecutar) y 149-153. Los tests que debían cubrirlo (`test_stats_historico.py`) fallan, ver abajo.
- `routers/auth.py` 81 %: 69-72. `routers/avisos.py` 86 %: 255-260, 402-406 entre otros.
- Fuera de los tres flujos, más bajos: `services/email_service.py` ~30 %, `services/files.py` 37 %, `services/llm_service.py` 55 %.

**Tests que fallan** (clon fresco; no se corrigen en este spec):

| Tests | Fallos | Causa |
|---|---|---|
| `test_chat_multimedia.py` | 23 | 503 `MULTIMODAL_MODEL` no configurado: `.env.example` no trae `NVIDIA_MULTIMODAL_API_KEY`. Dependen de configuración, no del código. |
| `test_stats_historico.py` | 11 | 403 `El rol 'admin' no tiene acceso a 'dashboard'`: el test usa un rol que la matriz RBAC ya no permite. |
| `test_transacciones.py`, `test_transacciones_empresa.py` | 7 + 1 | `KeyError: 'items'`: el contrato de respuesta cambió respecto al test. En la BD de desarrollo (con datos acumulados) además hubo 14 errors de `psycopg.errors` en estos mismos archivos; causa no investigada. |
| `test_seed_history.py` | 2 | Volumen esperado `>= 380` filas; el seed genera 379. |
| `test_maquinas_edicion.py::test_no_edita_una_maquina_de_otra_empresa` | 1 | 403 `El rol 'supervisor' no tiene acceso a 'plantas'` (esperaba 404). |
| `test_multiempresa.py::test_super_crea_edita_suspende_y_elimina_empresa_con_gerente_inicial` | 1 | 409 en lugar de 204: las empresas ya no se eliminan. |
| `test_skills_topologia.py::test_el_grafo_cambia_parametros_con_confirmacion` | 1 | Falla en la corrida completa y pasa aislado; causa no determinada (orden/estado). |

Los fallos de `test_stats_historico.py` bajan la cobertura de Métricas: el reporte subestima lo que cubrirían tests correctos.

## Qué adjuntar a la HU-14 (Jira)

1. `htmlcov/` comprimido (o `index.html`).
2. Salida de `uv run python scripts/coverage_flujos.py`.

## Fuera de alcance

Frontend (vitest), CI/GitHub Actions, umbral `--cov-fail-under`, tests nuevos o arreglo de los existentes, BD efímera (`testcontainers`).
