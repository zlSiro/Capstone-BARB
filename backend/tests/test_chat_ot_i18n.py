"""Tests para CGBIDA-551: Estados y prioridades de OT en español (i18n) en el chat."""

from __future__ import annotations

import pytest

from barb.core.db import execute
from barb.services.ai_tools import (
    _resumen_maquina,
    crear_ot_aprobada,
)
from barb.services.chat_graph import _prompt_sistema


@pytest.mark.asyncio
async def test_resumen_maquina_muestra_estados_y_prioridades_en_espanol(db_pool):
    """Verifica que el resumen de OTs de una máquina use etiquetas en español y tabla markdown."""
    maquina = {
        "maquina_id": 1,
        "nombre": "Chancador de cono Sandvik H8800",
        "codigo": "CHA-001",
        "planta": "Chancado Primario",
    }
    salida = await _resumen_maquina(empresa_id=1, maquina=maquina)

    assert "Chancador de cono Sandvik H8800" in salida
    assert "Órdenes de trabajo abiertas:" in salida
    # No deben figurar nombres crudos en inglés si hay OTs abiertas
    if "Abiertas más recientes:" in salida:
        assert "| N° OT | Estado | Prioridad | Fecha de creación |" in salida
        for ingles in ("in_progress", "pending", "completed", "urgent", "medium"):
            assert f"({ingles}" not in salida
            assert f"prioridad {ingles}" not in salida


@pytest.mark.asyncio
async def test_crear_ot_aprobada_muestra_estado_y_prioridad_en_espanol(db_pool):
    """Verifica que el mensaje de confirmación de creación muestre Estado y Prioridad en español."""
    salida = await crear_ot_aprobada(
        "Bomba de pulpa KSB",
        "Falla de prueba para verificación de idioma i18n",
        "alta",
        empresa_id=1,
        usuario_id=1,
        rol="supervisor",
    )

    try:
        assert "OT creada: **OT-IA-" in salida
        assert "· Prioridad: Alta" in salida
        assert "- Estado: Pendiente" in salida
        assert "priority" not in salida.lower() or "alta" in salida
        assert "pending" not in salida
    finally:
        # Extraer número de OT y limpiar
        import re

        m = re.search(r"(OT-IA-\d{8}-\d{6}-[0-9A-F]{4})", salida)
        if m:
            await execute("DELETE FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": m.group(1)})


@pytest.mark.asyncio
async def test_crear_ot_aprobada_duplicada_muestra_estado_en_espanol(db_pool):
    """Verifica que el mensaje antiduplicado muestre el estado en español."""
    datos = ("Bomba de pulpa KSB", "Falla duplicada para test i18n", "alta")
    primera = await crear_ot_aprobada(*datos, empresa_id=1, usuario_id=1, rol="supervisor")
    segunda = await crear_ot_aprobada(*datos, empresa_id=1, usuario_id=1, rol="supervisor")

    import re

    m = re.search(r"(OT-IA-\d{8}-\d{6}-[0-9A-F]{4})", primera)
    try:
        assert "ya estaba creada" in segunda
        assert "(Pendiente)" in segunda
        assert "(pending)" not in segunda
    finally:
        if m:
            await execute("DELETE FROM orden_trabajo WHERE numero_ot = %(n)s", {"n": m.group(1)})


def test_prompt_sistema_incluye_regla_16_estados_y_prioridades():
    """El prompt del sistema debe instruir explícitamente usar español para estados y prioridades de OT."""
    prompt = _prompt_sistema(contexto="", maquina=None, puede_crear_ot=True)
    assert "ESTADOS Y PRIORIDADES DE ÓRDENES DE TRABAJO" in prompt
    assert "Pendiente, Asignada, En curso, Por validar, Cerrada, Cancelada, Vencida" in prompt
    assert "Baja, Media, Alta, Urgente" in prompt
    assert "PROHIBIDO utilizar términos en inglés" in prompt
