from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Base de datos (DSN libpq, psycopg3) ---
    database_url: str = "postgresql://barb_admin:barb_password123@localhost:5432/barb_database"

    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"

    # --- Supabase Storage (HU-04 / RAG) ---
    # Tolerante a fallos (patrón Redis): sin estas variables, los endpoints de
    # documentos responderán 503 y el resto de la app funciona igual.
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_bucket: str = "barb-files"

    @property
    def storage_configurado(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    # --- Correo (HU OTs atrasadas) ---
    # SMTP genérico. Tolerante a fallos (patrón Redis/Supabase): sin SMTP_HOST el job
    # de OTs atrasadas responde 503 y el resto de la app funciona igual.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True
    # Token que debe enviar el cron externo en el header X-Job-Token. Vacío = job deshabilitado.
    job_token: str = ""
    notif_timezone: str = "America/Santiago"
    frontend_url: str = ""

    @property
    def smtp_configurado(self) -> bool:
        return bool(self.smtp_host and (self.smtp_from or self.smtp_user))

    # --- Archivos ---
    upload_dir: Path = Path("./uploads")

   # --- APIs de IA ---
    llm_provider: Literal["deepseek", "openai", "openrouter", "groq", "nvidia"] = "deepseek"
    openrouter_api_key: str = ""
    groq_api_key: str = ""
    deepseek_api_key: str = ""
    openai_api_key: str = ""
    nvidia_api_key: str = ""
    # NVIDIA NIM (build.nvidia.com) expone una API OpenAI-compatible.
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    # Timeout por request (segundos): el endpoint gratuito puede saturarse
    # y dejar la conexión colgada; sin esto la lib OpenAI espera hasta 600s.
    nvidia_timeout: int = 60
    # Vía chat_template_kwargs: algunos modelos NIM (Nemotron, DeepSeek) traen
    # "thinking" habilitado por defecto y emiten razonamiento interno antes de
    # la respuesta. En false → respuestas directas en el chat.
    nvidia_enable_thinking: bool = False

    # --- Configuración LLM ---
    llm_model: str = "deepseek-chat"
    llm_temperature: float = 0.7
    llm_max_tokens: int = 1024
    chat_memory_window: int = 10

    # --- Resiliencia LLM (HU-03) ---
    # Lista separada por coma de proveedores de respaldo (se usan si el primario falla).
    # Ejemplos: "openrouter", "openai", "groq"
    # Si está vacío, no hay fallback entre proveedores (solo reintentos).
    llm_fallback_providers: str = ""

    @property
    def llm_fallback_providers_list(self) -> list[str]:
        return [p.strip() for p in self.llm_fallback_providers.split(",") if p.strip()]

    # --- CORS ---
    cors_origins: str = "http://localhost:4200,http://localhost:5173,http://localhost:3000"
    cors_origin_regex: str = r"https://barb.*\.vercel\.app"

    # --- Constantes de negocio ---
    sla_target_minutes: int = 24 * 60
    downtime_cost_per_minute: int = 2000
    debug_history_limit: int = 5

    # --- Prompt del sistema ---
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