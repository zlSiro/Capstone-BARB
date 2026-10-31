"""Ventana de memoria de la conversación (`CHAT_MEMORY_WINDOW`).

La variable existía en la configuración desde HU-03 pero no se aplicaba en ningún sitio:
se mandaba la conversación completa al modelo en cada turno, así que el coste de tokens
crecía sin techo. Ahora `load_messages(..., limite=N)` recorta el historial que viaja al
modelo, y el detalle de sesión sigue pidiendo la conversación completa para mostrarla.
"""

from __future__ import annotations

from barb.services.chat_repository import ventana_de_memoria


def _msg(rol: str, n: int) -> dict:
    return {"role": rol, "content": f"mensaje {n}", "timestamp": n}


def _conversacion(turnos: int) -> list[dict]:
    """turnos pares (user, assistant), en orden cronológico."""
    mensajes: list[dict] = []
    for t in range(turnos):
        mensajes.append(_msg("user", 2 * t))
        mensajes.append(_msg("assistant", 2 * t + 1))
    return mensajes


def test_sin_limite_devuelve_todo():
    """El detalle de sesión necesita la conversación completa."""
    mensajes = _conversacion(20)
    assert ventana_de_memoria(mensajes, None) == mensajes
    assert ventana_de_memoria(mensajes, 0) == mensajes


def test_recorta_a_los_ultimos_n_mensajes():
    mensajes = _conversacion(20)  # 40 mensajes
    recorte = ventana_de_memoria(mensajes, 10)

    assert len(recorte) <= 10
    assert recorte == mensajes[-len(recorte) :]
    # Conserva el turno más reciente, que es el que da continuidad.
    assert recorte[-1] == mensajes[-1]


def test_el_recorte_empieza_en_un_mensaje_del_usuario():
    """
    Un historial que arranca con una respuesta del asistente confunde al modelo: no hay
    pregunta a la que corresponda. Con ventana impar el corte caía justo ahí.
    """
    mensajes = _conversacion(20)
    for limite in (5, 7, 9):
        recorte = ventana_de_memoria(mensajes, limite)
        assert recorte, f"la ventana {limite} no puede quedar vacía"
        assert recorte[0]["role"] == "user", f"con limite={limite} arranca en {recorte[0]['role']}"


def test_si_la_conversacion_es_mas_corta_que_la_ventana_no_toca_nada():
    mensajes = _conversacion(2)  # 4 mensajes
    assert ventana_de_memoria(mensajes, 10) == mensajes


def test_tolera_listas_vacias_y_roles_inesperados():
    assert ventana_de_memoria([], 5) == []
    raros = [{"content": "sin rol"}, _msg("assistant", 1), _msg("user", 2), _msg("assistant", 3)]
    recorte = ventana_de_memoria(raros, 3)
    assert recorte[0]["role"] == "user"
