# Prompt para Claude Code — Módulo de reportes de BARB (HU-26)

> Copia todo lo que está bajo la línea y pégalo en Claude Code, abierto en la raíz del repo `Capstone-BARB`, rama `feat/modulo-reportes`.

---

Vas a implementar el **módulo «Reportes»** de BARB. Se basa en la propuesta «BARB — Propuesta de módulo de reportes» y usa solo lo que el proyecto tiene hoy. Antes de escribir código, lee `CLAUDE.md` (raíz) y `frontend/CLAUDE.md`, y sigue sus convenciones (Angular 22, signals, `input()`/`output()`, control de flujo nativo, sin `CommonModule`, sin `standalone: true` explícito, sin `ngClass`/`ngStyle`, Tailwind v4, Vitest).

## 1. Reglas que no se negocian

1. **No modifiques nada en `backend/`**: ni routers, ni migraciones, ni seeds, ni `permissions.py`, ni `.env`. Al terminar, `git diff --stat main -- backend/` debe salir vacío. Si encuentras un error del backend, **no lo corrijas**: anótalo en `docs/reportes/CONCILIACION.md` (sección «Observaciones del backend») y sigue.
2. **No cambies la matriz de permisos** (`RUTAS`/`ACCIONES` en `frontend/src/app/core/permissions/permissions.ts`) ni `docs/referencias/matriz_rol.md`. La ruta `report` ya existe para los 6 perfiles de empresa (no para `super_usuario`) y hoy no tiene pantalla: el módulo la usa.
3. **No agregues dependencias** (npm ni Python). CSV y PDF se generan en el navegador; el PDF usa `@media print` + `window.print()`.
4. **No hay envío de correos.** El proyecto no puede enviar a los dominios de los usuarios. No uses `notifications.py` ni el workflow `overdue-report.yml`, y no agregues botones de «enviar» ni de «programar».
5. **Las fórmulas de KPI no se rehacen en el frontend.** SLA, MTTR, MTBF, disponibilidad, salud operacional, top 5, costos por máquina y distribución por tipo se muestran **tal como los entrega** `GET /api/stats/financial-impact` o `GET /api/stats/historical`. En el navegador solo se permiten conteos, sumas y porcentajes directos sobre filas que ya entregó el backend.
6. **Cada número de cada reporte tiene que cuadrar con la base de datos** (sección 6). Un reporte no está terminado mientras no esté conciliado.
7. **Sin datos sobrantes.** Cada reporte muestra y exporta solo las filas que pasan los filtros y solo las columnas que el usuario eligió, nunca datos fuera del alcance de su perfil (sección 4.3).
8. No inventes campos, endpoints ni valores de enum. Si algo de este prompt no coincide con el código, **el código manda**: detente, dime qué encontraste y propón cómo seguir.

## 2. Paso 0: lee, verifica y presenta un plan (no escribas código todavía)

Lee estos archivos y confirma cada dato de la sección 3 contra el código. Si alguno no coincide, avísame antes de seguir.

- Backend (solo lectura): `backend/src/barb/routers/stats.py`, `work_orders.py`, `avisos.py`, `catalog.py`, `transacciones.py`, `transacciones_empresa.py`; `backend/src/barb/core/permissions.py`; `backend/migrations/versions/0001_initial_schema.py`, `0009_transacciones_triggers.py`, `0012_aviso_falla.py`, `0014_estado_por_validar.py`; `backend/seeds/02_maestros.sql` (el encabezado tiene las credenciales de demo).
- Frontend: `core/services/stats.service.ts`, `work-orders.service.ts`, `avisos-api.ts`, `catalog.service.ts`, `transacciones-empresa-api.ts`, `currency.service.ts`, `mtbf-unit.service.ts`; `core/models/stats.model.ts`; `core/permissions/permissions.ts`; `core/guards/role.guard.ts`; `app.routes.ts`; `shared/components/layout/nav-items.ts`; `shared/components/ui/icon/icon.ts`; `features/dashboard/components/filtros-dashboard/`; `features/dashboard/explicame/`; `features/ayuda/ayuda-contenido.ts`; `core/i18n/translations.ts`, `core/i18n/textos/index.ts`, `core/i18n/idioma-vistas.spec.ts`.
- Docs: `docs/referencias/DASHBOARD_KPIS.md`, `docs/WORK_ORDERS.md` §7–13.

Después, **entra en modo plan** y preséntame la estructura de archivos, los modelos TypeScript, el orden de las subtareas y cómo vas a conciliar. Espera mi OK antes de implementar.

## 3. Datos verificados del código actual (confírmalos en el Paso 0)

### 3.1 Endpoints y lo que aceptan

| Endpoint | Parámetros que acepta | Notas que importan para cuadrar |
|---|---|---|
| `GET /api/stats/financial-impact` (ruta `dashboard`) | `days` (≥1, opcional), `planta_id`, `disciplina_id`, `maquina_id` | Periodo = `ot.fecha_creacion >= NOW() - days`. Sin `days` = todo el historial. Topología vía `maquina → planta`. 404 si el id de topología no es de la empresa. A los perfiles sin `ver_kpis_financieros` les omite `ahorro_generado`, `costo_total_acumulado`, `impacto_anual`, `machines_por_costo`, `ahorroGenerado`/`costo_total` de `machines`, y manda `financieros_visibles: false`. |
| `GET /api/stats/historical` (ruta `dashboard`) | `granularity` ∈ `day, week, month, semester, year, 5year`; `days`; los 3 ids de topología | Agrupa por `date_trunc` de `fecha_creacion`. Devuelve `periods[]` con `etiqueta, total_ots, completadas, sla, mttr, mtbf_hours, fallas, horas_periodo, disponibilidad`. |
| `GET /api/work-orders` (cualquier sesión) | ninguno (salvo `empresa_id` del superusuario) | **No pagina y no filtra.** Operador y técnico reciben solo sus OT (asignadas, creadas por ellos o nacidas de un aviso que reportaron). Los demás perfiles reciben todas las de su empresa. **Si falla, el backend devuelve `[]` y no un error.** |
| `GET /api/work-orders/{numero_ot}` | — | Agrega `status_history[]` (`from_status, to_status, comment, user_name, user_role, changed_at`) desde `ot_audit_log`. 404 si el perfil no puede ver la OT. |
| `GET /api/avisos` (acción `reportar_falla`) | `estado` ∈ `pendiente, con_ot, descartado` | Supervisor y gerente (`ROLES_REPOSITORIO_AVISOS`) ven toda la empresa; los demás, solo los avisos que reportaron. No acepta fecha ni topología. |
| `GET /api/empresa/transacciones` (ruta `transacciones_empresa`, solo gerente) | `rol, usuario_id, rango` (`24h, 7d, 30d, 1y, custom`), `desde`, `hasta`, `limit` (≤200), `offset` | Paginado. No filtra por tabla ni por registro: eso se filtra en el cliente con `detalle.tabla === 'orden_trabajo'` y `registro_id === String(ot_id)` (`registro_id` es texto). |
| `GET /api/plants`, `/api/disciplines`, `/api/machines` | — | Ya vienen acotados a la empresa. `Machine` trae `plant_id` y `discipline_id`. |

### 3.2 Campos del payload de OT (`row_to_work_order`) que hay que interpretar bien

- `estado` es el valor crudo del enum: `pending, assigned, in_progress, por_validar, completed, cancelled, overdue`. Para filtrar y contar usa siempre `estado`, nunca `status` (que es texto «humanizado»).
- `tipo` ∈ `corrective, preventive, predictive, inspection` (son **cuatro**, no tres). `priority` ∈ `low, medium, high, urgent`. Severidad ∈ `low, medium, high, critical`.
- `age_minutes` **no es la antigüedad**: es `tiempo_reparacion_min or 0`. La antigüedad se calcula desde `created_at`.
- `costo_real` y `costo_estimado` llegan como `0` cuando en la BD son `NULL`: el payload no distingue «sin dato» de «cero». `downtime_minutes` sí llega como `null`.
- El payload **no trae** `fecha_vencimiento` ni `discipline_id` (trae el nombre de la disciplina). Para filtrar por disciplina, usa el conjunto de `machine_id` del catálogo de máquinas con ese `discipline_id`: es el mismo criterio que usa el backend (`maquina.disciplina_id`). Nunca filtres por nombre.
- El listado incluye costos para **todos** los perfiles. El módulo no debe mostrarlos ni exportarlos a quien no tenga `ver_kpis_financieros`.

### 3.3 Definiciones del backend que el módulo debe respetar

- **SLA cumplido:** `(fecha_vencimiento IS NOT NULL AND fecha_cierre IS NOT NULL AND fecha_cierre <= fecha_vencimiento) OR (fecha_vencimiento IS NULL AND tiempo_reparacion_min <= settings.sla_target_minutes)`, sobre las OT `completed`.
- **Estancadas** (`estancadas` en financial-impact): **no lee `days`** (es una foto del momento), pero **sí** respeta la topología. *Vencida* = `fecha_vencimiento < NOW()` y estado no final. *Demorada* = `in_progress` y `COALESCE(fecha_inicio, fecha_creacion) < NOW() - umbral_dias` (hoy 7, viene en `umbral_dias`). Una OT puede estar en las dos, así que `vencidas + demoradas` puede superar a `total`.
- **MTBF:** ventana fija de 365 días que no depende de `days`. Solo se calcula si `days` es nulo o ≥ 365 (`mtbf_visible`), y si hay al menos 2 fallas. `top_5_peor_mtbf` llega vacío cuando `days < 365`.
- **`salud_operacional.desglose`**: `completadas, en_curso, pendientes (pending+assigned+overdue), por_validar, canceladas, total`, con el mismo `days` y la misma topología que el resto de la respuesta.
- **Disponibilidad con «histórico»:** con `days` nulo, el denominador es 365 días × 24 h, pero el downtime suma **todo** el historial. Muestra el valor tal cual, rotúlalo «ventana de 365 días» y anótalo como observación del backend en `CONCILIACION.md`. No lo corrijas.

## 4. Qué construir

### 4.1 Pestaña, rutas y catálogo

- `NAV_ITEMS`: ítem `{ path: '/reportes', icon: <ícono nuevo en icon.ts>, label: 'reportes', ruta: 'report', prioridad: … }`, justo debajo de Dashboard. Amplía el tipo `label` y agrega `nav.reportes` / `nav.reportesCorto` en ES y EN.
- `app.routes.ts`: `/reportes` (biblioteca) y `/reportes/:id` (reporte), lazy, con `roleGuard('report')`. Un `:id` desconocido o no permitido para el perfil lleva a `/reportes`, sin mostrar el reporte.
- `features/reportes/reportes-catalogo.ts`: cada reporte declara lo que necesita con claves de la matriz actual, sin listas de roles, igual que `ayuda-contenido.ts`. Un test verifica la tabla de visibilidad resultante:

| # | Reporte | Requiere | Ven el reporte (según la matriz actual) |
|---|---|---|---|
| R1 | Resumen ejecutivo del periodo | ruta `dashboard` | supervisor, engineer, gerente |
| R2 | Cumplimiento de SLA y MTTR por periodo | ruta `dashboard` | supervisor, engineer, gerente |
| R3 | Backlog y OT atrasadas | ruta `dashboard` | supervisor, engineer, gerente |
| R4 | Máquinas con peor confiabilidad | ruta `dashboard` | supervisor, engineer, gerente |
| R5 | Mezcla de mantenimiento | ruta `dashboard` | supervisor, engineer, gerente |
| R6 | Costos por máquina y desviación | acción `ver_kpis_financieros` | gerente |
| R7 | Avisos de falla | rol en `ROLES_REPOSITORIO_AVISOS` | supervisor, gerente |
| R8 | Mi actividad | acción `reportar_falla` **y sin** ruta `dashboard` | operador, técnico |
| R9 | Trazabilidad de una OT | ruta `menu` (la bitácora, además, con ruta `transacciones_empresa`) | los 6 perfiles; cada uno, solo las OT que el backend le deja ver |
| R10 | Calidad de datos | acción `cambiar_estado_ot` **o** ruta `plantas` | supervisor, admin |

Agrupa la biblioteca en Desempeño (R1, R2, R5), Operación (R3, R7, R8, R9) y Confiabilidad y datos (R4, R6, R10). Ningún grupo vacío se muestra. Cada perfil de empresa ve al menos un reporte.

### 4.2 Filtros (lo que pide el usuario: «extraer solo lo que necesitan»)

**Comunes**, en un componente `filtros-reporte` propio. Reutiliza la lógica de cascada de `filtros-dashboard`, sin modificar ese componente:

- **Periodo**: 7, 30, 90 o 365 días, o histórico (`days` nulo). El backend acepta cualquier `days ≥ 1`. Solo se muestra en los reportes cuyo dato depende del periodo.
- **Topología en cascada**: planta → disciplina → máquina, con los catálogos de `/api/plants`, `/api/disciplines` y `/api/machines`. Al cambiar la planta o la disciplina, la máquina se limpia si ya no pertenece. Los ids viajan al backend cuando el endpoint los acepta. Si no, se aplican en el cliente con el conjunto de `machine_id` del catálogo.

**Propios de cada reporte** (solo los que tienen sentido):

| Reporte | Filtros además de los comunes |
|---|---|
| R1 | Granularidad de la tendencia (`day, week, month, semester, year, 5year`; por defecto la del dashboard para ese periodo) |
| R2 | Granularidad |
| R3 | **Sin periodo** (es una foto del momento). Estado abierto (`pending, assigned, overdue, in_progress, por_validar`), prioridad, tipo, técnico, tramo de antigüedad (0–2, 3–7, 8–30, más de 30 días) y «solo demoradas» |
| R4 | — (el MTBF solo aparece con 365 días o histórico; con menos, se muestra el aviso que explica por qué) |
| R5 | — |
| R6 | Tipo; estado (por defecto, sin canceladas, que es el criterio del costo del backend); «solo con desviación» (costo real distinto del estimado) |
| R7 | Estado del aviso (va al backend como `estado`), severidad, perfil de quien reporta |
| R8 | Estado del aviso y estado de la OT |
| R9 | Búsqueda por `numero_ot` (obligatoria) |
| R10 | Tipo; campo faltante (downtime, costo real, técnico) para listar las OT incompletas |

**Reglas de los filtros:**

1. **Estado en la URL** (`?dias=30&planta=2&disciplina=4&maquina=17&estado=in_progress,pending&cols=…`). Al recargar o compartir el enlace, el reporte se abre igual. Los parámetros inválidos, ajenos a la empresa (404 del backend) o incoherentes con la cascada se descartan con un aviso visible, y la URL se corrige.
2. **Una cifra solo usa los filtros que su fuente acepta.** Los KPIs del backend solo entienden periodo y topología. Si el usuario aplica un filtro que solo existe en el cliente (estado, prioridad, técnico, etc.), esas tarjetas muestran «No cambia con: estado, prioridad…» y **nunca** se mezclan con conteos filtrados de otra forma.
3. Chips con los filtros activos, botón «Limpiar» y el contador «Mostrando X de Y».
4. Un filtro que no devuelve filas muestra un estado vacío claro («Sin OT para estos filtros»). No muestra ceros que parezcan datos.

### 4.3 Sin datos sobrantes en pantalla ni en las exportaciones

- Selector de columnas por reporte, con un conjunto por defecto corto. El CSV y la tabla usan **exactamente** las columnas elegidas.
- Nunca se exportan campos internos: `ot_id`, `empresa_id`, `tecnico_id`, `photos`, `allowed_transitions`, `reporte_id` y `diagnostico_id`. El identificador visible es `numero_ot` o `numero_aviso`.
- Las columnas de costo (`costo_estimado`, `costo_real`, desviación) solo existen para perfiles con `ver_kpis_financieros`: no aparecen en el selector ni en el CSV de los demás.
- R8 nunca muestra datos de otra persona. R9 respeta el 404 del backend y no revela si la OT existe.
- Al exportar, solo se incluyen las filas filtradas, nunca el listado completo.

### 4.4 Contenido de cada reporte

- **R1:** SLA (`financials.efficiency`), disponibilidad (`disponibilidad_planta`), MTTR, MTBF (respetando `mtbf_visible` y `MtbfUnitService`), estado y motivo de `salud_operacional` y el desglose, y la tendencia de `historical`. El gerente ve además el costo directo (`costo_total_acumulado`) cuando `financieros_visibles` no es `false`.
- **R2:** tabla por periodo (`etiqueta, total_ots, completadas, sla, mttr`) y gráfico de línea.
- **R3:** tarjetas con las OT abiertas (conteo del listado), las demoradas (conteo del listado con la regla de 3.3, comparado con `estancadas.demoradas`) y las vencidas (**solo el total** `estancadas.vencidas`, rotulado «total del backend; el listado no trae la fecha de vencimiento»). También las barras por tramo de antigüedad y la tabla con detalle hasta la OT.
- **R4:** `top_5_peor_mttr` y `top_5_peor_mtbf`. Al abrir una máquina se listan las OT que explican el valor: completadas en el periodo para el MTTR y correctivas no canceladas de los últimos 365 días para el MTBF.
- **R5:** `por_tipo` con sus cuatro tipos posibles, rotulado «aproximación al PMP de SMRP: BARB cuenta OT, no horas-hombre».
- **R6:** `machines_por_costo` (top 5) y la tabla por OT con costo estimado, costo real y desviación. Montos en la moneda activa con `CurrencyService`.
- **R7:** avisos por estado y por severidad, el porcentaje descartado (descartados / total del filtro) y el tiempo promedio entre `created_at` y `resuelto_en` de los avisos ya decididos. El periodo se aplica sobre `created_at`, en el cliente.
- **R8:** mis avisos (en qué quedaron: `numero_ot` o `motivo_descarte`) y mis OT por estado.
- **R9:** `status_history` en orden cronológico. Para el gerente, también los movimientos de la bitácora de esa OT: pide `rango=custom` desde la fecha de creación hasta el cierre (o hoy), recorre las páginas hasta `total` y filtra en el cliente por tabla y `registro_id`.
- **R10:** porcentaje de OT `completed` con `downtime_minutes` no nulo, con `costo_real > 0` (rotúlalo así: el payload no distingue nulo de cero) y con `tecnico_id`. Incluye la lista de las incompletas según el filtro «campo faltante». R1 y R4 muestran una advertencia cuando, en su periodo, más de la mitad de las OT cerradas no tiene downtime.

Cada reporte incluye además:

- Una ficha **«Cómo se calcula»** por indicador: fórmula, unidad, ventana y advertencias, con los textos de `DASHBOARD_KPIS.md`, al estilo de ISO 22400-2.
- Un **resumen en palabras** generado por una función pura con plantillas, al estilo de `explicame-resumen.ts`, que solo usa cifras visibles en el reporte.

### 4.5 Exportación

- **CSV**:
  - Generado en el navegador, con BOM UTF-8.
  - Separador `;` y coma decimal en ES; separador `,` y punto decimal en EN.
  - Encabezados en el idioma activo.
  - Fechas `YYYY-MM-DD HH:mm` en hora local.
  - Escapa comillas, separadores y saltos de línea.
  - Los montos van con la moneda en el encabezado (por ejemplo, `Costo real (CLP)`).
  - Nombre de archivo: `barb_<id>_<filtros-resumidos>_<YYYY-MM-DD>.csv`.
- **PDF**: hoja de impresión (`@media print`) sin menú ni botones. Encabezado con empresa, reporte, filtros aplicados, fecha y hora de generación y usuario con su perfil. Después van los indicadores, el resumen, el gráfico, la tabla y «Cómo se calcula».

### 4.6 Idioma

Textos en `core/i18n/textos/reportes.ts` con `{ es, en }` y `en: typeof es`, registrados en `textos/index.ts`. Números, fechas y montos según el idioma y la moneda activos. Agrega las vistas nuevas a `idioma-vistas.spec.ts`.

## 5. Datos de los servicios

- Reutiliza `StatsService`, `WorkOrdersService`, `AvisosApi`, `TransaccionesEmpresaApi`, `CatalogService`, `CurrencyService` y `MtbfUnitService`. `StatsService` hoy recibe `FiltrosDashboard` y solo manda `days` cuando `rango === 7`. Para pasar 30, 90 o 365 días, agrega un método nuevo o una sobrecarga **sin cambiar** el comportamiento de los métodos actuales ni del dashboard (sus tests deben seguir verdes).
- Cuando un reporte combina dos fuentes (por ejemplo, el listado y financial-impact), pídelas juntas (`forkJoin`) y calcula los cortes de tiempo del cliente con un solo «ahora» por carga. Así se reduce el desfase con el `NOW()` del servidor.
- Separa la lógica de cada reporte en funciones puras (`filtrar`, `agregar`, `resumir` y `cuadrar`), sin `HttpClient`, para poder probarlas con fixtures.

## 6. Cuadratura con la base de datos (definición de terminado)

### 6.1 Controles dentro de la aplicación

Cada reporte tiene un panel **«Cuadratura»** con controles automáticos marcados ✓ o ✗. **Mientras un control falle, la exportación queda deshabilitada**: se muestra el motivo y un botón «Volver a cargar». Como mínimo, en los perfiles que tienen `dashboard`:

- Σ `por_tipo.total` = `salud_operacional.desglose.total` (misma respuesta).
- OT del listado dentro del mismo periodo y la misma topología = `desglose.total`. Sirve también para detectar el `[]` silencioso del listado cuando falla.
- R3: OT abiertas del listado con la topología = `en_curso + pendientes + por_validar` de financial-impact **sin `days`**, con la misma topología. Las demoradas contadas = `estancadas.demoradas`.
- R4: en el detalle de cada máquina, las OT completadas = `completadas` del top 5 y las fallas = `fallas`. Si el MTTR no cuadra por OT sin tiempo registrado, el panel lo explica: el payload no distingue nulo de 0.
- R6: Σ `costo_real` del listado (no canceladas, mismo periodo y topología) = `financials.costo_total_acumulado`.
- Las sumas de la tabla = el total de la tarjeta = el número de filas del CSV.

### 6.2 Conciliación contra la BD (SQL de solo lectura)

Crea `tools/conciliacion-reportes/conciliar.py`, **fuera de `backend/`**, con estas condiciones:

- Se ejecuta con el entorno del backend: `uv run --project backend python tools/conciliacion-reportes/conciliar.py`.
- Usa `psycopg` (ya instalado) y `urllib` de la biblioteca estándar. Sin dependencias nuevas.
- Lee `DATABASE_URL` desde `backend/.env` sin imprimirla, y las credenciales de demo desde variables de entorno (no las guardes en el repo).
- Abre cada consulta con `BEGIN READ ONLY` y termina con `ROLLBACK`. Solo `SELECT`.
- Para cada reporte, perfil y combinación de filtros, inicia sesión en la API (`http://localhost:9000`), pide los mismos datos que pide el frontend, calcula la cifra del reporte con la misma función que usa el frontend (o un espejo exacto, documentado) y la compara con una consulta SQL que **copia los predicados de `stats.py`, `work_orders.py` y `avisos.py`**: alcance por empresa (`maquina → planta.empresa_id`), alcance propio de operador y técnico, `en_sla`, estancadas y ventana del MTBF. No inventes definiciones nuevas.
- Las cifras enteras deben coincidir exactamente. Los montos y promedios, al redondeo que usa el backend (1 decimal en KPIs, 2 en montos).

Combinaciones mínimas, con usuarios de **una misma empresa** del seed (supervisor, engineer si existe, gerente, admin, operador y técnico; las credenciales están en el encabezado de `backend/seeds/02_maestros.sql`):

1. Histórico sin filtros.
2. 30 días + una planta.
3. 365 días + planta + disciplina + máquina.
4. Una combinación que no devuelve filas (debe dar 0 o vacío, no error).
5. Un id de topología de otra empresa (el backend responde 404 y el reporte lo explica).
6. Un usuario de otra empresa que nunca ve datos de la primera.

Antes de correrlo: `docker compose up -d db`, `cd backend && uv run alembic upgrade heads && uv run python scripts/seed.py`, y el backend en el puerto 9000.

### 6.3 Evidencia

`docs/reportes/CONCILIACION.md` con:

- Una tabla por reporte: perfil, filtros, cifra en la app, cifra de la API, cifra de la BD, ✓ o ✗.
- El SQL usado.
- La fecha de la corrida.
- La sección «Observaciones del backend» (como mínimo, la disponibilidad con histórico de 3.3 y el `[]` silencioso del listado).

Si algo no cuadra y la causa es del frontend, corrígelo. Si es del backend, anótalo y avísame.

## 7. Pruebas (Vitest)

- Catálogo: la tabla de visibilidad de 4.1 para los 7 roles; `super_usuario` no ve la pestaña.
- Funciones puras de cada reporte con fixtures, incluidos los bordes:
  - OT en el corte del periodo;
  - una OT a la vez vencida y demorada;
  - `downtime_minutes` nulo;
  - costos en 0;
  - los 7 estados y los 4 tipos.
- Filtros:
  - ida y vuelta por la URL;
  - limpieza de la cascada;
  - un parámetro inválido;
  - las tarjetas del backend no cambian con filtros que solo existen en el cliente.
- CSV:
  - BOM;
  - separador y decimales por idioma;
  - escape;
  - solo las columnas elegidas;
  - solo las filas filtradas;
  - sin columnas de costo para quien no tiene `ver_kpis_financieros`.
- Panel de cuadratura: deshabilita la exportación cuando un control falla.
- Idioma: sin claves faltantes en ES ni en EN.

Al final deben pasar `npm test` y `npm run build` en `frontend/`. Si tocas algo del backend por error, revierte: `git diff --stat main -- backend/` debe salir vacío.

## 8. Orden de trabajo (subtareas de HU-26)

1. Pestaña y rutas «Reportes».
2. Catálogo filtrado por perfil, con su test.
3. Componente de filtros y estado en la URL.
4. Utilidades de exportación (CSV y hoja de impresión) y panel de cuadratura.
5. R1 a R5.
6. R6 a R10.
7. Resumen en palabras y «Cómo se calcula».
8. Textos ES/EN y pruebas de idioma.
9. Script de conciliación, corrida completa y `docs/reportes/CONCILIACION.md`.

Al terminar cada subtarea: corre las pruebas y dime en 2 o 3 líneas qué quedó, qué cifras se conciliaron y qué falta.

## 9. Entrega final

Resumen breve con:

- los archivos creados y los modificados (ninguno en `backend/`);
- el resultado de `npm test` y `npm run build`;
- la tabla de conciliación resumida (cuántas cifras cuadraron de cuántas);
- las observaciones del backend;
- cualquier punto donde el código contradijo este prompt y cómo lo resolviste.
