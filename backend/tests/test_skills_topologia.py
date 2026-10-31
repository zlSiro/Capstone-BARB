"""Las 3 Skills de topología (HU-26): listar, actualizar parámetros y crear planta.

Lo que se prueba acá es lo que podría salir caro: que ninguna tool exponga identificadores
al modelo (§2 de la spec), que otra empresa no vea ni modifique nada, que la escritura
requiera el permiso del mantenedor (gerente/admin) y que sin confirmación del usuario no
se escriba nada (el candado de planta, mismo patrón que el de OTs en test_candado_ot.py).

Los tests de integración contra la base son explícitos: lo que se crea se limpia (planta
→ máquinas → sesiones, porque `fk_maquina_planta` no tiene CASCADE).
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from langchain_core.messages import AIMessage, HumanMessage

from barb.core.db import execute, fetch_one
from barb.services import chat_graph
from barb.services.ai_tools import (
    _PREFIJO_PROPUESTA_PLANTA,
    PERMISO_DENEGADO,
    _texto_propuesta_planta,
    crear_planta_aprobada,
    crear_tools,
)
from barb.services.chat_graph import crear_grafo

GERENTE_ID = 2  # gerente de la empresa 1
OTRA_EMPRESA_ID = 17  # gerente de la empresa 2 (tiene permiso sobre `plantas`)

# Nada de estos identificadores puede aparecer en el schema que ve el modelo (spec §2).
SENSIBLES = {"empresa_id", "usuario_id", "rol", "maquina_id", "planta_id"}

HERRAMIENTAS = {t.name: t for t in crear_tools(empresa_id=1, usuario_id=GERENTE_ID, rol="gerente")}


@pytest_asyncio.fixture
async def ctx(db_pool):
    """Tokens de sesión (gerente local + gerente ajeno) y limpieza por marca."""
    marca = uuid.uuid4().hex[:8]
    tokens: dict[str, dict[str, str]] = {}
    for nombre, uid in (("gerente", GERENTE_ID), ("ajeno", OTRA_EMPRESA_ID)):
        token = f"test-skill-{nombre}-{marca}"
        await execute(
            "INSERT INTO sesion (token, usuario_id, expira_en) VALUES (%(t)s, %(u)s, NOW() + INTERVAL '10 minutes')",
            {"t": token, "u": uid},
        )
        tokens[nombre] = {"Authorization": f"Bearer {token}"}

    yield {"tokens": tokens, "marca": marca}

    await execute(
        "DELETE FROM maquina WHERE planta_id IN (SELECT planta_id FROM planta WHERE nombre LIKE %(p)s)",
        {"p": f"%{marca}%"},
    )
    await execute("DELETE FROM planta WHERE nombre LIKE %(p)s", {"p": f"%{marca}%"})
    await execute("DELETE FROM sesion WHERE token LIKE %(p)s", {"p": f"test-skill-%-{marca}"})


async def _planta_con_dos_maquinas(client, ctx) -> int:
    """Una planta con 2 máquinas: la primera con SLA y costo, la segunda sin (NULL)."""
    r = await client.post(
        "/api/plantas/completa",
        headers=ctx["tokens"]["gerente"],
        json={
            "nombre": f"Planta Skill {ctx['marca']}",
            "maquinas": [
                {
                    "nombre": f"Compresor {ctx['marca']}",
                    "codigo": "COMP",
                    "disciplina": "Mecánica",
                    "sla_horas": 6,
                    "costo_inactividad_minuto": 50,
                },
                {"nombre": "Prensa", "codigo": "PRE", "disciplina": "Eléctrica"},
            ],
        },
    )
    assert r.status_code == 201, r.text
    cuerpo = r.json()
    return cuerpo["planta_id"], cuerpo["maquinas"][0]["maquina_id"]


# =============================================================================
# Seguridad: el modelo nunca ve identificadores
# =============================================================================


@pytest.mark.parametrize(
    "nombre_tool",
    ["listar_maquinas_planta", "actualizar_parametros_maquina", "proponer_planta_completa"],
)
def test_las_tools_no_exponen_identificadores(nombre_tool):
    """El modelo no debe poder escribir ni la empresa ni el usuario ni un id suelto."""
    esquema = HERRAMIENTAS[nombre_tool].args_schema.model_json_schema()
    expuestos = set(esquema.get("properties", {})) & SENSIBLES
    assert not expuestos, f"{nombre_tool} expone {expuestos} al modelo"


# =============================================================================
# Skill 1: listar_maquinas_planta
# =============================================================================


@pytest.mark.asyncio
async def test_listar_maquinas_planta_no_cruza_empresas(client, ctx):
    """Con empresa 2, pedir la planta de la empresa 1 devuelve «no encontré» y no lista
    sus máquinas: el filtro de empresa va en el WHERE."""
    await _planta_con_dos_maquinas(client, ctx)

    ajenas = {t.name: t for t in crear_tools(empresa_id=2, usuario_id=OTRA_EMPRESA_ID, rol="gerente")}
    salida = await ajenas["listar_maquinas_planta"].ainvoke({"planta": f"Planta Skill {ctx['marca']}"})

    assert "No encontré" in salida
    assert "Compressor" not in salida


@pytest.mark.asyncio
async def test_listar_maquinas_planta_muestra_sla_y_costo(client, ctx):
    """La lectura muestra SLA y costo; con NULL dice «el general» (no inventa valores)."""
    await _planta_con_dos_maquinas(client, ctx)

    salida = await HERRAMIENTAS["listar_maquinas_planta"].ainvoke({"planta": f"Planta Skill {ctx['marca']}"})

    assert f"Compresor {ctx['marca']}" in salida and "PRE" in salida
    assert "6 h" in salida and "50/min" in salida, "los valores cargados se muestran"
    assert salida.count("el general") == 2, "SLA y costo de la máquina sin valores: dos «el general»"


# =============================================================================
# Skill 2: actualizar_parametros_maquina
# =============================================================================


@pytest.mark.asyncio
async def test_actualizar_parametros_maquina_respeta_empresa(client, ctx):
    """Una gerente de la empresa 2 no puede editar la máquina de la empresa 1 — y el valor
    en la base no cambia."""
    _, maquina_id = await _planta_con_dos_maquinas(client, ctx)
    ajenas = {t.name: t for t in crear_tools(empresa_id=2, usuario_id=OTRA_EMPRESA_ID, rol="gerente")}

    salida = await ajenas["actualizar_parametros_maquina"].ainvoke(
        {"nombre_maquina": f"Compresor {ctx['marca']}", "sla_horas": 1}
    )

    assert "No encontré" in salida
    fila = await fetch_one("SELECT sla_horas FROM maquina WHERE maquina_id = %(m)s", {"m": maquina_id})
    assert float(fila["sla_horas"]) == 6, "el SLA de la empresa 1 quedó intacto"


@pytest.mark.asyncio
async def test_actualizar_parametros_maquina_requiere_permiso(client, ctx):
    """Un técnico no gestiona el mantenedor (misma matriz que el endpoint): la tool lo
    rechaza sin tocar la base."""
    _, maquina_id = await _planta_con_dos_maquinas(client, ctx)
    tecnicas = {t.name: t for t in crear_tools(empresa_id=1, usuario_id=4, rol="tecnico")}

    salida = await tecnicas["actualizar_parametros_maquina"].ainvoke(
        {"nombre_maquina": f"Compresor {ctx['marca']}", "sla_horas": 9}
    )

    assert salida == PERMISO_DENEGADO
    fila = await fetch_one("SELECT sla_horas FROM maquina WHERE maquina_id = %(m)s", {"m": maquina_id})
    assert float(fila["sla_horas"]) == 6


@pytest.mark.asyncio
async def test_actualizar_parametros_maquina_cambia_sla_y_costo(client, ctx):
    """El caso feliz: gerente cambia SLA y costo; el mensaje muestra antes → después y la
    base queda con los valores nuevos."""
    _, maquina_id = await _planta_con_dos_maquinas(client, ctx)

    salida = await HERRAMIENTAS["actualizar_parametros_maquina"].ainvoke(
        {"nombre_maquina": f"Compresor {ctx['marca']}", "sla_horas": 8, "costo_inactividad_minuto": 120}
    )

    assert f"Actualicé «Compresor {ctx['marca']}»" in salida
    assert "6 h → 8 h" in salida, "antes → después del SLA"
    assert "50 /min → 120 /min" in salida, "antes → después del costo"
    fila = await fetch_one(
        "SELECT sla_horas, costo_inactividad_minuto FROM maquina WHERE maquina_id = %(m)s",
        {"m": maquina_id},
    )
    assert float(fila["sla_horas"]) == 8 and float(fila["costo_inactividad_minuto"]) == 120


@pytest.mark.asyncio
async def test_actualizar_parametros_maquina_rechaza_valores_invalidos(db_pool):
    """Rangos fuera de lugar o llamada sin campos: mensaje claro, base sin tocar."""
    for args, esperado in (
        ({"nombre_maquina": "Compressor", "sla_horas": -1}, "entre 0 y 8760"),
        ({"nombre_maquina": "Compressor", "sla_horas": 9000}, "entre 0 y 8760"),
        ({"nombre_maquina": "Compressor"}, "Di qué cambias"),
    ):
        salida = await HERRAMIENTAS["actualizar_parametros_maquina"].ainvoke(args)
        assert esperado in salida, f"{args}: {salida}"


# =============================================================================
# Skill 3: proponer_planta_completa + crear_planta_aprobada (el candado)
# =============================================================================


@pytest.mark.asyncio
async def test_proponer_planta_completa_no_escribe_nada(db_pool):
    """La tool de propuesta valida y redacta, pero NO inserta nada: ni planta ni máquinas."""
    antes = await fetch_one("SELECT COUNT(*) AS n FROM planta")

    salida = await HERRAMIENTAS["proponer_planta_completa"].ainvoke(
        {
            "nombre": "Planta Propuesta",
            "maquinas": [
                {"nombre": "Turbina 1", "codigo": "TUR-1", "disciplina": "Mecánica"},
                {"nombre": "Turbina 2", "codigo": "TUR-2", "disciplina": "Mecánica"},
            ],
        }
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM planta")
    assert antes["n"] == despues["n"], "la propuesta no debe crear filas"
    assert salida.startswith(_PREFIJO_PROPUESTA_PLANTA)


@pytest.mark.asyncio
async def test_crear_planta_aprobada_crea_planta_y_maquinas(db_pool):
    """El INSERT aprobado crea la planta con sus máquinas y los valores pedidos."""
    marca = uuid.uuid4().hex[:8]
    try:
        salida = await crear_planta_aprobada(
            f"Planta Aprobada {marca}",
            [
                {
                    "nombre": "Turbina 1",
                    "codigo": "TUR-1",
                    "disciplina": "Mecánica",
                    "sla_horas": 4,
                    "costo_inactividad_minuto": 30,
                },
                {"nombre": "Turbina 2", "codigo": "TUR-2", "disciplina": "Mecánica"},
            ],
            empresa_id=1,
            usuario_id=GERENTE_ID,
            rol="gerente",
        )

        assert "creada con 2 máquina(s)" in salida
        planta = await fetch_one("SELECT planta_id FROM planta WHERE nombre = %(n)s", {"n": f"Planta Aprobada {marca}"})
        assert planta is not None
        tur1 = await fetch_one("SELECT sla_horas FROM maquina WHERE codigo = %(c)s", {"c": "TUR-1"})
        assert tur1 is not None and float(tur1["sla_horas"]) == 4
    finally:
        await execute(
            "DELETE FROM maquina WHERE planta_id IN (SELECT planta_id FROM planta WHERE nombre LIKE %(p)s)",
            {"p": f"%{marca}%"},
        )
        await execute("DELETE FROM planta WHERE nombre LIKE %(p)s", {"p": f"%{marca}%"})


@pytest.mark.asyncio
async def test_crear_planta_aprobada_revalida_la_propuesta(db_pool):
    """La propuesta viene parseada del texto: se revalida con Pydantic. Una máquina sin
    código es propuesta inválida → no se crea nada."""
    antes = await fetch_one("SELECT COUNT(*) AS n FROM planta")

    salida = await crear_planta_aprobada(
        "Planta Inválida",
        [{"nombre": "Sin código"}],
        empresa_id=1,
        usuario_id=GERENTE_ID,
        rol="gerente",
    )

    despues = await fetch_one("SELECT COUNT(*) AS n FROM planta")
    assert antes["n"] == despues["n"], "una propuesta inválida no crea nada"
    assert "no creé nada" in salida


# =============================================================================
# El candado en el grafo (mismo patrón que test_candado_ot.py)
# =============================================================================


class _LLMFalso:
    """Modelo guionado; para estos tests no debería invocarse (el gate corta antes)."""

    def __init__(self) -> None:
        self.llamadas: list[list] = []
        self.tools_vinculadas: list = []

    def bind_tools(self, tools):
        self.tools_vinculadas = list(tools)
        return self

    def with_retry(self, **_kwargs):
        return self

    async def ainvoke(self, mensajes):
        self.llamadas.append(list(mensajes))
        return AIMessage(content="esto no debería usarse")


def _propuesta_planta() -> str:
    return _texto_propuesta_planta(
        "Planta Candado",
        "Rancagua",
        [
            {"nombre": "Turbina 1", "codigo": "TUR-1", "disciplina": "Mecánica", "sla_horas": 4, "costo_inactividad_minuto": 30},
            {"nombre": "Turbina 2", "codigo": "TUR-2", "disciplina": "Mecánica"},
        ],
    )


def _entrada(mensajes) -> dict:
    return {
        "messages": mensajes,
        "empresa_id": 1,
        "pistas": [],
        "contexto": "",
        "fragmentos": 0,
    }


@pytest.fixture(autouse=True)
def _retrieval_aislado(monkeypatch):
    """El retrieval no corre en estos tests: el gate no depende de documentación."""

    async def vacio(*_a, **_k):
        return []

    monkeypatch.setattr(chat_graph, "search_chunks", vacio)


@pytest.mark.asyncio
async def test_el_grafo_no_crea_planta_sin_confirmacion(db_pool, monkeypatch):
    """Turno ambiguo tras la propuesta: ni un INSERT. La propuesta se re-emite idéntica."""
    modelo = _LLMFalso()
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=GERENTE_ID, rol="gerente")

    estado = await grafo.ainvoke(_entrada([AIMessage(content=_propuesta_planta()), HumanMessage(content="mmm, no sé")]))

    final = estado["messages"][-1]
    assert final.content == _propuesta_planta(), "la propuesta se re-emite byte a byte"
    planta = await fetch_one("SELECT planta_id FROM planta WHERE nombre = 'Planta Candado'")
    assert planta is None, "sin el «sí» del usuario no se crea nada"


@pytest.mark.asyncio
async def test_el_grafo_crea_planta_con_confirmacion(db_pool, monkeypatch):
    """Con el «sí» del usuario, el gate ejecuta `crear_planta_aprobada` y la planta queda
    creada con sus máquinas."""
    modelo = _LLMFalso()
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=GERENTE_ID, rol="gerente")

    try:
        estado = await grafo.ainvoke(_entrada([AIMessage(content=_propuesta_planta()), HumanMessage(content="sí, confirmo")]))

        final = estado["messages"][-1]
        assert "Planta «Planta Candado» creada con 2 máquina(s)" in final.content
        planta = await fetch_one("SELECT planta_id FROM planta WHERE nombre = 'Planta Candado'")
        assert planta is not None
        tur = await fetch_one("SELECT sla_horas FROM maquina WHERE codigo = 'TUR-1'")
        assert tur is not None and float(tur["sla_horas"]) == 4
    finally:
        await execute("DELETE FROM maquina WHERE codigo IN ('TUR-1', 'TUR-2')")
        await execute("DELETE FROM planta WHERE nombre = 'Planta Candado'")
