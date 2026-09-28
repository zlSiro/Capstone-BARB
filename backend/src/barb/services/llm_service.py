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


def _build_llm():
    """
    Construye el LLM según el proveedor configurado en LLM_PROVIDER.
    """
    if settings.llm_provider == "openrouter":
        from langchain_openrouter import ChatOpenRouter

        if not settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY no configurada en .env")

        return ChatOpenRouter(
            model=settings.llm_model,          # "qwen/qwen3-8b:free"
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
            streaming=True,
            api_key=settings.openrouter_api_key,
        )

    if settings.llm_provider == "deepseek":
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

    if settings.llm_provider == "openai":
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

    raise ValueError(f"Proveedor LLM no soportado: {settings.llm_provider}")


def create_conversation_chain(session_id: str) -> RunnableWithMessageHistory:
    """
    Crea una cadena conversacional con memoria persistente por sesión.
    API moderna de LangChain 1.x (RunnableWithMessageHistory + StrOutputParser).
    """
    llm = _build_llm()

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