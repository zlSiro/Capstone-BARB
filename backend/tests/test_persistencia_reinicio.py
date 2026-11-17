"""Continuidad de la conversación tras reiniciar el proceso (HU-22 / CGBIDA-445).

La HU pide que el contexto del chat sobreviva a un reinicio del backend (incluido un
redeploy de Render). No hace falta matar un proceso para probarlo: el estado del chat
no vive en el proceso, así que un «reinicio» es dejar de tener el grafo anterior y
volver a leer el historial desde la base. Eso es exactamente lo que hace este test,
contra la BD real y con un modelo falso (no gasta API).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from langchain_core.messages import AIMessage

from barb.core.config import settings
from barb.core.db import execute
from barb.services import chat_graph, chat_repository


class _LLMGuionado:
    """Modelo falso: guarda los mensajes que recibe y responde un texto fijo."""

    def __init__(self, respuesta: str) -> None:
        self.respuesta = respuesta
        self.llamadas: list[list] = []

    def bind_tools(self, _tools):
        return self

    def with_retry(self, **_kwargs):
        return self

    async def ainvoke(self, mensajes):
        self.llamadas.append(list(mensajes))
        return AIMessage(content=self.respuesta)


@pytest_asyncio.fixture
async def cleanup_sessions(db_pool) -> AsyncIterator[list[str]]:
    creadas: list[str] = []
    yield creadas
    for sid in creadas:
        try:
            await execute(
                "DELETE FROM chat_session WHERE session_id = %(sid)s",
                {"sid": sid},
            )
        except Exception:
            pass


@pytest.fixture(autouse=True)
def _retrieval_aislado(monkeypatch):
    """El test es de persistencia, no de RAG: el retrieval se neutraliza."""

    async def vacio(*_a, **_k):
        return []

    monkeypatch.setattr(chat_graph, "search_chunks", vacio)


async def _sesion_con_turno_previo(cleanup_sessions, usuario_id: int, empresa_id: int) -> str:
    """Crea la sesión y persiste un turno completo, igual que el router."""
    sid = await chat_repository.create_session(
        usuario_id=usuario_id,
        empresa_id=empresa_id,
        primer_mensaje="¿Qué torque lleva la bomba BOM-001?",
    )
    cleanup_sessions.append(sid)

    await chat_repository.append_messages(
        sid,
        usuario_id,
        [
            {
                "role": "user",
                "content": "¿Qué torque lleva la bomba BOM-001?",
                "timestamp": 1,
            },
            {
                "role": "assistant",
                "content": "El manual indica 120 Nm para la bomba BOM-001.",
                "timestamp": 2,
            },
        ],
    )
    return sid


@pytest.mark.asyncio
async def test_el_turno_siguiente_ve_la_conversacion_tras_un_reinicio(
    cleanup_sessions, db_pool
):
    """
    Turno 1 se persiste; el proceso «se reinicia» (grafo nuevo, sin estado previo);
    el turno 2 recupera el historial de la base y el modelo lo recibe completo.
    """
    usuario_id, empresa_id = 1, 1
    sid = await _sesion_con_turno_previo(cleanup_sessions, usuario_id, empresa_id)

    # --- reinicio: se vuelve a leer la conversación desde la base ---
    historial = await chat_repository.load_messages(
        sid, usuario_id, limite=settings.chat_memory_window
    )
    assert [m["role"] for m in historial] == ["user", "assistant"]

    llm = _LLMGuionado("Según el manual, la presión de trabajo es 6 bar.")
    chunks = [
        trozo
        async for trozo in chat_graph.astream_respuesta(
            empresa_id=empresa_id,
            mensaje="¿Y la presión de trabajo?",
            historial=historial,
            pistas=["¿Y la presión de trabajo?"],
            llm=llm,
            usuario_id=usuario_id,
            rol="tecnico",
        )
    ]

    # El grafo se construyó de cero en este turno y aun así el prompt lleva el turno previo.
    mensajes = llm.llamadas[0]
    textos = [str(m.content) for m in mensajes]
    assert "¿Qué torque lleva la bomba BOM-001?" in textos
    assert "El manual indica 120 Nm para la bomba BOM-001." in textos
    assert "¿Y la presión de trabajo?" in textos
    # Orden cronológico: la pregunta anterior va antes que la nueva.
    assert textos.index("El manual indica 120 Nm para la bomba BOM-001.") < textos.index(
        "¿Y la presión de trabajo?"
    )

    assert "".join(chunks) == "Según el manual, la presión de trabajo es 6 bar."
    # El turno nuevo no se escribió en la base: eso lo hace el router, no el grafo.
    assert len(await chat_repository.load_messages(sid, usuario_id)) == 2


@pytest.mark.asyncio
async def test_dos_procesos_leen_la_misma_conversacion(cleanup_sessions, db_pool):
    """
    Simula dos workers: cada uno abre el historial por su cuenta y ve lo mismo.

    Es la propiedad que hace al chat compatible con varios procesos: el estado no se
    comparte en RAM, se reconstruye desde `chat_session`.
    """
    usuario_id, empresa_id = 1, 1
    sid = await _sesion_con_turno_previo(cleanup_sessions, usuario_id, empresa_id)

    worker_a = await chat_repository.load_messages(sid, usuario_id, limite=10)
    worker_b = await chat_repository.load_messages(sid, usuario_id, limite=10)

    assert worker_a == worker_b
    assert [m["content"] for m in worker_a][0] == "¿Qué torque lleva la bomba BOM-001?"


def test_el_grafo_no_guarda_estado_en_el_proceso(monkeypatch):
    """Sin checkpointer no hay memoria de turno en RAM: todo lo que falta está en la base."""
    monkeypatch.setattr(chat_graph, "crear_tools", lambda *_a, **_k: [])
    llm = _LLMGuionado("ok")

    grafo = chat_graph.crear_grafo(empresa_id=1, llm=llm)

    assert getattr(grafo, "checkpointer", None) is None
