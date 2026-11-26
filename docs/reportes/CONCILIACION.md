# Conciliación del módulo «Reportes»

Corrida: 2026-11-26 11:18 · API http://localhost:9000 · base local · empresa 71 (ids de planta/disciplina/máquina tomados del catálogo de esa empresa).

**Resultado: 459 de 459 cifras cuadran** (app = API = base de datos).

Cada fila compara tres números: **app** (la cifra que muestra el reporte, calculada con un espejo exacto de las funciones puras del frontend sobre lo que entregó la API), **API** (lo que entrega el backend) y **BD** (consulta SQL de solo lectura con los predicados de `stats.py`, `work_orders.py` y `avisos.py`). «—» = esa columna no aplica a la métrica. Enteros exactos; montos al centavo; promedios y porcentajes a 1 decimal.

Se concilian las 6 combinaciones de filtros: (1) histórico sin filtros, (2) 30 días + una planta, (3) 365 días + planta + disciplina + máquina, (4) combinación sin filas, (5) una planta de otra empresa (el backend responde 404 y el reporte lo explica) y (6) un usuario de otra empresa, que nunca ve datos de la primera.

## Cómo reproducirla

```bash
docker compose up -d db
cd backend && uv run alembic upgrade heads && uv run python scripts/seed.py
uv run fastapi dev src/barb/main.py --port 9000        # en otra terminal
# desde la raíz del repo, con una variable «correo:clave» por perfil (las credenciales de demo están en el encabezado de backend/seeds/02_maestros.sql)
export BARB_CRED_SUPERVISOR=... BARB_CRED_ENGINEER=... BARB_CRED_GERENTE=... BARB_CRED_ADMIN=... BARB_CRED_OPERADOR=... BARB_CRED_TECNICO=...
export BARB_CRED_OTRA_EMPRESA=...                      # un gerente de OTRA empresa
uv run --project backend python tools/conciliacion-reportes/conciliar.py
```

## R1

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| supervisor | 1. Histórico, sin filtros | OT del periodo (total) | 192 | 192 | 192 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT completadas | 165 | 165 | 165 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT en_curso | 4 | 4 | 4 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT pendientes | 4 | 4 | 4 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT por_validar | 13 | 13 | 13 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT canceladas | 6 | 6 | 6 | ✓ |
| supervisor | 1. Histórico, sin filtros | Cumplimiento de SLA (%) | 93.9 | 93.9 | 93.9 | ✓ |
| supervisor | 1. Histórico, sin filtros | MTTR (min) | 389.1 | 389.1 | 389.12 | ✓ |
| supervisor | 1. Histórico, sin filtros | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 94.5 | 94.5 | 94.5 | ✓ |
| supervisor | 1. Histórico, sin filtros | MTBF (h) | 362.4 | 362.4 | 362.4 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT estancadas vencidas (foto del momento) | 19 | 19 | 19 | ✓ |
| engineer | 1. Histórico, sin filtros | OT del periodo (total) | 192 | 192 | 192 | ✓ |
| engineer | 1. Histórico, sin filtros | OT completadas | 165 | 165 | 165 | ✓ |
| engineer | 1. Histórico, sin filtros | OT en_curso | 4 | 4 | 4 | ✓ |
| engineer | 1. Histórico, sin filtros | OT pendientes | 4 | 4 | 4 | ✓ |
| engineer | 1. Histórico, sin filtros | OT por_validar | 13 | 13 | 13 | ✓ |
| engineer | 1. Histórico, sin filtros | OT canceladas | 6 | 6 | 6 | ✓ |
| engineer | 1. Histórico, sin filtros | Cumplimiento de SLA (%) | 93.9 | 93.9 | 93.9 | ✓ |
| engineer | 1. Histórico, sin filtros | MTTR (min) | 389.1 | 389.1 | 389.12 | ✓ |
| engineer | 1. Histórico, sin filtros | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 94.5 | 94.5 | 94.5 | ✓ |
| engineer | 1. Histórico, sin filtros | MTBF (h) | 362.4 | 362.4 | 362.4 | ✓ |
| engineer | 1. Histórico, sin filtros | OT estancadas vencidas (foto del momento) | 19 | 19 | 19 | ✓ |
| gerente | 1. Histórico, sin filtros | OT del periodo (total) | 192 | 192 | 192 | ✓ |
| gerente | 1. Histórico, sin filtros | OT completadas | 165 | 165 | 165 | ✓ |
| gerente | 1. Histórico, sin filtros | OT en_curso | 4 | 4 | 4 | ✓ |
| gerente | 1. Histórico, sin filtros | OT pendientes | 4 | 4 | 4 | ✓ |
| gerente | 1. Histórico, sin filtros | OT por_validar | 13 | 13 | 13 | ✓ |
| gerente | 1. Histórico, sin filtros | OT canceladas | 6 | 6 | 6 | ✓ |
| gerente | 1. Histórico, sin filtros | Cumplimiento de SLA (%) | 93.9 | 93.9 | 93.9 | ✓ |
| gerente | 1. Histórico, sin filtros | MTTR (min) | 389.1 | 389.1 | 389.12 | ✓ |
| gerente | 1. Histórico, sin filtros | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 94.5 | 94.5 | 94.5 | ✓ |
| gerente | 1. Histórico, sin filtros | MTBF (h) | 362.4 | 362.4 | 362.4 | ✓ |
| gerente | 1. Histórico, sin filtros | OT estancadas vencidas (foto del momento) | 19 | 19 | 19 | ✓ |
| supervisor | 2. 30 días + una planta | OT del periodo (total) | 4 | 4 | 4 | ✓ |
| supervisor | 2. 30 días + una planta | OT completadas | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | OT en_curso | 2 | 2 | 2 | ✓ |
| supervisor | 2. 30 días + una planta | OT pendientes | 2 | 2 | 2 | ✓ |
| supervisor | 2. 30 días + una planta | OT por_validar | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | OT canceladas | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Cumplimiento de SLA (%) | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | MTTR (min) | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 100 | 100 | 100 | ✓ |
| supervisor | 2. 30 días + una planta | MTBF oculto (mtbf_visible=false con days<365) (el reporte rotula el motivo) | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | OT estancadas vencidas (foto del momento) | 10 | 10 | 10 | ✓ |
| engineer | 2. 30 días + una planta | OT del periodo (total) | 4 | 4 | 4 | ✓ |
| engineer | 2. 30 días + una planta | OT completadas | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | OT en_curso | 2 | 2 | 2 | ✓ |
| engineer | 2. 30 días + una planta | OT pendientes | 2 | 2 | 2 | ✓ |
| engineer | 2. 30 días + una planta | OT por_validar | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | OT canceladas | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | Cumplimiento de SLA (%) | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | MTTR (min) | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 100 | 100 | 100 | ✓ |
| engineer | 2. 30 días + una planta | MTBF oculto (mtbf_visible=false con days<365) (el reporte rotula el motivo) | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | OT estancadas vencidas (foto del momento) | 10 | 10 | 10 | ✓ |
| gerente | 2. 30 días + una planta | OT del periodo (total) | 4 | 4 | 4 | ✓ |
| gerente | 2. 30 días + una planta | OT completadas | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | OT en_curso | 2 | 2 | 2 | ✓ |
| gerente | 2. 30 días + una planta | OT pendientes | 2 | 2 | 2 | ✓ |
| gerente | 2. 30 días + una planta | OT por_validar | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | OT canceladas | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | Cumplimiento de SLA (%) | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | MTTR (min) | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 100 | 100 | 100 | ✓ |
| gerente | 2. 30 días + una planta | MTBF oculto (mtbf_visible=false con days<365) (el reporte rotula el motivo) | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | OT estancadas vencidas (foto del momento) | 10 | 10 | 10 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT del periodo (total) | 24 | 24 | 24 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT completadas | 18 | 18 | 18 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT en_curso | 1 | 1 | 1 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT pendientes | 1 | 1 | 1 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT por_validar | 3 | 3 | 3 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT canceladas | 1 | 1 | 1 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Cumplimiento de SLA (%) | 94.4 | 94.4 | 94.4 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | MTTR (min) | 317.3 | 317.3 | 317.33 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 99.5 | 99.5 | 99.5 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | MTBF (h) | 1458 | 1458 | 1458 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT estancadas vencidas (foto del momento) | 5 | 5 | 5 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT del periodo (total) | 24 | 24 | 24 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT completadas | 18 | 18 | 18 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT en_curso | 1 | 1 | 1 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT pendientes | 1 | 1 | 1 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT por_validar | 3 | 3 | 3 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT canceladas | 1 | 1 | 1 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | Cumplimiento de SLA (%) | 94.4 | 94.4 | 94.4 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | MTTR (min) | 317.3 | 317.3 | 317.33 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 99.5 | 99.5 | 99.5 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | MTBF (h) | 1458 | 1458 | 1458 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT estancadas vencidas (foto del momento) | 5 | 5 | 5 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT del periodo (total) | 24 | 24 | 24 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT completadas | 18 | 18 | 18 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT en_curso | 1 | 1 | 1 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT pendientes | 1 | 1 | 1 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT por_validar | 3 | 3 | 3 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT canceladas | 1 | 1 | 1 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Cumplimiento de SLA (%) | 94.4 | 94.4 | 94.4 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | MTTR (min) | 317.3 | 317.3 | 317.33 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 99.5 | 99.5 | 99.5 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | MTBF (h) | 1458 | 1458 | 1458 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT estancadas vencidas (foto del momento) | 5 | 5 | 5 | ✓ |
| supervisor | 4. Combinación sin filas | OT del periodo (total) | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT completadas | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT en_curso | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT pendientes | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT por_validar | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT canceladas | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Cumplimiento de SLA (%) | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | MTTR (min) | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 100 | 100 | 100 | ✓ |
| supervisor | 4. Combinación sin filas | OT estancadas vencidas (foto del momento) | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT del periodo (total) | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT completadas | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT en_curso | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT pendientes | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT por_validar | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT canceladas | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | Cumplimiento de SLA (%) | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | MTTR (min) | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 100 | 100 | 100 | ✓ |
| engineer | 4. Combinación sin filas | OT estancadas vencidas (foto del momento) | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT del periodo (total) | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT completadas | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT en_curso | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT pendientes | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT por_validar | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT canceladas | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | Cumplimiento de SLA (%) | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | MTTR (min) | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | Disponibilidad de planta (%) (denominador = días del periodo (365 si es histórico)) | 100 | 100 | 100 | ✓ |
| gerente | 4. Combinación sin filas | OT estancadas vencidas (foto del momento) | 0 | 0 | 0 | ✓ |
| supervisor | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| engineer | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| gerente | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| otra empresa | 6. Usuario de otra empresa | HTTP de financial-impact con una planta ajena (esperado 404) | 404 | 404 | 404 | ✓ |

## R2

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| supervisor | 1. Histórico, sin filtros | Σ OT de todos los periodos | 192 | 192 | 192 | ✓ |
| supervisor | 1. Histórico, sin filtros | Σ OT completadas de todos los periodos | 165 | 165 | 165 | ✓ |
| supervisor | 1. Histórico, sin filtros | Periodos (mes) cuyo total de OT coincide | 24 | 24 | 24 | ✓ |
| engineer | 1. Histórico, sin filtros | Σ OT de todos los periodos | 192 | 192 | 192 | ✓ |
| engineer | 1. Histórico, sin filtros | Σ OT completadas de todos los periodos | 165 | 165 | 165 | ✓ |
| engineer | 1. Histórico, sin filtros | Periodos (mes) cuyo total de OT coincide | 24 | 24 | 24 | ✓ |
| gerente | 1. Histórico, sin filtros | Σ OT de todos los periodos | 192 | 192 | 192 | ✓ |
| gerente | 1. Histórico, sin filtros | Σ OT completadas de todos los periodos | 165 | 165 | 165 | ✓ |
| gerente | 1. Histórico, sin filtros | Periodos (mes) cuyo total de OT coincide | 24 | 24 | 24 | ✓ |
| supervisor | 2. 30 días + una planta | Σ OT de todos los periodos | 4 | 4 | 4 | ✓ |
| supervisor | 2. 30 días + una planta | Σ OT completadas de todos los periodos | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Periodos (mes) cuyo total de OT coincide | 1 | 1 | 1 | ✓ |
| engineer | 2. 30 días + una planta | Σ OT de todos los periodos | 4 | 4 | 4 | ✓ |
| engineer | 2. 30 días + una planta | Σ OT completadas de todos los periodos | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | Periodos (mes) cuyo total de OT coincide | 1 | 1 | 1 | ✓ |
| gerente | 2. 30 días + una planta | Σ OT de todos los periodos | 4 | 4 | 4 | ✓ |
| gerente | 2. 30 días + una planta | Σ OT completadas de todos los periodos | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | Periodos (mes) cuyo total de OT coincide | 1 | 1 | 1 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Σ OT de todos los periodos | 24 | 24 | 24 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Σ OT completadas de todos los periodos | 18 | 18 | 18 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Periodos (mes) cuyo total de OT coincide | 12 | 12 | 12 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | Σ OT de todos los periodos | 24 | 24 | 24 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | Σ OT completadas de todos los periodos | 18 | 18 | 18 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | Periodos (mes) cuyo total de OT coincide | 12 | 12 | 12 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Σ OT de todos los periodos | 24 | 24 | 24 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Σ OT completadas de todos los periodos | 18 | 18 | 18 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Periodos (mes) cuyo total de OT coincide | 12 | 12 | 12 | ✓ |
| supervisor | 4. Combinación sin filas | Σ OT de todos los periodos | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Σ OT completadas de todos los periodos | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Periodos (mes) cuyo total de OT coincide | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | Σ OT de todos los periodos | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | Σ OT completadas de todos los periodos | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | Periodos (mes) cuyo total de OT coincide | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | Σ OT de todos los periodos | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | Σ OT completadas de todos los periodos | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | Periodos (mes) cuyo total de OT coincide | 0 | 0 | 0 | ✓ |
| supervisor | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| engineer | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| gerente | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |

## R3

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| supervisor | 1. Histórico, sin filtros | OT abiertas | 21 | 21 | 21 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT demoradas | 2 | 2 | 2 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT vencidas (solo total del backend) | — | 19 | 19 | ✓ |
| engineer | 1. Histórico, sin filtros | OT abiertas | 21 | 21 | 21 | ✓ |
| engineer | 1. Histórico, sin filtros | OT demoradas | 2 | 2 | 2 | ✓ |
| engineer | 1. Histórico, sin filtros | OT vencidas (solo total del backend) | — | 19 | 19 | ✓ |
| gerente | 1. Histórico, sin filtros | OT abiertas | 21 | 21 | 21 | ✓ |
| gerente | 1. Histórico, sin filtros | OT demoradas | 2 | 2 | 2 | ✓ |
| gerente | 1. Histórico, sin filtros | OT vencidas (solo total del backend) | — | 19 | 19 | ✓ |
| supervisor | 2. 30 días + una planta | OT abiertas | 11 | 11 | 11 | ✓ |
| supervisor | 2. 30 días + una planta | OT demoradas | 1 | 1 | 1 | ✓ |
| supervisor | 2. 30 días + una planta | OT vencidas (solo total del backend) | — | 10 | 10 | ✓ |
| engineer | 2. 30 días + una planta | OT abiertas | 11 | 11 | 11 | ✓ |
| engineer | 2. 30 días + una planta | OT demoradas | 1 | 1 | 1 | ✓ |
| engineer | 2. 30 días + una planta | OT vencidas (solo total del backend) | — | 10 | 10 | ✓ |
| gerente | 2. 30 días + una planta | OT abiertas | 11 | 11 | 11 | ✓ |
| gerente | 2. 30 días + una planta | OT demoradas | 1 | 1 | 1 | ✓ |
| gerente | 2. 30 días + una planta | OT vencidas (solo total del backend) | — | 10 | 10 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT abiertas | 5 | 5 | 5 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT demoradas | 1 | 1 | 1 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT vencidas (solo total del backend) | — | 5 | 5 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT abiertas | 5 | 5 | 5 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT demoradas | 1 | 1 | 1 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT vencidas (solo total del backend) | — | 5 | 5 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT abiertas | 5 | 5 | 5 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT demoradas | 1 | 1 | 1 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT vencidas (solo total del backend) | — | 5 | 5 | ✓ |
| supervisor | 4. Combinación sin filas | OT abiertas | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT demoradas | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT vencidas (solo total del backend) | — | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT abiertas | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT demoradas | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT vencidas (solo total del backend) | — | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT abiertas | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT demoradas | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT vencidas (solo total del backend) | — | 0 | 0 | ✓ |
| supervisor | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| engineer | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| gerente | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |

## R4

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| supervisor | 1. Histórico, sin filtros | Molino SAG con motor Siemens: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 41 | 41 | 41 | ✓ |
| supervisor | 1. Histórico, sin filtros | Molino SAG con motor Siemens: MTTR (min) | 490.8 | 490.8 | 490.8 | ✓ |
| supervisor | 1. Histórico, sin filtros | Correa Overland: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 40 | 40 | 40 | ✓ |
| supervisor | 1. Histórico, sin filtros | Correa Overland: MTTR (min) | 433.1 | 433.1 | 433.05 | ✓ |
| supervisor | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 42 | 42 | 42 | ✓ |
| supervisor | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: MTTR (min) | 322.7 | 322.7 | 322.71 | ✓ |
| supervisor | 1. Histórico, sin filtros | Bomba de pulpa KSB: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 42 | 42 | 42 | ✓ |
| supervisor | 1. Histórico, sin filtros | Bomba de pulpa KSB: MTTR (min) | 314.4 | 314.4 | 314.43 | ✓ |
| supervisor | 1. Histórico, sin filtros | Molino SAG con motor Siemens: fallas (365 días) | 6 | 6 | 6 | ✓ |
| supervisor | 1. Histórico, sin filtros | Correa Overland: fallas (365 días) | 6 | 6 | 6 | ✓ |
| supervisor | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: fallas (365 días) | 6 | 6 | 6 | ✓ |
| supervisor | 1. Histórico, sin filtros | Bomba de pulpa KSB: fallas (365 días) | 6 | 6 | 6 | ✓ |
| engineer | 1. Histórico, sin filtros | Molino SAG con motor Siemens: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 41 | 41 | 41 | ✓ |
| engineer | 1. Histórico, sin filtros | Molino SAG con motor Siemens: MTTR (min) | 490.8 | 490.8 | 490.8 | ✓ |
| engineer | 1. Histórico, sin filtros | Correa Overland: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 40 | 40 | 40 | ✓ |
| engineer | 1. Histórico, sin filtros | Correa Overland: MTTR (min) | 433.1 | 433.1 | 433.05 | ✓ |
| engineer | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 42 | 42 | 42 | ✓ |
| engineer | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: MTTR (min) | 322.7 | 322.7 | 322.71 | ✓ |
| engineer | 1. Histórico, sin filtros | Bomba de pulpa KSB: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 42 | 42 | 42 | ✓ |
| engineer | 1. Histórico, sin filtros | Bomba de pulpa KSB: MTTR (min) | 314.4 | 314.4 | 314.43 | ✓ |
| engineer | 1. Histórico, sin filtros | Molino SAG con motor Siemens: fallas (365 días) | 6 | 6 | 6 | ✓ |
| engineer | 1. Histórico, sin filtros | Correa Overland: fallas (365 días) | 6 | 6 | 6 | ✓ |
| engineer | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: fallas (365 días) | 6 | 6 | 6 | ✓ |
| engineer | 1. Histórico, sin filtros | Bomba de pulpa KSB: fallas (365 días) | 6 | 6 | 6 | ✓ |
| gerente | 1. Histórico, sin filtros | Molino SAG con motor Siemens: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 41 | 41 | 41 | ✓ |
| gerente | 1. Histórico, sin filtros | Molino SAG con motor Siemens: MTTR (min) | 490.8 | 490.8 | 490.8 | ✓ |
| gerente | 1. Histórico, sin filtros | Correa Overland: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 40 | 40 | 40 | ✓ |
| gerente | 1. Histórico, sin filtros | Correa Overland: MTTR (min) | 433.1 | 433.1 | 433.05 | ✓ |
| gerente | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 42 | 42 | 42 | ✓ |
| gerente | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: MTTR (min) | 322.7 | 322.7 | 322.71 | ✓ |
| gerente | 1. Histórico, sin filtros | Bomba de pulpa KSB: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 42 | 42 | 42 | ✓ |
| gerente | 1. Histórico, sin filtros | Bomba de pulpa KSB: MTTR (min) | 314.4 | 314.4 | 314.43 | ✓ |
| gerente | 1. Histórico, sin filtros | Molino SAG con motor Siemens: fallas (365 días) | 6 | 6 | 6 | ✓ |
| gerente | 1. Histórico, sin filtros | Correa Overland: fallas (365 días) | 6 | 6 | 6 | ✓ |
| gerente | 1. Histórico, sin filtros | Chancador de cono Sandvik H8800: fallas (365 días) | 6 | 6 | 6 | ✓ |
| gerente | 1. Histórico, sin filtros | Bomba de pulpa KSB: fallas (365 días) | 6 | 6 | 6 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 18 | 18 | 18 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: MTTR (min) | 317.3 | 317.3 | 317.33 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: fallas (365 días) | 6 | 6 | 6 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 18 | 18 | 18 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: MTTR (min) | 317.3 | 317.3 | 317.33 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: fallas (365 días) | 6 | 6 | 6 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: OT completadas con tiempo (age_minutes=0 no distingue «sin dato») | 18 | 18 | 18 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: MTTR (min) | 317.3 | 317.3 | 317.33 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Chancador de cono Sandvik H8800: fallas (365 días) | 6 | 6 | 6 | ✓ |
| supervisor | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| engineer | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| gerente | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |

## R5

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| supervisor | 1. Histórico, sin filtros | OT tipo corrective | 48 | 48 | 48 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT tipo preventive | 48 | 48 | 48 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT tipo predictive | 48 | 48 | 48 | ✓ |
| supervisor | 1. Histórico, sin filtros | OT tipo inspection | 48 | 48 | 48 | ✓ |
| engineer | 1. Histórico, sin filtros | OT tipo corrective | 48 | 48 | 48 | ✓ |
| engineer | 1. Histórico, sin filtros | OT tipo preventive | 48 | 48 | 48 | ✓ |
| engineer | 1. Histórico, sin filtros | OT tipo predictive | 48 | 48 | 48 | ✓ |
| engineer | 1. Histórico, sin filtros | OT tipo inspection | 48 | 48 | 48 | ✓ |
| gerente | 1. Histórico, sin filtros | OT tipo corrective | 48 | 48 | 48 | ✓ |
| gerente | 1. Histórico, sin filtros | OT tipo preventive | 48 | 48 | 48 | ✓ |
| gerente | 1. Histórico, sin filtros | OT tipo predictive | 48 | 48 | 48 | ✓ |
| gerente | 1. Histórico, sin filtros | OT tipo inspection | 48 | 48 | 48 | ✓ |
| supervisor | 2. 30 días + una planta | OT tipo corrective | 4 | 4 | 4 | ✓ |
| supervisor | 2. 30 días + una planta | OT tipo preventive | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | OT tipo predictive | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | OT tipo inspection | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | OT tipo corrective | 4 | 4 | 4 | ✓ |
| engineer | 2. 30 días + una planta | OT tipo preventive | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | OT tipo predictive | 0 | 0 | 0 | ✓ |
| engineer | 2. 30 días + una planta | OT tipo inspection | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | OT tipo corrective | 4 | 4 | 4 | ✓ |
| gerente | 2. 30 días + una planta | OT tipo preventive | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | OT tipo predictive | 0 | 0 | 0 | ✓ |
| gerente | 2. 30 días + una planta | OT tipo inspection | 0 | 0 | 0 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT tipo corrective | 6 | 6 | 6 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT tipo preventive | 6 | 6 | 6 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT tipo predictive | 6 | 6 | 6 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT tipo inspection | 6 | 6 | 6 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT tipo corrective | 6 | 6 | 6 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT tipo preventive | 6 | 6 | 6 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT tipo predictive | 6 | 6 | 6 | ✓ |
| engineer | 3. 365 días + planta + disciplina + máquina | OT tipo inspection | 6 | 6 | 6 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT tipo corrective | 6 | 6 | 6 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT tipo preventive | 6 | 6 | 6 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT tipo predictive | 6 | 6 | 6 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | OT tipo inspection | 6 | 6 | 6 | ✓ |
| supervisor | 4. Combinación sin filas | OT tipo corrective | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT tipo preventive | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT tipo predictive | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | OT tipo inspection | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT tipo corrective | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT tipo preventive | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT tipo predictive | 0 | 0 | 0 | ✓ |
| engineer | 4. Combinación sin filas | OT tipo inspection | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT tipo corrective | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT tipo preventive | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT tipo predictive | 0 | 0 | 0 | ✓ |
| gerente | 4. Combinación sin filas | OT tipo inspection | 0 | 0 | 0 | ✓ |
| supervisor | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| engineer | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |
| gerente | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |

## R6

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| gerente | 1. Histórico, sin filtros | Costo real (sin canceladas) | 144148287 | 144148287 | 144148287 | ✓ |
| gerente | 2. 30 días + una planta | Costo real (sin canceladas) | 0 | 0 | 0 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Costo real (sin canceladas) | 16041240 | 16041240 | 16041240 | ✓ |
| gerente | 4. Combinación sin filas | Costo real (sin canceladas) | 0 | 0 | 0 | ✓ |
| gerente | 5. Planta de otra empresa (debe dar 404) | HTTP con un id de otra empresa (esperado 404) (el reporte explica y quita el filtro) | 404 | 404 | 404 | ✓ |

## R7

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| supervisor | 1. Histórico, sin filtros | Avisos pendiente | 0 | 0 | 0 | ✓ |
| supervisor | 1. Histórico, sin filtros | Avisos con_ot | 0 | 0 | 0 | ✓ |
| supervisor | 1. Histórico, sin filtros | Avisos descartado | 0 | 0 | 0 | ✓ |
| gerente | 1. Histórico, sin filtros | Avisos pendiente | 0 | 0 | 0 | ✓ |
| gerente | 1. Histórico, sin filtros | Avisos con_ot | 0 | 0 | 0 | ✓ |
| gerente | 1. Histórico, sin filtros | Avisos descartado | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Avisos pendiente | 0 | — | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Avisos con_ot | 0 | — | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Avisos descartado | 0 | — | 0 | ✓ |
| gerente | 2. 30 días + una planta | Avisos pendiente | 0 | — | 0 | ✓ |
| gerente | 2. 30 días + una planta | Avisos con_ot | 0 | — | 0 | ✓ |
| gerente | 2. 30 días + una planta | Avisos descartado | 0 | — | 0 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Avisos pendiente | 0 | — | 0 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Avisos con_ot | 0 | — | 0 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Avisos descartado | 0 | — | 0 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Avisos pendiente | 0 | — | 0 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Avisos con_ot | 0 | — | 0 | ✓ |
| gerente | 3. 365 días + planta + disciplina + máquina | Avisos descartado | 0 | — | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Avisos pendiente | 0 | — | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Avisos con_ot | 0 | — | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Avisos descartado | 0 | — | 0 | ✓ |
| gerente | 4. Combinación sin filas | Avisos pendiente | 0 | — | 0 | ✓ |
| gerente | 4. Combinación sin filas | Avisos con_ot | 0 | — | 0 | ✓ |
| gerente | 4. Combinación sin filas | Avisos descartado | 0 | — | 0 | ✓ |
| otra empresa | 6. Usuario de otra empresa | Avisos de la empresa A visibles para la otra empresa | 0 | 0 | 0 | ✓ |

## R8

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| operador | 1. Histórico, sin filtros | Avisos pendiente | 0 | 0 | 0 | ✓ |
| operador | 1. Histórico, sin filtros | Avisos con_ot | 0 | 0 | 0 | ✓ |
| operador | 1. Histórico, sin filtros | Avisos descartado | 0 | 0 | 0 | ✓ |
| operador | 1. Histórico, sin filtros | Mis OT (total) | 0 | — | 0 | ✓ |
| operador | 1. Histórico, sin filtros | Mis OT pending | 0 | — | 0 | ✓ |
| operador | 1. Histórico, sin filtros | Mis OT in_progress | 0 | — | 0 | ✓ |
| operador | 1. Histórico, sin filtros | Mis OT por_validar | 0 | — | 0 | ✓ |
| operador | 1. Histórico, sin filtros | Mis OT completed | 0 | — | 0 | ✓ |
| operador | 1. Histórico, sin filtros | Mis OT cancelled | 0 | — | 0 | ✓ |
| tecnico | 1. Histórico, sin filtros | Avisos pendiente | 0 | 0 | 0 | ✓ |
| tecnico | 1. Histórico, sin filtros | Avisos con_ot | 0 | 0 | 0 | ✓ |
| tecnico | 1. Histórico, sin filtros | Avisos descartado | 0 | 0 | 0 | ✓ |
| tecnico | 1. Histórico, sin filtros | Mis OT (total) | 64 | — | 64 | ✓ |
| tecnico | 1. Histórico, sin filtros | Mis OT pending | 2 | — | 2 | ✓ |
| tecnico | 1. Histórico, sin filtros | Mis OT in_progress | 0 | — | 0 | ✓ |
| tecnico | 1. Histórico, sin filtros | Mis OT por_validar | 5 | — | 5 | ✓ |
| tecnico | 1. Histórico, sin filtros | Mis OT completed | 54 | — | 54 | ✓ |
| tecnico | 1. Histórico, sin filtros | Mis OT cancelled | 3 | — | 3 | ✓ |
| operador | 2. 30 días + una planta | Avisos pendiente | 0 | — | 0 | ✓ |
| operador | 2. 30 días + una planta | Avisos con_ot | 0 | — | 0 | ✓ |
| operador | 2. 30 días + una planta | Avisos descartado | 0 | — | 0 | ✓ |
| operador | 2. 30 días + una planta | Mis OT (total) | 0 | — | 0 | ✓ |
| operador | 2. 30 días + una planta | Mis OT pending | 0 | — | 0 | ✓ |
| operador | 2. 30 días + una planta | Mis OT in_progress | 0 | — | 0 | ✓ |
| operador | 2. 30 días + una planta | Mis OT por_validar | 0 | — | 0 | ✓ |
| operador | 2. 30 días + una planta | Mis OT completed | 0 | — | 0 | ✓ |
| operador | 2. 30 días + una planta | Mis OT cancelled | 0 | — | 0 | ✓ |
| tecnico | 2. 30 días + una planta | Avisos pendiente | 0 | — | 0 | ✓ |
| tecnico | 2. 30 días + una planta | Avisos con_ot | 0 | — | 0 | ✓ |
| tecnico | 2. 30 días + una planta | Avisos descartado | 0 | — | 0 | ✓ |
| tecnico | 2. 30 días + una planta | Mis OT (total) | 2 | — | 2 | ✓ |
| tecnico | 2. 30 días + una planta | Mis OT pending | 2 | — | 2 | ✓ |
| tecnico | 2. 30 días + una planta | Mis OT in_progress | 0 | — | 0 | ✓ |
| tecnico | 2. 30 días + una planta | Mis OT por_validar | 0 | — | 0 | ✓ |
| tecnico | 2. 30 días + una planta | Mis OT completed | 0 | — | 0 | ✓ |
| tecnico | 2. 30 días + una planta | Mis OT cancelled | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Avisos pendiente | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Avisos con_ot | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Avisos descartado | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Mis OT (total) | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Mis OT pending | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Mis OT in_progress | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Mis OT por_validar | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Mis OT completed | 0 | — | 0 | ✓ |
| operador | 3. 365 días + planta + disciplina + máquina | Mis OT cancelled | 0 | — | 0 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Avisos pendiente | 0 | — | 0 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Avisos con_ot | 0 | — | 0 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Avisos descartado | 0 | — | 0 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Mis OT (total) | 32 | — | 32 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Mis OT pending | 2 | — | 2 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Mis OT in_progress | 0 | — | 0 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Mis OT por_validar | 5 | — | 5 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Mis OT completed | 23 | — | 23 | ✓ |
| tecnico | 3. 365 días + planta + disciplina + máquina | Mis OT cancelled | 2 | — | 2 | ✓ |
| operador | 4. Combinación sin filas | Avisos pendiente | 0 | — | 0 | ✓ |
| operador | 4. Combinación sin filas | Avisos con_ot | 0 | — | 0 | ✓ |
| operador | 4. Combinación sin filas | Avisos descartado | 0 | — | 0 | ✓ |
| operador | 4. Combinación sin filas | Mis OT (total) | 0 | — | 0 | ✓ |
| operador | 4. Combinación sin filas | Mis OT pending | 0 | — | 0 | ✓ |
| operador | 4. Combinación sin filas | Mis OT in_progress | 0 | — | 0 | ✓ |
| operador | 4. Combinación sin filas | Mis OT por_validar | 0 | — | 0 | ✓ |
| operador | 4. Combinación sin filas | Mis OT completed | 0 | — | 0 | ✓ |
| operador | 4. Combinación sin filas | Mis OT cancelled | 0 | — | 0 | ✓ |
| tecnico | 4. Combinación sin filas | Avisos pendiente | 0 | — | 0 | ✓ |
| tecnico | 4. Combinación sin filas | Avisos con_ot | 0 | — | 0 | ✓ |
| tecnico | 4. Combinación sin filas | Avisos descartado | 0 | — | 0 | ✓ |
| tecnico | 4. Combinación sin filas | Mis OT (total) | 64 | — | 64 | ✓ |
| tecnico | 4. Combinación sin filas | Mis OT pending | 2 | — | 2 | ✓ |
| tecnico | 4. Combinación sin filas | Mis OT in_progress | 0 | — | 0 | ✓ |
| tecnico | 4. Combinación sin filas | Mis OT por_validar | 5 | — | 5 | ✓ |
| tecnico | 4. Combinación sin filas | Mis OT completed | 54 | — | 54 | ✓ |
| tecnico | 4. Combinación sin filas | Mis OT cancelled | 3 | — | 3 | ✓ |

## R9

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| supervisor | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: movimientos del historial | 2 | 2 | 2 | ✓ |
| supervisor | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: último movimiento = estado actual | 1 | 1 | 1 | ✓ |
| engineer | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: movimientos del historial | 2 | 2 | 2 | ✓ |
| engineer | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: último movimiento = estado actual | 1 | 1 | 1 | ✓ |
| gerente | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: movimientos del historial | 2 | 2 | 2 | ✓ |
| gerente | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: último movimiento = estado actual | 1 | 1 | 1 | ✓ |
| gerente | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: movimientos de la bitácora | 0 | 0 | 0 | ✓ |
| admin | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: movimientos del historial | 2 | 2 | 2 | ✓ |
| admin | OT con más movimientos que ve el perfil | REAL-MOL-001-19-2: último movimiento = estado actual | 1 | 1 | 1 | ✓ |
| operador | OT con más movimientos que ve el perfil | Sin OT visibles | 0 | 0 | 0 | ✓ |
| tecnico | OT con más movimientos que ve el perfil | REAL-BOM-001-16-2: movimientos del historial | 2 | 2 | 2 | ✓ |
| tecnico | OT con más movimientos que ve el perfil | REAL-BOM-001-16-2: último movimiento = estado actual | 1 | 1 | 1 | ✓ |
| tecnico | OT que el perfil no debe ver | HTTP (esperado 404) | 404 | 404 | 404 | ✓ |
| otra empresa | 6. Usuario de otra empresa | HTTP al pedir una OT ajena (esperado 404) | 404 | 404 | 404 | ✓ |

## R10

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| supervisor | 1. Histórico, sin filtros | OT cerradas | 165 | 165 | 165 | ✓ |
| supervisor | 1. Histórico, sin filtros | Con downtime registrado | 165 | — | 165 | ✓ |
| supervisor | 1. Histórico, sin filtros | Con costo real mayor que 0 (el listado entrega 0 cuando el costo es NULL) | 165 | — | 165 | ✓ |
| supervisor | 1. Histórico, sin filtros | Con técnico asignado | 165 | — | 165 | ✓ |
| admin | 1. Histórico, sin filtros | OT cerradas | 165 | — | 165 | ✓ |
| admin | 1. Histórico, sin filtros | Con downtime registrado | 165 | — | 165 | ✓ |
| admin | 1. Histórico, sin filtros | Con costo real mayor que 0 | 165 | — | 165 | ✓ |
| admin | 1. Histórico, sin filtros | Con técnico asignado | 165 | — | 165 | ✓ |
| supervisor | 2. 30 días + una planta | OT cerradas | 0 | 0 | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Con downtime registrado | 0 | — | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Con costo real mayor que 0 (el listado entrega 0 cuando el costo es NULL) | 0 | — | 0 | ✓ |
| supervisor | 2. 30 días + una planta | Con técnico asignado | 0 | — | 0 | ✓ |
| admin | 2. 30 días + una planta | OT cerradas | 0 | — | 0 | ✓ |
| admin | 2. 30 días + una planta | Con downtime registrado | 0 | — | 0 | ✓ |
| admin | 2. 30 días + una planta | Con costo real mayor que 0 | 0 | — | 0 | ✓ |
| admin | 2. 30 días + una planta | Con técnico asignado | 0 | — | 0 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | OT cerradas | 18 | 18 | 18 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Con downtime registrado | 18 | — | 18 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Con costo real mayor que 0 (el listado entrega 0 cuando el costo es NULL) | 18 | — | 18 | ✓ |
| supervisor | 3. 365 días + planta + disciplina + máquina | Con técnico asignado | 18 | — | 18 | ✓ |
| admin | 3. 365 días + planta + disciplina + máquina | OT cerradas | 18 | — | 18 | ✓ |
| admin | 3. 365 días + planta + disciplina + máquina | Con downtime registrado | 18 | — | 18 | ✓ |
| admin | 3. 365 días + planta + disciplina + máquina | Con costo real mayor que 0 | 18 | — | 18 | ✓ |
| admin | 3. 365 días + planta + disciplina + máquina | Con técnico asignado | 18 | — | 18 | ✓ |
| supervisor | 4. Combinación sin filas | OT cerradas | 0 | 0 | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Con downtime registrado | 0 | — | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Con costo real mayor que 0 (el listado entrega 0 cuando el costo es NULL) | 0 | — | 0 | ✓ |
| supervisor | 4. Combinación sin filas | Con técnico asignado | 0 | — | 0 | ✓ |
| admin | 4. Combinación sin filas | OT cerradas | 0 | — | 0 | ✓ |
| admin | 4. Combinación sin filas | Con downtime registrado | 0 | — | 0 | ✓ |
| admin | 4. Combinación sin filas | Con costo real mayor que 0 | 0 | — | 0 | ✓ |
| admin | 4. Combinación sin filas | Con técnico asignado | 0 | — | 0 | ✓ |

## R1-R10

| Perfil | Filtros | Métrica | App | API | BD | |
|---|---|---|---:|---:|---:|:-:|
| otra empresa | 6. Usuario de otra empresa | OT de la empresa A visibles para la otra empresa | 0 | 0 | 0 | ✓ |

## Observaciones del backend

Solo se anotan; no se corrigió nada en `backend/`.

1. **Disponibilidad con «histórico».** Con `days` nulo, `financial-impact` usa 365 días × 24 h como denominador, pero el downtime suma TODO el historial. En esta base: el backend entrega 94.5 % y, con el downtime de los últimos 365 días, daría 97.4 %. El reporte muestra el valor tal cual y lo rotula «ventana de 365 días». No se corrigió (`stats.py`, `dias_periodo`).
2. **El listado de OT devuelve `[]` ante cualquier error.** `GET /api/work-orders` captura toda excepción y responde `[]` en vez de un error (`work_orders.py:228`): una falla de base de datos se ve como «no hay OT». Por eso cada reporte compara el listado con `desglose.total` y bloquea la exportación si no cuadra.
3. **`plant_id` del payload de OT no es confiable.** `row_to_work_order` lo rellena con 1 cuando falta (`work_orders.py:74`: `int(row.get("planta_id") or 1)`). En esta base hay 0 máquinas sin planta, pero el campo puede inducir a error: los reportes filtran la planta por el catálogo de máquinas, nunca por ese campo.
4. **`age_minutes` y los costos no distinguen «sin dato» de 0.** `age_minutes` es `tiempo_reparacion_min or 0` y `costo_real`/`costo_estimado` llegan como 0 cuando son NULL. En esta empresa: 0 OT completadas con tiempo NULL y 0 con tiempo 0; 27 OT con costo NULL y 0 con costo 0 (de 192). El MTTR por máquina (R4) lo explica cuando el listado no cuadra por esta causa.
5. **El listado no pagina ni filtra.** `GET /api/work-orders` devuelve todas las OT de la empresa (192 para el gerente de esta empresa); todos los cortes se hacen en el navegador.
6. **`GET /api/work-orders` no trae `fecha_vencimiento`.** Las OT vencidas no se pueden contar desde el listado: R3 muestra solo el total `estancadas.vencidas` del backend.

## SQL usado (solo lectura)

Cada consulta corre en una transacción `READ ONLY` y termina en `ROLLBACK`. Los fragmentos `SCOPE`, `FECHA`, `EN_SLA` y `PROPIO` se anteponen o añaden como se indica.

- `SCOPE` (alcance por empresa y topología, copia de `_get_ot_scope_params`): `AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))`
- `FECHA` (copia del `date_filter`): `AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval)`
- `EN_SLA` (copia de `en_sla`): `((ot.fecha_vencimiento IS NOT NULL AND ot.fecha_cierre IS NOT NULL AND ot.fecha_cierre <= ot.fecha_vencimiento) OR (ot.fecha_vencimiento IS NULL AND ot.tiempo_reparacion_min <= 1440))`
- `PROPIO` (copia de `_alcance_propio`): `AND (ot.tecnico_id = %(uid)s OR ot.creado_por = %(uid)s OR EXISTS (SELECT 1 FROM aviso_falla afp WHERE afp.aviso_falla_id = ot.aviso_falla_id AND afp.reportado_por = %(uid)s))`

### `avisos_ajenos`

```sql
SELECT COUNT(*) AS n FROM aviso_falla af JOIN maquina m ON m.maquina_id = af.maquina_id JOIN planta p ON p.planta_id = m.planta_id WHERE p.empresa_id = %(e)s AND af.aviso_falla_id = ANY(%(ids)s)
```

### `maquina_mas_ot`

```sql
SELECT m.maquina_id, m.disciplina_id, COUNT(ot.ot_id) AS n FROM maquina m LEFT JOIN orden_trabajo ot ON ot.maquina_id = m.maquina_id WHERE m.planta_id = %(p)s GROUP BY m.maquina_id, m.disciplina_id ORDER BY n DESC LIMIT 1
```

### `obs_disp`

```sql
SELECT COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.estado != 'cancelled'), 0) AS total, COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.estado != 'cancelled' AND ot.fecha_creacion >= NOW() - INTERVAL '365 days'), 0) AS ultimo_anio FROM orden_trabajo ot WHERE TRUE AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))
```

### `obs_nulos`

```sql
SELECT COUNT(*) FILTER (WHERE ot.estado = 'completed' AND ot.tiempo_reparacion_min IS NULL) AS tiempo_nulo, COUNT(*) FILTER (WHERE ot.estado = 'completed' AND ot.tiempo_reparacion_min = 0) AS tiempo_cero, COUNT(*) FILTER (WHERE ot.costo_real IS NULL) AS costo_nulo, COUNT(*) FILTER (WHERE ot.costo_real = 0) AS costo_cero, COUNT(*) AS total FROM orden_trabajo ot WHERE TRUE AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))
```

### `obs_planta`

```sql
SELECT COUNT(*) AS n FROM maquina WHERE planta_id IS NULL
```

### `planta_empresa_a`

```sql
SELECT MIN(planta_id) AS id FROM planta WHERE empresa_id = %(e)s
```

### `planta_otra`

```sql
SELECT MIN(planta_id) AS id FROM planta WHERE empresa_id = %(e)s
```

### `plantas_con_ot`

```sql
SELECT p.planta_id, COUNT(ot.ot_id) AS n FROM planta p LEFT JOIN maquina m ON m.planta_id = p.planta_id LEFT JOIN orden_trabajo ot ON ot.maquina_id = m.maquina_id WHERE p.empresa_id = %(e)s GROUP BY p.planta_id ORDER BY n DESC
```

### `r10_calidad`

```sql
SELECT COUNT(*) AS cerradas, COUNT(*) FILTER (WHERE ot.downtime_minutes IS NOT NULL) AS con_downtime, COUNT(*) FILTER (WHERE COALESCE(ot.costo_real, 0) > 0) AS con_costo, COUNT(*) FILTER (WHERE ot.tecnico_id IS NOT NULL) AS con_tecnico FROM orden_trabajo ot WHERE ot.estado = 'completed' AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval) AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))
```

### `r1_desglose`

```sql
SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE ot.estado = 'completed') AS completadas, COUNT(*) FILTER (WHERE ot.estado = 'in_progress') AS en_curso, COUNT(*) FILTER (WHERE ot.estado IN ('pending','assigned','overdue')) AS pendientes, COUNT(*) FILTER (WHERE ot.estado = 'por_validar') AS por_validar, COUNT(*) FILTER (WHERE ot.estado = 'cancelled') AS canceladas, COUNT(*) FILTER (WHERE ot.estado = 'completed' AND ((ot.fecha_vencimiento IS NOT NULL AND ot.fecha_cierre IS NOT NULL AND ot.fecha_cierre <= ot.fecha_vencimiento) OR (ot.fecha_vencimiento IS NULL AND ot.tiempo_reparacion_min <= 1440))) AS en_sla, COALESCE(AVG(ot.tiempo_reparacion_min) FILTER (WHERE ot.estado = 'completed'), 0) AS mttr, COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.estado != 'cancelled'), 0) AS downtime_total FROM orden_trabajo ot WHERE TRUE AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval) AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))
```

### `r1_estancadas`

```sql
SELECT COUNT(*) FILTER (WHERE vencida) AS vencidas, COUNT(*) FILTER (WHERE demorada) AS demoradas FROM ( SELECT (ot.fecha_vencimiento IS NOT NULL AND ot.fecha_vencimiento < NOW() AND ot.estado::text NOT IN ('completed','cancelled')) AS vencida, (ot.estado = 'in_progress' AND COALESCE(ot.fecha_inicio, ot.fecha_creacion) < NOW() - INTERVAL '7 days') AS demorada FROM orden_trabajo ot WHERE TRUE AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))) t WHERE vencida OR demorada
```

### `r1_mtbf`

```sql
SELECT COUNT(*) AS fallas, COALESCE(SUM(ot.downtime_minutes), 0) AS downtime FROM orden_trabajo ot WHERE ot.tipo = 'corrective' AND ot.estado != 'cancelled' AND ot.fecha_creacion >= NOW() - INTERVAL '365 days' AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))
```

### `r2_meses`

```sql
SELECT date_trunc('month', ot.fecha_creacion)::date AS periodo, COUNT(*) AS total_ots, COUNT(*) FILTER (WHERE ot.estado = 'completed') AS completadas FROM orden_trabajo ot WHERE TRUE AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval) AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s)) GROUP BY 1 ORDER BY 1
```

### `r3_abiertas`

```sql
SELECT COUNT(*) AS abiertas FROM orden_trabajo ot WHERE ot.estado::text NOT IN ('completed','cancelled') AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))
```

### `r3_estancadas`

```sql
SELECT COUNT(*) FILTER (WHERE ot.estado = 'in_progress' AND COALESCE(ot.fecha_inicio, ot.fecha_creacion) < NOW() - (%(u)s || ' days')::interval) AS demoradas, COUNT(*) FILTER (WHERE ot.fecha_vencimiento IS NOT NULL AND ot.fecha_vencimiento < NOW() AND ot.estado::text NOT IN ('completed','cancelled')) AS vencidas FROM orden_trabajo ot WHERE TRUE AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))
```

### `r4_fallas`

```sql
SELECT COUNT(*) AS fallas FROM orden_trabajo ot WHERE ot.maquina_id = %(m)s AND ot.tipo = 'corrective' AND ot.estado != 'cancelled' AND ot.fecha_creacion >= NOW() - INTERVAL '365 days'
```

### `r4_mttr`

```sql
SELECT COUNT(*) AS completadas, AVG(ot.tiempo_reparacion_min) AS mttr FROM orden_trabajo ot WHERE ot.maquina_id = %(m)s AND ot.estado = 'completed' AND ot.tiempo_reparacion_min IS NOT NULL AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval)
```

### `r5_tipos`

```sql
SELECT ot.tipo::text AS tipo, COUNT(*) AS n FROM orden_trabajo ot WHERE TRUE AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval) AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s)) GROUP BY 1
```

### `r6_costo`

```sql
SELECT COALESCE(SUM(ot.costo_real) FILTER (WHERE ot.estado != 'cancelled'), 0) AS costo FROM orden_trabajo ot WHERE TRUE AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval) AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))
```

### `r7_avisos`

```sql
SELECT af.estado, COUNT(*) AS n FROM aviso_falla af JOIN maquina m ON m.maquina_id = af.maquina_id JOIN planta p ON p.planta_id = m.planta_id WHERE p.empresa_id = %(e)s AND (%(d)s::int IS NULL OR af.created_at >= NOW() - (%(d)s || ' days')::interval) AND m.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s)) GROUP BY af.estado
```

### `r8_avisos`

```sql
SELECT af.estado, COUNT(*) AS n FROM aviso_falla af JOIN maquina m ON m.maquina_id = af.maquina_id JOIN planta p ON p.planta_id = m.planta_id WHERE p.empresa_id = %(e)s AND (%(d)s::int IS NULL OR af.created_at >= NOW() - (%(d)s || ' days')::interval) AND af.reportado_por = %(uid)s GROUP BY af.estado
```

### `r8_ots`

```sql
SELECT ot.estado::text AS estado, COUNT(*) AS n FROM orden_trabajo ot WHERE ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s) AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval) AND (ot.tecnico_id = %(uid)s OR ot.creado_por = %(uid)s OR EXISTS (SELECT 1 FROM aviso_falla afp WHERE afp.aviso_falla_id = ot.aviso_falla_id AND afp.reportado_por = %(uid)s)) GROUP BY 1
```

### `r9_bitacora`

```sql
SELECT COUNT(*) AS n FROM transacciones t WHERE t.empresa_id = %(e)s AND t.perfil <> 'super_usuario' AND t.fecha >= %(d)s::date AND t.fecha < (%(h)s::date + 1) AND t.detalle->>'tabla' = 'orden_trabajo' AND t.detalle->>'registro_id' = %(r)s
```

### `r9_historial`

```sql
SELECT COUNT(*) AS n FROM ot_audit_log a WHERE a.ot_id = %(o)s
```

### `r9_mov`

```sql
SELECT a.ot_id, COUNT(*) AS n FROM ot_audit_log a WHERE a.ot_id = ANY(%(ids)s) GROUP BY a.ot_id ORDER BY n DESC LIMIT 1
```

### `r9_no_visible`

```sql
SELECT ot.numero_ot FROM orden_trabajo ot WHERE ot.numero_ot <> ALL(%(vis)s) AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s) ORDER BY ot.ot_id LIMIT 1
```
