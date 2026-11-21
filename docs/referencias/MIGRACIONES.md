Local

# 1. DB (Docker Desktop encendido)
docker compose up -d db

# 2. Backend
cd backend
uv sync
uv run alembic upgrade head          # aplica 0006
uv run python scripts/seed.py        # seed

Si tu BD local ya existía, el seed no actualiza vencimientos. Pon OTs atrasadas a mano:

UPDATE orden_trabajo SET fecha_vencimiento = NOW() - INTERVAL '5 days'
WHERE estado NOT IN ('completed','cancelled');

backend/.env, agrega:

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=BARB <no-reply@barb.com>
SMTP_STARTTLS=false
JOB_TOKEN=dev-token

Servidor SMTP falso, en otra terminal (imprime el correo en consola):

cd backend
uv run --with aiosmtpd python -m aiosmtpd -n -l localhost:1025

Alternativa: Mailtrap con sus credenciales y SMTP_STARTTLS=true.

# 3. Dev server
uv run fastapi dev src/barb/main.py --port 9000

Probar en http://localhost:9000/docs:
1. Login supervisor1@planta.com / super123, Authorize con el token.
2. PUT /api/notificaciones/config con {"activo":true,"frecuencia":"diaria","horlanta.cl"]}.
3. POST /api/notificaciones/prueba y el correo sale en la consola del SMTP.
4. Job:

curl.exe -X POST -H "X-Job-Token: dev-token" "http://localhost:9000/api/jobs/ot
5. O sin HTTP: uv run python scripts/run_overdue_job.py --force.

Tests: uv run pytest tests/test_overdue_report.py -v

Supabase

1. En Supabase, Connect, copia los dos strings: Session pooler (:5432) y Transa
2. Migrar y sembrar desde tu PC con Session pooler:
cd backend
$env:DATABASE_URL = "postgresql://postgres.<REF>:<PASS>@aws-0-<REGION>.pooler.supabase.com:5432/postgres"
uv run alembic current     # debe mostrar 0005_merge_heads
uv run alembic upgrade head
uv run python scripts/seed.py   # solo si falta data demo
   La variable de entorno pisa el .env. Cierra la terminal después, o haz Remove-Item Env:DATABASE_URL.
3. Correr el backend local contra Supabase: pon el Transaction pooler (:6543) en DATABASE_URL del .env y levanta con fastapi dev. Las vars SMTP quedan igual.
4. Si migras Supabase antes de mergear, el código viejo de Render sigue funcionando (la migración es aditiva). Primero migración, luego merge.
5. Render, Environment: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FReatorio, no dev-token).
6. SMTP real en prod: Gmail con app password (smtp.gmail.com:587) o Brevo. Mailles.
7. GitHub, Settings, Secrets and variables, Actions: API_URL (https://<tu-app>.onrender.com) y JOB_TOKEN (igual que en Render).
8. Prueba: en Actions, workflow overdue-report, Run workflow. Debe responder JSON con enviados.

Las OTs en Supabase necesitan fecha_vencimiento para aparecer. Hasta que el fro en el editor de Supabase.