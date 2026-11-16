"""El candado del aviso de falla (HU-20 / CGBIDA-512).

La skill conversacional reporta fallas con la MISMA mecánica probada de OTs, plantas y
parámetros: la tool `proponer_aviso_falla` solo redacta la propuesta parseable y no escribe
nada; el write vive en `registrar_aviso_aprobada` (no-tool) y lo ejecuta el gate del grafo
después de validar el «sí», revalidando permiso, severidad y el código de máquina.

Un aviso NO es una OT: queda `pendiente` en la bandeja del supervisor. Lo que se prueba
acá es lo que podría salir caro: escribir sin confirmación, escribir con un rol que no
puede (matriz de Samuel en `permissions.py`), datos que no cierran (severidad, código de
máquina desaparecido desde la propuesta) y el formato exacto de la propuesta.

Los tests de integración contra la base son explícitos: lo que se crea se limpia.
"""

from __future__ import annotations

import uuid

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from barb.core.db import execute, fetch_one
from barb.services import chat_graph
from barb.services.ai_tools import (
    _PREFIJO_PROPUESTA_AVISO,
    _normalizar_severidad,
    _parsear_propuesta_aviso,
    _texto_propuesta_aviso,
    crear_tools,
    registrar_aviso_aprobada,
)
from barb.services.chat_graph import crear_grafo

GERENTE_ID = 2  # gerente de la empresa 1 (reportar_falla: True en la matriz)
MAQUINA_BASE = {"nombre": "Bomba de pulpa KSB", "codigo": "BOM-001", "planta": None}


def _herramientas_avisos(rol: str = "gerente", habla_del_usuario: list[str] | None = None):
    return {
        t.name: t
        for t in crear_tools(
            empresa_id=1,
            usuario_id=GERENTE_ID,
            rol=rol,
            habla_del_usuario=habla_del_usuario,
        )
    }


def _texto_aviso_para_pump(descripcion: str) -> str:
    return _texto_propuesta_aviso(
        {**MAQUINA_BASE, "planta": "Planta de Vapor"},
        descripcion,
        "medium",
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


# =============================================================================
# La tool: propone, pero NO escribe
# =============================================================================


@pytest.mark.asyncio
async def test_la_tool_propone_sin_registrar(db_pool):
    """El turno de la tool termina con la propuesta EXACTA y ni un INSERT."""
    descripcion = f"Vibración anormal en el cojinete, desde la mañana ({uuid.uuid4().hex[:6]})"

    salida = await _herramientas_avisos()["proponer_aviso_falla"].ainvoke(
<<<<<<< HEAD
        {"nombre_maquina": "BOM-001", "descripcion": descripcion, "severidad": "alta"}
    )

    assert salida.startswith(_PREFIJO_PROPUESTA_AVISO), "la propuesta termina el turno con el texto EXACTO"
    assert "- **codigo:** BOM-001" in salida
=======
        {"nombre_maquina": "Bomba de pulpa KSB", "descripcion": descripcion, "severidad": "alta"}
    )

    assert salida.startswith(_PREFIJO_PROPUESTA_AVISO), "la propuesta termina el turno con el texto EXACTO"
    assert "codigo=BOM-001" in salida
>>>>>>> main
    fila = await fetch_one(
        "SELECT aviso_falla_id FROM aviso_falla WHERE descripcion = %(d)s",
        {"d": descripcion},
    )
    assert fila is None, "la tool NO registra: el write es del gate tras el «sí»"


@pytest.mark.asyncio
async def test_la_tool_pide_descripcion_util(db_pool):
    """«falla» sola no le sirve al supervisor: la tool exige descripción concreta."""
    salida = await _herramientas_avisos()["proponer_aviso_falla"].ainvoke(
        {"nombre_maquina": "Bomba de pulpa KSB", "descripcion": "falla", "severidad": "media"}
    )
    assert "descripción" in salida
    assert not salida.startswith(_PREFIJO_PROPUESTA_AVISO)


@pytest.mark.asyncio
async def test_la_tool_exige_15_caracteres(db_pool):
    """«se paró solo» (12) ya no alcanza: el supervisor necesita contexto."""
    herramientas = _herramientas_avisos()

    corta = await herramientas["proponer_aviso_falla"].ainvoke(
        {"nombre_maquina": "BOM-001", "descripcion": "se paró solo", "severidad": "media"}
    )
    assert "15" in corta
    assert not corta.startswith(_PREFIJO_PROPUESTA_AVISO)

    suficiente = await herramientas["proponer_aviso_falla"].ainvoke(
        {"nombre_maquina": "BOM-001", "descripcion": "se paró y no arranca", "severidad": "media"}
    )
    assert suficiente.startswith(_PREFIJO_PROPUESTA_AVISO)


@pytest.mark.asyncio
async def test_la_tool_no_deja_inventar_detalle_para_llegar_al_minimo(db_pool):
    """QA: con «no arranca» el modelo inventó «desde hace poco tiempo, no responde al
    arranque» para pasar el mínimo. La descripción debe salir de las palabras del usuario."""
    herramientas = _herramientas_avisos(
        habla_del_usuario=["Anota una falla del compresor A1: no arranca."]
    )
    salida = await herramientas["proponer_aviso_falla"].ainvoke(
        {
            "nombre_maquina": "Pump E4",
            "descripcion": "no arranca desde hace poco tiempo, no responde al arranque",
            "severidad": "media",
        }
    )
    assert "no es literal" in salida
    assert not salida.startswith(_PREFIJO_PROPUESTA_AVISO)


@pytest.mark.asyncio
async def test_la_tool_acepta_una_descripcion_armada_entre_varios_mensajes(db_pool):
    """La persona puede dar el detalle en dos turnos: «no arranca» y luego «desde ayer»."""
    herramientas = _herramientas_avisos(
        habla_del_usuario=[
            "Anota una falla del compresor A1: no arranca.",
            "Desde ayer, cuando parte el turno.",
        ]
    )
    salida = await herramientas["proponer_aviso_falla"].ainvoke(
        {
            "nombre_maquina": "BOM-001",
            "descripcion": "no arranca desde ayer",
            "severidad": "media",
        }
    )
    assert salida.startswith(_PREFIJO_PROPUESTA_AVISO)


@pytest.mark.asyncio
async def test_la_tool_rechaza_severidad_invalida(db_pool):
    salida = await _herramientas_avisos()["proponer_aviso_falla"].ainvoke(
        {"nombre_maquina": "Bomba de pulpa KSB", "descripcion": "Fuga de aceite importante", "severidad": "catastrófica"}
    )
    assert "severidad" in salida.lower()
    assert not salida.startswith(_PREFIJO_PROPUESTA_AVISO)


@pytest.mark.asyncio
async def test_la_tool_rechaza_la_severidad_dicha_aunque_el_modelo_la_traduzca(db_pool):
    """Chat 7 de la QA: la persona dijo «urgentísima» y el modelo mandó «alta».

    La severidad es un dato del usuario: la tool la valida contra el mensaje real y
    rechaza la propuesta en vez de aceptar una traducción silenciosa.
    """
    herramientas = _herramientas_avisos(
        habla_del_usuario=[
            "Anota una falla del compresor A1: se paró solo y no arranca desde ayer. "
            "Ponle severidad urgentísima."
        ]
    )
    salida = await herramientas["proponer_aviso_falla"].ainvoke(
        {
            "nombre_maquina": "Pump E4",
            "descripcion": "Se paró solo y no arranca desde ayer",
            "severidad": "alta",
        }
    )
    assert "urgentísima" in salida
    assert "baja, media, alta o crítica" in salida
    assert not salida.startswith(_PREFIJO_PROPUESTA_AVISO)

    # También sin la palabra «severidad»: «ponle urgentísima».
    herramientas = _herramientas_avisos(
        habla_del_usuario=[
            "Anota una falla del compresor A1: se paró solo y no arranca desde ayer. "
            "Ponle urgentísima al aviso."
        ]
    )
    salida = await herramientas["proponer_aviso_falla"].ainvoke(
        {
            "nombre_maquina": "Pump E4",
            "descripcion": "Se paró solo y no arranca desde ayer",
            "severidad": "alta",
        }
    )
    assert "urgentísima" in salida
    assert not salida.startswith(_PREFIJO_PROPUESTA_AVISO)


@pytest.mark.asyncio
async def test_una_severidad_vieja_no_contamina_la_correccion(db_pool):
    """Solo manda el mensaje actual: si antes dijo «urgentísima» y ahora «media», vale media."""
    herramientas = _herramientas_avisos(
        habla_del_usuario=[
            "Anota una falla del compresor A1: se paró solo y no arranca desde ayer. "
            "Ponle severidad urgentísima.",
            "Mejor ponle severidad media y anótala.",
        ]
    )
    salida = await herramientas["proponer_aviso_falla"].ainvoke(
        {
            "nombre_maquina": "BOM-001",
            "descripcion": "Se paró solo y no arranca desde ayer",
            "severidad": "media",
        }
    )
    assert salida.startswith(_PREFIJO_PROPUESTA_AVISO)
    assert "- **severidad:** media" in salida


@pytest.mark.asyncio
async def test_la_tool_avisa_si_los_permisos_no_alcanzan(db_pool):
    """El admin no reporta fallas según la matriz (reportar_falla: False): mensaje
    unificado de permisos (CGBIDA-513), no el texto de otra acción."""
    herramientas = _herramientas_avisos(rol="admin")
    salida = await herramientas["proponer_aviso_falla"].ainvoke(
        {"nombre_maquina": "Bomba de pulpa KSB", "descripcion": "Fuga de aceite importante", "severidad": "media"}
    )
    assert "No te está permitido" in salida
    assert "avisos de falla" in salida
    assert not salida.startswith(_PREFIJO_PROPUESTA_AVISO)


@pytest.mark.asyncio
async def test_la_tool_no_adivina_maquinas(db_pool):
    salida = await _herramientas_avisos()["proponer_aviso_falla"].ainvoke(
        {"nombre_maquina": "Brujula-XYZ-99", "descripcion": "Fuga de aceite importante", "severidad": "media"}
    )
    assert "No encontré ninguna máquina" in salida
    assert not salida.startswith(_PREFIJO_PROPUESTA_AVISO)


# =============================================================================
# Formato de la propuesta: lo que el gate re-parsea
# =============================================================================


def test_parsear_propuesta_aviso_cierra_redonda():
    datos = _parsear_propuesta_aviso(_texto_aviso_para_pump("El motor se recalienta con carga plena"))
    assert datos is not None
    assert datos["tipo"] == "aviso"
    assert datos["codigo"] == "BOM-001"
    assert datos["severidad"] == "medium"
    assert datos["descripcion"] == "El motor se recalienta con carga plena"


def test_el_parser_sigue_leyendo_propuestas_con_el_minimo_anterior():
    """Una propuesta ya persistida con 10-14 caracteres debe seguir resolviéndose.

    El piso de 15 es de la generación; el parser mantiene 5 para que un «sí» sobre una
    propuesta vieja no se pierda.
    """
    datos = _parsear_propuesta_aviso(_texto_aviso_para_pump("se paró solo"))
    assert datos is not None
    assert datos["descripcion"] == "se paró solo"


def test_parsear_propuesta_aviso_rechaza_severidad_que_no_cierra():
    texto = _texto_aviso_para_pump("El motor se recalienta con carga plena").replace(
        "**severidad:** media", "**severidad:** tormenta"
    )
    assert _parsear_propuesta_aviso(texto) is None


def test_parsear_propuesta_aviso_sigue_aceptando_el_formato_anterior():
    """Las propuestas ya persistidas usan la línea con pipes: el gate debe seguir leyéndolas."""
    anterior = (
        "PROPUESTA DE AVISO DE FALLA\n\n"
        "Voy a registrar un aviso de falla de «Pump E4» [PUMP-E4]:\n\n"
        "- AVISO codigo=PUMP-E4 | severidad=alta | descripcion=El motor se recalienta con carga plena\n"
    )
    datos = _parsear_propuesta_aviso(anterior)
    assert datos is not None
    assert datos["codigo"] == "PUMP-E4"
    assert datos["severidad"] == "high"
    assert datos["descripcion"] == "El motor se recalienta con carga plena"


def test_parsear_propuesta_aviso_rechaza_descripcion_corta():
    """La descripción es la nota que leerá el supervisor: menos de 5 caracteres no cierra."""
    texto = _texto_propuesta_aviso({**MAQUINA_BASE, "planta": "Planta Central"}, "peco", "medium")
    assert _parsear_propuesta_aviso(texto) is None


def test_normalizar_severidad_acepta_espanol_e_ingles():
    for entrada, esperado in (
        ("crítica", "critical"),
        ("CRITICAL", "critical"),
        ("Media", "medium"),
        ("high", "high"),
        ("baja", "low"),
        ("tormenta", "medium"),
    ):
        valor, reconocida = _normalizar_severidad(entrada)
        assert valor == esperado
        assert reconocida is (entrada.lower() != "tormenta")


# =============================================================================
# El candado en el grafo
# =============================================================================


@pytest.mark.asyncio
async def test_el_grafo_no_registra_aviso_sin_confirmacion(db_pool):
    """Turno ambiguo tras la propuesta: ni un INSERT. La propuesta se re-emite idéntica."""
    descripcion = f"El freno no responde en descendente ({uuid.uuid4().hex[:6]})"
    modelo = _LLMFalso()
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=GERENTE_ID, rol="gerente")

    estado = await grafo.ainvoke(
        _entrada([AIMessage(content=_texto_aviso_para_pump(descripcion)), HumanMessage(content="mmm, déjame pensarlo")])
    )

    final = estado["messages"][-1]
    assert final.content == _texto_aviso_para_pump(descripcion), "la propuesta se re-emite byte a byte"
    fila = await fetch_one(
        "SELECT aviso_falla_id FROM aviso_falla WHERE descripcion = %(d)s",
        {"d": descripcion},
    )
    assert fila is None, "sin el «sí» del usuario no se registra nada"


@pytest.mark.asyncio
async def test_el_grafo_registra_aviso_con_confirmacion(db_pool):
    """Con el «sí», el gate ejecuta `registrar_aviso_aprobada`: el aviso queda `pendiente`
    con numero AV-…, atado a la máquina re-resuelta por código."""
    marca = uuid.uuid4().hex[:6]
    descripcion = f"Atascada la banda transportadora, paralizando línea {marca}"
    modelo = _LLMFalso()
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=GERENTE_ID, rol="gerente")

    try:
        estado = await grafo.ainvoke(
            _entrada([AIMessage(content=_texto_propuesta_aviso(
                {"nombre": "Bomba de pulpa KSB", "codigo": "BOM-001", "planta": None},
                descripcion,
                "medium",
            )), HumanMessage(content="sí, dale")])
        )

        final = estado["messages"][-1]
        assert "Aviso AV-" in final.content
        assert "Queda pendiente" in final.content
        fila = await fetch_one("SELECT * FROM aviso_falla WHERE descripcion = %(d)s", {"d": descripcion})
        assert fila is not None
        assert fila["estado"] == "pendiente"
        assert fila["severidad"] == "medium"
        assert str(fila["numero_aviso"]).startswith("AV-")
        assert fila["reportado_por"] == GERENTE_ID
    finally:
        await execute("DELETE FROM aviso_falla WHERE descripcion LIKE %(d)s", {"d": f"%{marca}%"})


@pytest.mark.asyncio
async def test_el_grafo_descarta_aviso_con_rechazo(db_pool):
    """«No» después de la propuesta: no se escribe nada y se avisa que se descartó."""
    descripcion = f"Panel eléctrico hace chispas ({uuid.uuid4().hex[:6]})"
    modelo = _LLMFalso()
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=GERENTE_ID, rol="gerente")

    estado = await grafo.ainvoke(_entrada([AIMessage(content=_texto_aviso_para_pump(descripcion)), HumanMessage(content="no")]))

    final = estado["messages"][-1]
    assert "descarté" in final.content
    fila = await fetch_one(
        "SELECT aviso_falla_id FROM aviso_falla WHERE descripcion = %(d)s",
        {"d": descripcion},
    )
    assert fila is None


@pytest.mark.asyncio
async def test_el_grafo_no_registra_aviso_sin_permiso(db_pool):
    """El admin no reporta fallas: el gate revalida el permiso (la propuesta pudo haber
    sido aceptada por medio de otra sesión o el rol pudo cambiar)."""
    descripcion = f"Intento desde un rol sin permiso ({uuid.uuid4().hex[:6]})"
    modelo = _LLMFalso()
    grafo = crear_grafo(empresa_id=1, llm=modelo, usuario_id=GERENTE_ID, rol="admin")

    estado = await grafo.ainvoke(_entrada([AIMessage(content=_texto_aviso_para_pump(descripcion)), HumanMessage(content="sí")]))

    final = estado["messages"][-1]
    assert "No te está permitido" in final.content
    fila = await fetch_one(
        "SELECT aviso_falla_id FROM aviso_falla WHERE descripcion = %(d)s",
        {"d": descripcion},
    )
    assert fila is None, "el write requiere el permiso de la matriz, siempre"


@pytest.mark.asyncio
async def test_registrar_aviso_aprobada_exige_codigo_exacto(db_pool):
    """Re-resolución por CÓDIGO EXACTO: si la máquina ya no existe (o cambió de planta
    desde la propuesta), el write no adivina y no escribe."""
    marca = uuid.uuid4().hex[:6]
    descripcion = f"Prueba de código inexistente {marca}"

    salida = await registrar_aviso_aprobada(
        f"ZZ-{marca}", descripcion, "alta", empresa_id=1, usuario_id=GERENTE_ID, rol="gerente"
    )

    assert f"«ZZ-{marca}»" in salida
    assert "No registré nada" in salida
    fila = await fetch_one(
        "SELECT aviso_falla_id FROM aviso_falla WHERE descripcion = %(d)s",
        {"d": descripcion},
    )
    assert fila is None


# =============================================================================
# Modelo falso: copia del patrón de test_skills_topologia (el gate corta antes)
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
