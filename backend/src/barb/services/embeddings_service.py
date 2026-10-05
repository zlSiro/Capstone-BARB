"""Cliente de embeddings para RAG (HU-04) — parte del pipeline CGBIDA-242.

Usa la API OpenAI-compatible de NVIDIA NIM (POST /v1/embeddings) con el modelo
validado por el equipo: nvidia/nemotron-3-embed-1b (dim 2048, español nativo).
La misma NVIDIA_API_KEY del chat sirve para ambas funciones (verificado
04-10). El diseño completo está en docs/RAG_ARCHITECTURE.md (D1/D5).
"""

from __future__ import annotations

from langchain_openai import OpenAIEmbeddings

from barb.core.config import settings


def get_embeddings_client() -> OpenAIEmbeddings:
    if not settings.nvidia_api_key:
        raise RuntimeError("NVIDIA_API_KEY no configurada en .env (también usada para embeddings)")

    return OpenAIEmbeddings(
        model=settings.embeddings_model,
        api_key=settings.nvidia_api_key,
        base_url=settings.nvidia_base_url,
        request_timeout=settings.embeddings_timeout,
        # El tokenizador por defecto asume modelos OpenAI; para NIM se desactiva.
        check_embedding_ctx_length=False,
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embeddings por LOTE de una lista de textos (la API acepta listas — D5).

    El orden de los vectores returned corresponde al orden de `texts`.
    """
    if not texts:
        return []
    return get_embeddings_client().embed_documents(texts)
