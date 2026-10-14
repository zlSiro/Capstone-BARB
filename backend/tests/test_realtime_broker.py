"""Tests unitarios del broker SSE de OTs (HU-10, CGBIDA-348). No usan la BD."""
from __future__ import annotations

import time

import pytest

from barb.services import realtime
from barb.services.realtime import (
    BUFFER_SIZE,
    EVENT_OT_STATUS_CHANGED,
    EVENT_RESYNC,
    QUEUE_SIZE,
    OtEventBroker,
    consume_ticket,
    issue_ticket,
)


def _publish(broker: OtEventBroker, empresa_id: int | None, numero: str = "OT-1"):
    return broker.publish(EVENT_OT_STATUS_CHANGED, {"numero_ot": numero}, empresa_id)


def test_publish_llega_solo_a_la_empresa_suscrita():
    broker = OtEventBroker()
    with broker.subscribe(1) as a, broker.subscribe(2) as b:
        _publish(broker, 1)
        assert a.queue.qsize() == 1
        assert b.queue.qsize() == 0


def test_super_usuario_sin_scope_recibe_todas_las_empresas():
    broker = OtEventBroker()
    with broker.subscribe(None) as sub:
        _publish(broker, 1)
        _publish(broker, 2)
        assert sub.queue.qsize() == 2


def test_evento_incluye_id_empresa_y_timestamp():
    broker = OtEventBroker()
    event = _publish(broker, 7)
    assert event.id == f"{broker._boot}-1"
    assert event.data["empresa_id"] == 7
    assert event.data["numero_ot"] == "OT-1"
    assert "timestamp" in event.data


def test_desuscribe_al_salir_del_contexto():
    broker = OtEventBroker()
    with broker.subscribe(1):
        assert broker.connections == 1
    assert broker.connections == 0


def test_desuscribe_aunque_falle_dentro_del_contexto():
    broker = OtEventBroker()
    with pytest.raises(RuntimeError), broker.subscribe(1):
        raise RuntimeError("cliente cayó")
    assert broker.connections == 0


def test_replay_entrega_solo_los_eventos_perdidos_de_su_empresa():
    broker = OtEventBroker()
    first = _publish(broker, 1, "OT-1")
    _publish(broker, 2, "OT-2")  # otra empresa: no se debe reenviar
    _publish(broker, 1, "OT-3")

    with broker.subscribe(1, first.id) as sub:
        assert [e.data["numero_ot"] for e in sub.initial] == ["OT-3"]


def test_replay_sin_novedades_no_envia_nada():
    broker = OtEventBroker()
    last = _publish(broker, 1)
    with broker.subscribe(1, last.id) as sub:
        assert sub.initial == []


def test_sin_last_event_id_no_hay_replay():
    broker = OtEventBroker()
    _publish(broker, 1)
    with broker.subscribe(1) as sub:
        assert sub.initial == []


@pytest.mark.parametrize("last_id", ["basura", "123-abc", "0-1", "x-y", "-"])
def test_last_event_id_de_otro_arranque_o_invalido_pide_resync(last_id):
    broker = OtEventBroker()
    _publish(broker, 1)
    with broker.subscribe(1, last_id) as sub:
        assert [e.type for e in sub.initial] == [EVENT_RESYNC]


def test_last_event_id_del_futuro_pide_resync():
    broker = OtEventBroker()
    with broker.subscribe(1, f"{broker._boot}-99") as sub:
        assert [e.type for e in sub.initial] == [EVENT_RESYNC]


def test_gap_fuera_del_buffer_pide_resync():
    broker = OtEventBroker()
    first = _publish(broker, 1)
    for _ in range(BUFFER_SIZE + 5):
        _publish(broker, 1)
    with broker.subscribe(1, first.id) as sub:
        assert [e.type for e in sub.initial] == [EVENT_RESYNC]


def test_cola_llena_descarta_pendientes_y_pide_resync():
    broker = OtEventBroker()
    with broker.subscribe(1) as slow:
        for _ in range(QUEUE_SIZE + 1):
            _publish(broker, 1)
        assert slow.queue.qsize() == 1
        assert slow.queue.get_nowait().type == EVENT_RESYNC


def test_cliente_lento_no_afecta_a_los_demas():
    broker = OtEventBroker()
    with broker.subscribe(1) as slow, broker.subscribe(1) as fast:
        for _ in range(QUEUE_SIZE + 1):
            _publish(broker, 1)
            fast.queue.get_nowait()
        assert slow.queue.get_nowait().type == EVENT_RESYNC
        assert fast.queue.qsize() == 0


# --- tickets -----------------------------------------------------------------

def test_ticket_es_de_un_solo_uso():
    sesion = {"usuario_id": 1, "rol": "admin", "empresa_id": 1}
    ticket = issue_ticket(sesion)
    assert consume_ticket(ticket) == sesion
    assert consume_ticket(ticket) is None


def test_ticket_desconocido_se_rechaza():
    assert consume_ticket("no-existe") is None


def test_ticket_expirado_se_rechaza(monkeypatch):
    ticket = issue_ticket({"usuario_id": 1, "rol": "admin", "empresa_id": 1})
    real = time.monotonic()
    monkeypatch.setattr(realtime.time, "monotonic", lambda: real + realtime.TICKET_TTL_SECONDS + 1)
    assert consume_ticket(ticket) is None
