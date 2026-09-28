# backend/src/barb/services/llm_service.py

from __future__ import annotations

from langchain_core.chat_history import InMemoryChatMessageHistory
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory

from barb.core.config import settings

# ---------------------------------------------------------------------------
# Almacén en memoria por sesión (se reemplazará por PostgreSQL en CGBIDA-150)
# ---------------------------------------------------------------------------
_store: dict[str, InMemoryChatMessageHistory] = {}


def get_session_history(session_id: str) -> InMemoryChatMessageHistory:
    """Devuelve el historial de una sesión, creándolo si no existe."""
    if session_id not in _store:
        _store[session_id] = InMemoryChatMessageHistory()
    return _store[session_id]


# ... (imports y _store y get_session_history quedan igual) ...


def _build_llm(provider: str | None = None):
    """
    Construye el LLM según el proveedor indicado (o el activo si es None).
    Soporta 'deepseek', 'openai', 'openrouter' y 'groq'.
    """
    provider = provider or settings.llm_provider

    if provider == "deepseek":
        from langchain_deepseek import ChatDeepSeek

        if not settings.deepseek_api_key:
            raise RuntimeError("DEEPSEEK_API_KEY no configurada en .env")

        return ChatDeepSeek(
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
            streaming=True,
            api_key=settings.deepseek_api_key,
        )

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY no configurada en .env")

        return ChatOpenAI(
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
            streaming=True,
            api_key=settings.openai_api_key,
        )

    if provider == "openrouter":
        from langchain_openrouter import ChatOpenRouter

        if not settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY no configurada en .env")

        return ChatOpenRouter(
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
            streaming=True,
            api_key=settings.openrouter_api_key,
        )

    if provider == "groq":
        from langchain_groq import ChatGroq

        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY no configurada en .env")

        return ChatGroq(
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
            streaming=True,
            api_key=settings.groq_api_key,
        )

    raise ValueError(f"Proveedor LLM no soportado: {provider}")


# --- Configuración de reintentos ---
_RETRY_CONFIG = {
    "stop_after_attempt": 3,
    "wait_exponential_jitter": True,
}


def _build_llm_with_resilience():
    """
    Construye el LLM con reintentos automáticos y fallback entre proveedores.

    - Reintentos: 3 intentos con backoff exponencial + jitter.
    - Fallback: si el primario falla tras los reintentos, prueba en orden los
      proveedores listados en LLM_FALLBACK_PROVIDERS. Los proveedores sin key
      configurada se omiten silenciosamente.
    """
    primary = _build_llm().with_retry(**_RETRY_CONFIG)

    fallbacks = []
    for provider in settings.llm_fallback_providers_list:
        if provider == settings.llm_provider:
            continue  # no duplicar el primario
        try:
            fallbacks.append(_build_llm(provider).with_retry(**_RETRY_CONFIG))
        except RuntimeError:
            # Proveedor sin API key → se omite del fallback
            continue

    if fallbacks:
        return primary.with_fallbacks(fallbacks)

    return primary


def create_conversation_chain(session_id: str) -> RunnableWithMessageHistory:
    """
    Crea una cadena conversacional con memoria persistente por sesión,
    aplicando reintentos y fallback al LLM.
    """
    llm = _build_llm_with_resilience()

    prompt = ChatPromptTemplate.from_messages([
        ("system", settings.barb_system_prompt),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{input}"),
    ])

    chain = prompt | llm | StrOutputParser()

    return RunnableWithMessageHistory(
        chain,
        get_session_history,
        input_messages_key="input",
        history_messages_key="history",
    )