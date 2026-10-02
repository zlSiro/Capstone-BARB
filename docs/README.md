# Capstone-BARB
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