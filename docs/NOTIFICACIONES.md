# Correo de OTs atrasadas

HU: «Como supervisor de mantenimiento, quiero recibir correos con las OTs atrasadas, para actuar a tiempo».
Migración: `backend/migrations/versions/0006_notificacion_config.py`.

## Cómo funciona

1. Un cron externo (GitHub Actions, cada hora) llama `POST /api/jobs/ot-atrasadas` con `X-Job-Token`.
   Render free duerme sin tráfico, por eso no hay scheduler dentro del proceso.
2. Por cada empresa con notificación **activa**, el backend revisa su frecuencia/hora (`debe_enviar`).
   Es idempotente: dentro de un mismo período solo se envía una vez (`ultimo_envio`).
3. Consulta las OTs atrasadas de **esa empresa** y envía un correo (HTML + texto) con ID, máquina,
   técnico, estado y días de atraso. Sin OTs atrasadas no se envía nada.

**OT atrasada** = estado ≠ `completed`/`cancelled` y `fecha_vencimiento` ya pasada.
OTs sin `fecha_vencimiento` se ignoran. Días de atraso = diferencia de fechas calendario en `NOTIF_TIMEZONE`.

Al activar la config por primera vez (o tras un tiempo inactiva), el siguiente cron puede enviar de inmediato
si el último horario programado ya pasó.

## Configuración (env)

`SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` (true),
`JOB_TOKEN`, `NOTIF_TIMEZONE` (America/Santiago), `FRONTEND_URL`. Sin `SMTP_HOST` el job responde 503.
Dev: Mailtrap, o `python -m aiosmtpd -n -l localhost:1025` con `SMTP_STARTTLS=false`.

## API (contrato para el frontend)

Permiso: acción `configurar_notificaciones` (supervisor, gerente, admin, super_usuario).
El `super_usuario` debe pasar `?empresa_id=`; los demás siempre usan su empresa (se ignora el parámetro).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/notificaciones/config` | Config de la empresa (defaults si no existe). |
| PUT | `/api/notificaciones/config` | Upsert. Body abajo. |
| POST | `/api/notificaciones/prueba` | Envía el reporte ahora (aunque no haya OTs). 422 sin destinatarios, 503 sin SMTP, 502 si falla el envío. |
| GET | `/api/notificaciones/preview` | `{empresa_id, total, ots[]}` con las OTs atrasadas actuales. |
| POST | `/api/jobs/ot-atrasadas` | Solo cron. Header `X-Job-Token`. Query `force`, `empresa_id`. |

```json
{ "activo": true, "frecuencia": "diaria|semanal", "hora": 8, "dia_semana": null, "destinatarios": ["jefe@planta.cl"] }
```

`hora` 0–23 en `NOTIF_TIMEZONE`; `dia_semana` 0=lunes…6=domingo, obligatorio si `semanal`; máx. 20 destinatarios
(se normalizan a minúsculas y sin duplicados); `activo=true` exige ≥1 destinatario.

## Pendiente en frontend (otro compañero)

- El formulario de creación de OT no envía `fecha_vencimiento` (el backend la acepta, alias `due_date`): sin ella ninguna OT nueva puede atrasarse.
- Replicar en `core/permissions/permissions.ts` la ruta `notificaciones` y la acción `configurar_notificaciones`.
- Pantalla de configuración usando los endpoints de arriba.

## Despliegue

Aplicar la migración en Supabase **antes** de mergear (DEPLOY.md §2.4). Cargar variables SMTP/`JOB_TOKEN` en Render
y secrets `API_URL` + `JOB_TOKEN` en GitHub. Alternativa local/otro host: `uv run python scripts/run_overdue_job.py [--force] [--empresa N]`.
