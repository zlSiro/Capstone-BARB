from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Base de datos (DSN libpq, psycopg3) ---
    database_url: str = "postgresql://barb_admin:barb_password123@localhost:5432/barb_database"

    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"

    # --- Archivos ---
    upload_dir: Path = Path("./uploads")

    # --- DeepSeek (fase 2) ---
    deepseek_api_key: str | None = None

    # --- CORS ---
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    cors_origin_regex: str = r"https://barb.*\.vercel\.app"

    # --- Constantes de negocio ---
    sla_target_minutes: int = 24 * 60
    downtime_cost_per_minute: int = 2000
    debug_history_limit: int = 5

    # --- Prompt del sistema (fase 2) ---
    barb_system_prompt: str = (
        "Eres BARB, asistente experto en mantenimiento industrial. "
        "Responde de forma clara, técnica y concisa. "
        "Si el usuario menciona una máquina específica, orienta tu respuesta a ese equipo."
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)
