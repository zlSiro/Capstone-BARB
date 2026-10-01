# Órdenes de Trabajo (OT) — Creación

Documento de la HU-07 «Usuario crea OT». Cubre modelo, contrato API, validaciones, permisos, flujo y verificación.

## 1. Modelo de creación

| Campo (API) | Alias aceptados | Obligatorio | Tipo / valores | Notas |
|---|---|---|---|---|
| `maquina_id` | `machine_id` | Sí | entero | Debe existir en `maquina`. |
| `tecnico_id` | `technician_id` | Sí | entero | Debe existir, estar activo y tener rol `tecnico`. |
| `descripcion_problema` | `description`, `title`, `issue_description` | Sí | texto, máx. 5000 | El frontend envía `título + "\n\n" + descripción`. |
| `tipo` | — | No (`corrective`) | `corrective`, `preventive`, `predictive`, `inspection` | |
| `priority` | — | No (`medium`) | `low`, `medium`, `high`, `urgent` | |
| `severity` | — | No | `low`, `medium`, `high`, `critical` | |
| `estado` | `status` | No (`pending`) | `pending`, `assigned`, `in_progress`, `completed`, `cancelled`, `overdue` (también `open`, `closed`, etc.) | |
| `descripcion_reparacion` | — | No | texto | |
| `resolution` | — | No | texto | |
| `fecha_vencimiento` | `due_date` | No | ISO 8601 | |
| `photos` / `images` / `attachments` / `photo` | — | No | archivos JPEG, PNG o WEBP (solo `multipart`) | |

- `creado_por` **no** se acepta desde el cliente: siempre es el usuario de la sesión autenticada.
- `numero_ot` se genera en el servidor con el formato `OT-<año>-<ot_id con 4 dígitos>` (ej. `OT-2026-0042`). El cliente no lo envía.

## 2. Contrato API

`POST /api/work-orders` (alias `POST /api/work_orders`)

- Header: `Authorization: Bearer <token>`.
- `Content-Type`: `application/json` o `multipart/form-data` (para adjuntar fotos).

Ejemplo de request (JSON):

```json
{
  "maquina_id": 1,
  "tecnico_id": 4,
  "descripcion_problema": "Vibración anormal en motor D1",
  "priority": "high",
  "tipo": "corrective"
}
```

Response `200`: la OT creada, con la misma forma que `GET /api/work-orders/{numero_ot}` (`row_to_work_order`):
`numero_ot`, `ot_id`, `title`, `description`, `machine`/`machine_name`, `machine_id`, `plant`/`plant_name`, `discipline`/`discipline_name`, `priority`, `status` (legible), `estado` (valor BD), `severity`, `tipo`, `tecnico_nombre`, `created_at`, `photos`, `photo_count`, etc.

### Errores

| Código | Cuándo | Ejemplo de `detail` |
|---|---|---|
| 400 | Campo obligatorio vacío, no numérico, JSON inválido, descripción > 5000, estado inválido | `El campo 'maquina_id' es obligatorio.` |
| 401 | Sin sesión o sesión expirada | `Sesión inválida o expirada. Vuelve a iniciar sesión.` |
| 403 | Rol sin permiso `crear_ot` | `El rol 'tecnico' no puede ejecutar 'crear_ot'.` |
| 415 | `Content-Type` no soportado, o foto que no es JPEG/PNG/WEBP | `Content-Type no soportado para crear OT.` |
| 422 | Valor de enum inválido, máquina o técnico inexistente, usuario sin rol técnico o inactivo | `La máquina 999 no existe.` |
| 500 | Error interno (el detalle se registra en el log, no se expone) | `Error interno al crear la OT.` |

## 3. Permisos

Acción `crear_ot` (`backend/src/barb/core/permissions.py`, espejo en `frontend/src/app/core/permissions/permissions.ts`):
solo **gerente** y **admin**. Los demás roles reciben `403` y no ven el botón «Crear OT».

## 4. Flujo completo

1. En la lista de OT (`/work-orders`), gerente/admin pulsa **+ Crear OT**; se abre `CreateOtModalComponent`.
2. El modal carga catálogos (`/api/disciplines`, `/api/machines`, `/api/technicians`). Las máquinas se filtran por disciplina.
3. Validación en el cliente (Signal Forms): título, disciplina, máquina, técnico y descripción obligatorios; no se aceptan textos solo con espacios. Foto opcional (JPEG/PNG/WEBP).
4. Envío `multipart/form-data` a `POST /api/work-orders`.
5. El backend: autentica → verifica permiso → valida payload y enums → verifica máquina y técnico → inserta la OT y genera `numero_ot` en una transacción → guarda fotos (si falla, revierte la OT).
6. Éxito: toast «OT … creada correctamente», la OT se agrega al inicio de la lista y el modal se cierra. Error: toast con el mensaje del backend (o uno genérico según código).

## 5. Formulario (frontend)

| Campo | Requerido | Mensaje de error |
|---|---|---|
| Título | Sí | Ingresa un título para la OT. |
| Disciplina | Sí | Selecciona una disciplina. |
| Máquina | Sí | Selecciona una máquina. |
| Técnico | Sí | Selecciona un técnico. |
| Prioridad | No (default Media) | — |
| Estado | No (default Abierta) | — |
| Descripción | Sí | Describe la falla. |
| Foto | No | Solo se permiten imágenes JPEG, PNG o WEBP. |

Accesibilidad: el modal es `role="dialog"` con `aria-modal`, cada campo tiene `label` asociado, los errores usan `role="alert"` y `aria-invalid`/`aria-describedby`; se cierra con `Esc`. Diseño responsive con Tailwind (grilla de 1 columna en móvil, 2 desde `md`, scroll interno si el contenido excede la pantalla).

## 6. Tests y verificación

Backend: `uv run pytest tests/test_work_orders_create.py` (requiere Postgres, migraciones y seed). Cubre caso feliz, aparición en listado, `creado_por` desde sesión, 403 para técnico/operador, campos vacíos (400), máquina/técnico inexistentes y enums inválidos (422), 415 y JSON inválido.

Checklist manual end-to-end (`uv run fastapi dev src/barb/main.py --port 9000` + `npm start`):

- [ ] Login como `gerente1@planta.com` o `admin@barb.com`: aparece **+ Crear OT**.
- [ ] Login como `carlos@planta.com` (técnico) u `operador1@planta.com`: el botón no aparece; un `POST` directo responde 403.
- [ ] Crear OT válida: toast de éxito y la OT aparece primera en la lista.
- [ ] Enviar con campos vacíos: errores en línea, no hay request.
- [ ] `POST` con `maquina_id` inexistente: 422 con mensaje claro, toast de error en el modal.
