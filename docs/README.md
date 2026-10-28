# Capstone-BARB
---

## Documentación por tema

| Documento | Contenido |
|---|---|
| [`DASHBOARD_KPIS.md`](./DASHBOARD_KPIS.md) | Las 6 fórmulas del dashboard, los 4 gráficos, el selector de rango, los tooltips flotantes, el modo oscuro y la deuda conocida (HU-08 + HU-16) |
| [`WORK_ORDERS.md`](./WORK_ORDERS.md) | Órdenes de trabajo: modelo, contrato API, validaciones y permisos |
| [`AVISOS_FALLA.md`](./AVISOS_FALLA.md) | Avisos de falla desde planta, repositorio del supervisor y decisión de generar una OT (roles y privilegios, fase 1) |
| [`MULTIEMPRESA.md`](./MULTIEMPRESA.md) | Multi-empresa, documentación por empresa y `super_usuario` |
| [`NOTIFICACIONES.md`](./NOTIFICACIONES.md) | Correo de OTs atrasadas |
| [`MIGRACIONES.md`](./MIGRACIONES.md) | Migraciones de base de datos |
| [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) | Arquitectura RAG (HU-04) |
| [`AI_ARCHITECTURE.md`](./AI_ARCHITECTURE.md) | Arquitectura de IA y gestión de memoria |
| [`contrato_api_chat.md`](./contrato_api_chat.md) | Contrato API del chat |
| [`contrato_api_documents.md`](./contrato_api_documents.md) | Contrato API de documentos (HU-04) |

---

## 📄 3. `README.md` — versión completa

Reemplaza todo el contenido por esto:

```markdown
# BARB — Backend

Backend de la plataforma de mantenimiento industrial predictivo con IA.

- **Stack:** Python 3.12 · FastAPI · PostgreSQL 17 · LangChain 1.x
- **Gestor de dependencias:** `uv`
- **Base de datos:** Docker local + Supabase en producción
- **LLM activo:** DeepSeek (`deepseek-chat`)

---

## 🚀 Instalación rápida

```bash
# 1. Clonar el repo
git clone https://github.com/zlSiro/Capstone-BARB.git
cd Capstone-BARB/backend

# 2. Instalar dependencias
uv sync



# 3. Levantar PostgreSQL local
docker compose up -d db

# 4. Aplicar migraciones y seed
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python scripts/seed.py

# 5. Configurar variables de entorno (ver sección siguiente)
cp .env.example .env

# 6. Arrancar el backend
uv run fastapi dev src/barb/main.py --port 9000

---

## 🧪 Tests

### Suite completa

```bash
uv run pytest -v