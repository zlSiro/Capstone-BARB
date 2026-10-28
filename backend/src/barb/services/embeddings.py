"""Embeddings de NVIDIA NIM para el RAG (HU-04 — D1 y D2 de docs/RAG_ARCHITECTURE.md).

Antes de este módulo el proyecto tenía **todo listo menos el paso que genera los
vectores**: la extensión `vector`, la tabla `documento_embedding` con su índice HNSW y
las funciones de persistencia y búsqueda (`set_chunks`, `search_similar_chunks`), pero
nadie llamaba a un modelo de embeddings y la tabla estaba vacía. La búsqueda del chat
usaba `to_tsquery`, es decir, texto: si el usuario escribía «torque» y el manual decía
«par de apriete», no lo encontraba.

Este módulo es solo el puente hacia el modelo. Tres decisiones lo gobiernan, y las tres
están medidas sobre los datos reales, no elegidas de memoria:

1. **La dimensión no es negociable: 2048.**
   `documento_embedding.embedding` es `vector(2048) NOT NULL`, así que un modelo de 1024
   o 1536 dimensiones haría fallar el INSERT. Por eso `EMBEDDING_DIM` es parte del
   contrato: el backfill verifica el tamaño real antes de escribir nada.

2. **`input_type` no es opcional.**
   Los modelos de embeddings de NVIDIA distinguen el vector de una PREGUNTA del de un
   FRAGMENTO. Omitirlo deja el espacio mal condicionado: medido sobre los 17 chunks
   reales, «que hora es» puntuaba 0.74 y «presión de trabajo del compresor» 0.37 —
   separación **−0.37**, o sea ruido. Con `input_type` la separación es **+0.19** y se
   acierta el documento en 4 de 5 consultas.

3. **Se habla HTTP directo, no `OpenAIEmbeddings`.**
   Se intentó primero con el cliente de LangChain, como decía el diseño, pero
   `langchain-openai` 1.6.6 no reenvía `input_type` al endpoint (`AsyncEmbeddings.create()
   got an unexpected keyword argument 'input_type'`). Un POST explícito es más simple que
   pelearse con la abstracción, y deja a la vista el contrato exacto que espera NIM.
"""

from __future__ import annotations

import logging

import httpx

from barb.core.config import settings

logger = logging.getLogger("barb.embeddings")

# Dimensión que exige la columna `documento_embedding.embedding` (migración 0003).
EMBEDDING_DIM = 2048

# Tope de textos por request: el free tier agradece no recibir 17 llamadas seguidas.
LOTE_MAX = 16


class EmbeddingsNoConfigurados(RuntimeError):
    """No hay modelo o key de embeddings: quien llama debe caer al fallback léxico."""


class EmbeddingsDimensionInvalida(RuntimeError):
    """El modelo devolvió una dimensión distinta de la que exige la base."""


class EmbeddingsError(RuntimeError):
    """Fallo del proveedor (red, HTTP, respuesta inesperada)."""


def embeddings_disponibles() -> bool:
    """`True` si hay modelo y key. No prueba la red: eso lo hace la primera llamada."""
    return settings.embeddings_configurados


async def _pedir(textos: list[str], input_type: str) -> list[list[float]]:
    """
    POST al endpoint de embeddings de NIM y devuelve los vectores en el orden pedido.

    El orden se restablece por `index`: la API no garantiza que la respuesta venga en el
    mismo orden que la entrada, y emparejar mal los vectores con sus chunks envenenaría
    el índice en silencio.
    """
    if not embeddings_disponibles():
        raise EmbeddingsNoConfigurados(
            "Faltan EMBEDDINGS_MODEL o NVIDIA_API_KEY: no se pueden generar embeddings."
        )

    payload = {
        "model": settings.embeddings_model,
        "input": textos,
        "input_type": input_type,
        "encoding_format": "float",
    }
    url = f"{settings.nvidia_base_url.rstrip('/')}/embeddings"

    try:
        async with httpx.AsyncClient(timeout=settings.embeddings_timeout) as cliente:
            respuesta = await cliente.post(
                url,
                headers={"Authorization": f"Bearer {settings.embeddings_api_key}"},
                json=payload,
            )
    except httpx.HTTPError as e:
        raise EmbeddingsError(f"No se pudo contactar al proveedor: {e}") from e

    if respuesta.status_code >= 400:
        detalle = respuesta.text[:300].replace("\n", " ")
        raise EmbeddingsError(
            f"El proveedor respondió {respuesta.status_code}: {detalle}"
        )

    try:
        datos = respuesta.json()["data"]
        vectores = [d["embedding"] for d in sorted(datos, key=lambda d: d.get("index", 0))]
    except (KeyError, TypeError, ValueError) as e:
        raise EmbeddingsError(f"Respuesta inesperada del proveedor: {e}") from e

    _verificar_dimension(vectores)
    return vectores


async def embed_texto(texto: str) -> list[float]:
    """Vector de una consulta del usuario (`input_type="query"`)."""
    limpio = (texto or "").strip()
    if not limpio:
        raise ValueError("No se puede embeber un texto vacío.")
    return (await _pedir([limpio], "query"))[0]


async def embed_lote(textos: list[str]) -> list[list[float]]:
    """
    Vectores de fragmentos de documento (`input_type="passage"`), por lotes.

    Es el otro lado del par que hace funcionar la búsqueda: consultas y fragmentos viven
    en el mismo espacio solo si cada uno se embebe con su tipo.
    """
    limpios = [(t or "").strip() for t in textos]
    if not limpios:
        return []
    if any(not t for t in limpios):
        raise ValueError("Hay chunks vacíos: no se pueden embeber.")

    salida: list[list[float]] = []
    for inicio in range(0, len(limpios), LOTE_MAX):
        salida.extend(await _pedir(limpios[inicio : inicio + LOTE_MAX], "passage"))
    return salida


def _verificar_dimension(vectores: list[list[float]]) -> None:
    """
    Falla temprano y con un mensaje útil si el modelo no mide 2048.

    Sin esto, el error aparecería como una violación de tipo de PostgreSQL a mitad de un
    INSERT múltiple, sin decir cuál modelo ni qué dimensión trajo.
    """
    for vector in vectores:
        if len(vector) != EMBEDDING_DIM:
            raise EmbeddingsDimensionInvalida(
                f"El modelo «{settings.embeddings_model}» devolvió {len(vector)} dimensiones "
                f"y la columna exige {EMBEDDING_DIM}. Cambiar de modelo requiere migrar "
                f"documento_embedding.embedding (ver AGENTS.md)."
            )
