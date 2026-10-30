# Avisos de falla: del reporte en planta a la OT

Fase 1 de la propuesta de roles y privilegios. Cubre el modelo, el contrato de la API, los permisos, el flujo y la verificación.
Complementa a `WORK_ORDERS.md` (HU-07 y HU-09) y a `matriz_rol.md` (matriz completa de roles).

## 1. El flujo

```
  PLANTA                                  SUPERVISOR / GERENTE
  operador · técnico · supervisor         repositorio de avisos de toda la empresa
  · ingeniero · gerente
         │  reporta una falla                        │
         ▼                                           ▼
   ┌───────────┐   llega al repositorio   ┌─────────────────────┐
   │  Aviso    │ ───────────────────────► │ decide:             │
   │ pendiente │                          │  · generar una OT   │──► OT asignada (enlazada al aviso)  → aviso «Con OT»
   └───────────┘                          │  · descartar (motivo)│──► sin OT                           → aviso «Descartado»
                                          └─────────────────────┘
```

- Quien reporta solo ve **sus** avisos y en qué quedaron (número de OT o motivo del descarte).
- Supervisor y gerente ven el repositorio **completo de su empresa** y son los únicos que deciden.
- El administrador y el superusuario no reportan ni ven avisos.

## 2. Modelo de datos

> **Cambio de esquema.** `AGENTS.md` establece que las migraciones y tablas nuevas las autoriza y gestiona JP. Esta migración
> (`0012_aviso_falla`) se creó a pedido expreso del equipo y **debe coordinarse con JP antes de mergearse o aplicarse en Supabase**.
> Depende de la `0011_sla_costo_maquina` (que Supabase aún no tiene). El despliegue no ejecuta migraciones: hay que aplicarla a mano.

Migración `backend/migrations/versions/0012_aviso_falla.py`. Los avisos tienen tabla propia, con las columnas del formulario
«Reportar falla»:

| Columna de `aviso_falla` | Contenido |
|---|---|
| `aviso_falla_id` (PK) | Id del aviso |
| `numero_aviso` (único) | Número visible: `AV-<año>-<id con 4 dígitos>`, p. ej. `AV-2026-0007` |
| `maquina_id` → `maquina` | Máquina con la falla (de ahí salen la planta y la empresa) |
| `reportado_por` → `usuario` | Quien reportó (cualquier rol con `reportar_falla`) |
| `descripcion` | Qué está pasando |
| `severidad` (`nivel_severidad`) | Gravedad que percibe quien reporta (`low`, `medium`, `high`, `critical`) |
| `estado` | `pendiente` · `con_ot` · `descartado` (restricción `CHECK`) |
| `foto_nombre`, `foto_archivo`, `foto_content_type`, `foto_ruta` | Foto opcional: nombre original, nombre guardado, tipo y ruta **relativa** a `upload_dir`. El archivo vive en disco (`upload_dir/avisos/<id>/`) |
| `resuelto_por` → `usuario`, `resuelto_en` | Quién decidió y cuándo (obligatorios si el estado no es `pendiente`) |
| `motivo_descarte` | Obligatorio si el aviso se descartó (`CHECK`) |
| `created_at` | Cuándo se reportó |

**Relación con las OT:** `orden_trabajo.aviso_falla_id` (nuevo, FK a `aviso_falla`, `NULL` si la OT se creó directamente) guarda el id del
aviso que originó la OT. Un índice único parcial garantiza que **un aviso origina como máximo una OT**. Si algún día se borrara el aviso,
la OT se conserva (`ON DELETE SET NULL`).

La migración también instala el trigger `trg_transaccion` en `aviso_falla`, para que los avisos sigan quedando en la bitácora de transacciones.
No migra filas de `reporte` (el seed y los reportes antiguos no se tocan): la funcionalidad de avisos no estaba desplegada.

## 3. Permisos

| Acción | Roles | Qué permite |
|---|---|---|
| `reportar_falla` | operador, técnico, supervisor, ingeniero, gerente | Crear avisos y ver los propios |
| `gestionar_avisos` | supervisor, gerente | Ver el repositorio completo, generar OT y descartar |
| `asignar_ot` | supervisor, gerente | Priorizar, asignar y reasignar una OT abierta |

La pantalla `/avisos` (ruta `avisos`) la ven quienes reportan; el administrador y el superusuario no tienen acceso (403).

## 4. Contrato de la API

Todas las rutas exigen `Authorization: Bearer <token>`. La empresa sale siempre de la sesión.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| POST | `/api/avisos` | `reportar_falla` | Crea el aviso. JSON `{maquina_id, descripcion, severidad?}` o `multipart/form-data` con los mismos campos y la foto opcional en `foto` (`severidad` por defecto `medium`). 201 |
| GET | `/api/avisos?estado=` | `reportar_falla` | Lista. `estado` = `pendiente` \| `con_ot` \| `descartado`. Supervisor/gerente: toda la empresa; el resto: solo lo que reportó. Pendientes primero, luego por gravedad y fecha |
| GET | `/api/avisos/{id}` | `reportar_falla` | Detalle (404 si no existe, es de otra empresa o no es suyo) |
| GET | `/api/avisos/{id}/foto` | `reportar_falla` | Descarga la foto adjunta (imagen). Misma visibilidad que el aviso. 404 si no tiene foto o ya no está en disco |
| POST | `/api/avisos/{id}/generar-ot` | `gestionar_avisos` | Crea la OT enlazada al aviso. Body: `{tecnico_id, priority?, tipo?, severity?, fecha_vencimiento?, descripcion_problema?}`. Responde `{aviso, ot}` |
| POST | `/api/avisos/{id}/descartar` | `gestionar_avisos` | Body: `{motivo}` (obligatorio, 3–500 caracteres). Responde el aviso |
| PATCH | `/api/work-orders/{numero_ot}/assignment` | `asignar_ot` | Body: `{tecnico_id?, priority?, fecha_vencimiento?}` (al menos uno). Solo OT abiertas |

Forma del aviso (claves en español e inglés para el mismo dato, como en las OT):

```json
{
  "aviso_id": 7, "numero_aviso": "AV-2026-0007",
  "maquina_id": 1, "machine": "Compressor A1", "machine_name": "Compressor A1",
  "plant": "Planta Central", "plant_name": "Planta Central", "empresa_id": 1,
  "descripcion": "Vibración anormal en el motor", "description": "Vibración anormal en el motor",
  "severidad": "high", "severity": "high",
  "estado": "pendiente", "status": "Pendiente",
  "reportado_por": {"id": 11, "nombre": "Operador Molino", "rol": "operador"},
  "created_at": "2026-10-28T12:00:00Z",
  "resuelto_en": null, "resuelto_por": null, "motivo_descarte": null, "numero_ot": null,
  "foto": {"original_name": "falla.png", "content_type": "image/png"}
}
```

Errores: `401` sin sesión · `403` rol sin permiso · `404` aviso inexistente, de otra empresa o ajeno · `409` el aviso ya fue atendido o
descartado (o la OT ya está cerrada, en `assignment`) · `413` la imagen supera 5 MB · `415` el archivo no es una imagen JPEG/PNG/WEBP
válida (se comprueba también la firma del archivo, no solo el `Content-Type` que declara el cliente) · `422` datos inválidos (máquina de otra empresa, técnico inexistente o sin rol
técnico, motivo vacío o demasiado corto, prioridad o gravedad fuera del catálogo).

### La foto de la falla

- Es opcional: una imagen **JPEG, PNG o WEBP de hasta 5 MB**. Se valida el tipo declarado y la firma del archivo; lo rechazado no deja
  avisos ni archivos a medias.
- Se guarda en disco (como las fotos de las OT) y se sirve por `GET /api/avisos/{id}/foto` con `X-Content-Type-Options: nosniff`. La ruta
  guardada es relativa a `upload_dir` y se verifica que no escape de esa carpeta.
- Al **generar la OT** la foto se copia a `ot_foto`: la OT nace con la evidencia (`photos` / `photo_count`). Si el archivo ya no está
  (el disco de Render es efímero), la OT se crea igual, sin foto.

### Reglas de la conversión en OT

- Todo ocurre en **una transacción**: se bloquea el aviso (`FOR UPDATE`), se crea la OT y el aviso pasa a `con_ot`. Dos supervisores
  no pueden convertir el mismo aviso: el segundo recibe 409 y no se crea una segunda OT.
- La OT hereda del aviso la descripción y la gravedad (`severity`), salvo que el supervisor indique otras.
- El vencimiento se calcula con el SLA de la máquina × el factor de la prioridad, igual que en la creación directa de una OT.
- Quien reportó pasa a ver la OT en su listado: el alcance «propio» incluye las OT nacidas de sus avisos.
- Todo queda en la bitácora de transacciones (los triggers cubren `aviso_falla` y `orden_trabajo`).
- La OT guarda el id del aviso (`aviso_falla_id`) y la API la devuelve con `aviso_falla_id` y `numero_aviso`. El modal de detalle de la OT
  muestra ese número en la esquina superior derecha, con el rótulo «Reporte de falla de origen»; una OT creada directamente no muestra nada.

## 5. Alcance por rol en las OT

Con este cambio, `operador` y `tecnico` dejan de ver todas las OT de la empresa: ven las que tienen asignadas, las que crearon o las
nacidas de un aviso suyo (listado, detalle, topología y canal SSE). El técnico asignado puede **iniciar** su OT
(`pending → in_progress`); cerrar y cancelar sigue siendo de supervisión. Ver `matriz_rol.md`.

## 6. Frontend

- Pantalla `/avisos` (`features/avisos/`), con el ítem «Avisos de falla» en el menú:
  - Supervisor y gerente: «Avisos de falla», filtro por estado (parte en «Pendiente») y, en cada pendiente, **Generar OT** o **Descartar**.
  - El resto: «Mis avisos de falla», con el resultado de cada uno, y el botón **+ Reportar falla**.
  - El formulario de **Reportar falla** incluye **Adjuntar foto** (con vista previa y opción de quitarla); valida tipo y tamaño antes de enviar.
  - Los avisos con foto muestran **Ver foto**, que abre un visor (la imagen se descarga con la sesión del usuario).
- Diálogos: `ReportarFalla`, `GenerarOtAviso` (técnico, prioridad sugerida según la gravedad y vencimiento opcional) y `DescartarAviso` (motivo).
- La lista de OT permite al técnico iniciar las suyas (el selector de estado sale de `allowed_transitions`, ya filtrado por rol y por asignación).
- El formulario de usuarios del administrador solo ofrece roles operativos.

## 7. Pendiente (fases siguientes)

No se implementó en esta fase: registro de avance del técnico (notas, fotos, repuestos); datos de cierre obligatorios
(resolución, tiempo de parada, costo); aviso en tiempo real al supervisor cuando llega un aviso; y separar los KPIs financieros del
dashboard para el gerente. Las solicitudes **sin técnico** no existen: al generar la OT el supervisor elige el técnico (si en el futuro se
quiere asignar después, haría falta permitir `tecnico_id` nulo, un cambio de esquema que debe autorizar JP).

## 8. Verificación

```bash
cd backend && uv run alembic upgrade heads   # necesita la migración 0012 (y la 0011 de main)
cd backend && uv run pytest tests/test_avisos.py tests/test_work_orders_asignacion.py tests/test_permissions.py \
  tests/test_work_order_states.py tests/test_work_orders_status.py tests/test_realtime_broker.py tests/test_realtime_stream.py
cd frontend && npm test
```

Usuarios del seed: `operador1@planta.com / operador123`, `carlos@planta.com / tecnico123` (técnico asignado de las pruebas),
`supervisor1@planta.com / super123`, `gerente1@planta.com / gerente123`, `admin@barb.com / admin123`.

- [ ] Operador: **+ Reportar falla**, adjuntando una imagen → el aviso aparece en «Mis avisos» como Pendiente y con «Ver foto».
- [ ] Operador: intentar adjuntar un `.txt` o una imagen de más de 5 MB → se rechaza con un mensaje.
- [ ] Supervisor: en «Avisos de falla» ve el aviso pendiente; **Generar OT** con un técnico → el aviso queda «Con OT» y la OT aparece en la lista.
- [ ] Supervisor: en el repositorio abre **Ver foto**; al generar la OT, esta queda con la foto adjunta.
- [ ] Operador: ahora ve la OT en «Órdenes de Trabajo» y el aviso muestra su número.
- [ ] Supervisor: **Descartar** otro aviso sin motivo → error; con motivo → «Descartado»; el operador ve el motivo.
- [ ] Técnico: ve solo sus OT y puede iniciar la suya, pero no cerrarla ni cancelarla.
- [ ] Administrador: no ve «Avisos de falla» ni puede crear OT; en Usuarios solo ofrece roles operativos.
