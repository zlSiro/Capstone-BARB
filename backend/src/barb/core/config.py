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
    # 0.1, no 0.7: con 0.7 el modelo inventaba taxonomias ("te ofrezco 3 categorias") y
# cambiaba de postura ante la presion del usuario. Un asistente documental necesita
# temperatura baja; el coste es algo menos de variedad redactando.
    llm_temperature: float = 0.1
    llm_max_tokens: int = 1024
    chat_memory_window: int = 10

    # --- Multimodal (HU-05): análisis de imágenes en el chat ---
    # Diseño: docs/MULTIMODAL_ARCHITECTURE.md (D1/D5). Modelo text+imagen de NVIDIA
    # NIM, separado del chat textual (nemotron es text-only). Vacío = endpoint
    # /api/chat/multimedia responde 503.
    multimodal_model: str = "meta/muse-glimmer-30b"
    # Key dedicada al modelo multimodal. Vacía = usa NVIDIA_API_KEY: la misma key
    # de la cuenta sirve para chat + embeddings + multimodal (validado por el equipo).
    nvidia_multimodal_api_key: str = ""
    # Timeout por request (segundos): el análisis de imágenes es más lento que el
    # chat textual (ping real: 4-20 s en el free tier).
    multimodal_timeout: int = 120
    # Tamaño máximo de imagen decodificada (el base64 infla ~33% en tránsito).
    multimodal_max_image_mb: int = 5

    @property
    def multimodal_api_key(self) -> str:
        return self.nvidia_multimodal_api_key or self.nvidia_api_key

    @property
    def multimodal_configurado(self) -> bool:
        return bool(self.multimodal_model and self.multimodal_api_key)

    # --- RAG: embeddings (HU-04 — D1, D2 y D6 de docs/RAG_ARCHITECTURE.md) ---
    # El modelo produce 2048 dimensiones y `documento_embedding.embedding` está declarada
    # `vector(2048) NOT NULL` con índice HNSW sobre halfvec(2048). Cambiar de modelo no es
    # inocuo: obliga a migrar la columna (decisión de JP, ver AGENTS.md).
    embeddings_model: str = "nvidia/nemotron-3-embed-1b"
    # Key dedicada a embeddings. Vacía = usa NVIDIA_API_KEY: la misma key de la cuenta
    # sirve para chat + embeddings + multimodal (validado por el equipo).
    nvidia_embeddings_api_key: str = ""
    # Timeout por request: el free tier de NIM es de latencia variable (ya visto en HU-03).
    embeddings_timeout: int = 60
    # Fragmentos que se inyectan en el prompt (D6).
    rag_top_k: int = 4
    # Similitud mínima (coseno, 0..1) para considerar que un fragmento es relevante.
    # Medido sobre los 17 chunks reales con input_type correcto: las consultas con
    # respuesta puntúan 0.34-0.61 y las irrelevantes 0.04-0.15. 0.25 deja aire a los dos
    # lados. Sin umbral, «que hora es» inyectaría un manual y la IA respondería con
    # documentación que no viene al caso.
    rag_min_similarity: float = 0.25
    # Umbral de la SEGUNDA pasada. La recuperación semántica tolera consultas mal
    # escritas, pero el corte estricto las descartaba: «quiero ver la instrucción del
    # compresor» daba 0.229 contra el manual y se quedaba sin contexto. Con 0.15 el
    # fragmento entra, y como sigue siendo similitud real, lo irrelevante queda fuera
    # (las consultas fuera de tema medidas no pasan de 0.14).
    rag_min_similarity_laxa: float = 0.15

    @property
    def embeddings_api_key(self) -> str:
        return self.nvidia_embeddings_api_key or self.nvidia_api_key

    @property
    def embeddings_configurados(self) -> bool:
        return bool(self.embeddings_model and self.embeddings_api_key)

    # --- Resiliencia LLM (HU-03) ---
    # Lista separada por coma de proveedores de respaldo EXTRA (además del complementario
    # automático NVIDIA ↔ DeepSeek, que se activa solo si el otro tiene key).
    # Ejemplos: "openrouter", "openai", "groq"
    # Si está vacío, solo existe el respaldo automático entre NVIDIA y DeepSeek.
    llm_fallback_providers: str = ""
    # Modelo a usar cuando entra un proveedor de respaldo. Vacío = el default de ese
    # proveedor (`_MODELO_POR_PROVEEDOR` en llm_service). No se puede reusar LLM_MODEL:
    # cada API espera su propio id y un id ajeno devuelve 400.
    llm_fallback_model: str = ""

    @property
    def llm_fallback_providers_list(self) -> list[str]:
        return [p.strip() for p in self.llm_fallback_providers.split(",") if p.strip()]

    @property
    def llm_api_key(self) -> str:
        """
        Key del proveedor de chat activo.

        El mapeo vive acá y no en cada consumidor: antes el health endpoint comprobaba
        `deepseek_api_key` a mano, así que con `LLM_PROVIDER=nvidia` reportaba «offline»
        aunque el chat funcionara. Cualquier otro sitio que necesite saber si el LLM está
        configurado debe usar esta propiedad.
        """
        return {
            "deepseek": self.deepseek_api_key,
            "openai": self.openai_api_key,
            "openrouter": self.openrouter_api_key,
            "groq": self.groq_api_key,
            "nvidia": self.nvidia_api_key,
        }.get(self.llm_provider, "")

    @property
    def llm_env_var(self) -> str:
        """Nombre de la variable de entorno que hay que definir para el proveedor activo."""
        return f"{self.llm_provider.upper()}_API_KEY"

    @property
    def llm_configurado(self) -> bool:
        return bool(self.llm_model and self.llm_api_key)

    # --- CORS ---
    cors_origins: str = "http://localhost:4200,http://localhost:5173,http://localhost:3000"
    cors_origin_regex: str = r"https://barb.*\.vercel\.app"

    # --- Constantes de negocio ---
    sla_target_minutes: int = 24 * 60
    downtime_cost_per_minute: int = 2000
    # Tiempo medio de resolución SIN BARB, en minutos. Origen:
    # `Barb_Documento_de_Negocio.docx` §8.2 "Proyección de ahorro económico", que
    # proyectaba 180 min sin el sistema y 45 con él.
    #
    # Se subió a 480 (una jornada laboral completa) por decisión de negocio: el escenario
    # sin sistema no es "resolver la falla", es hacerlo buscando manuales en papel, sin
    # historial de fallas del equipo y sin asignación automática de técnico. En la
    # industria una correctiva así se come el turno entero, no tres horas.
    #
    # Es un SUPUESTO DE NEGOCIO, no un dato medido: por eso vive aquí y no
    # hardcodeado en el router. El escenario "sin BARB" del impacto anual lo usa, y los
    # tests lo leen de `settings` para no fijarlo dos veces.
    impact_without_barb_minutes: int = 480
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

