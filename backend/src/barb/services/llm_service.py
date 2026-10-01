from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import Runnable, RunnableLambda

from barb.core.config import settings

# ---------------------------------------------------------------------------
# Construcción del LLM por proveedor
# ---------------------------------------------------------------------------

def _build_llm(provider: str | None = None):
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

    if provider == "nvidia":
        # NVIDIA NIM (build.nvidia.com) expone una API OpenAI-compatible.
        from langchain_openai import ChatOpenAI
        if not settings.nvidia_api_key:
            raise RuntimeError("NVIDIA_API_KEY no configurada en .env")
        return ChatOpenAI(
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
            streaming=True,
            api_key=settings.nvidia_api_key,
            base_url=settings.nvidia_base_url,
        )

    raise ValueError(f"Proveedor LLM no soportado: {provider}")


_RETRY_CONFIG = {
    "stop_after_attempt": 3,
    "wait_exponential_jitter": True,
}


def _build_llm_with_resilience():
    primary = _build_llm().with_retry(**_RETRY_CONFIG)

    fallbacks = []
    for provider in settings.llm_fallback_providers_list:
        if provider == settings.llm_provider:
            continue
        try:
            fallbacks.append(_build_llm(provider).with_retry(**_RETRY_CONFIG))
        except RuntimeError:
            continue

    if fallbacks:
        return primary.with_fallbacks(fallbacks)
    return primary


# ---------------------------------------------------------------------------
# Conversión de historial: dicts (BD) → mensajes de LangChain
# ---------------------------------------------------------------------------

def _dicts_to_messages(history: list[dict]) -> list[BaseMessage]:
    result: list[BaseMessage] = []
    for m in history or []:
        role = (m.get("role") or "").lower()
        content = m.get("content") or ""
        if role == "user":
            result.append(HumanMessage(content=content))
        elif role in ("assistant", "ai"):
            result.append(AIMessage(content=content))
    return result


def _prepare_prompt_input(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "input": payload.get("input", ""),
        "history": _dicts_to_messages(payload.get("history", [])),
    }


# ---------------------------------------------------------------------------
# Chain público (SIN memoria propia, la memoria la maneja el router)
# ---------------------------------------------------------------------------

def create_conversation_chain() -> Runnable:
   
    llm = _build_llm_with_resilience()

    prompt = ChatPromptTemplate.from_messages([
        ("system", settings.barb_system_prompt),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{input}"),
    ])

    chain = RunnableLambda(_prepare_prompt_input) | prompt | llm | StrOutputParser()
    return chain