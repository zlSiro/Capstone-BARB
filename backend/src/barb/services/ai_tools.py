"""Skills (tools) que la IA puede ejecutar contra datos reales de BARB.

Una tool es lo que separa «el chat escribe bonito» de «el chat consulta la base». El
modelo decide cuándo llamarla; el resultado vuelve al prompt como un `ToolMessage` y la
respuesta final se apoya en datos, no en su memoria.

Decisiones que importan:

1. **La empresa se fija al construir la tool, no al llamarla.** El esquema que ve el
   modelo solo expone `nombre_maquina` (que es lo natural para él), pero el `empresa_id`
   viaja cerrado en la clausura. Si lo recibiéramos como parámetro, el modelo podría
   inventar un id y consultar datos de otra empresa: el aislamiento multi-empresa no puede
   depender de lo que el LLM escriba.
2. **Nunca lanza:** devuelve texto. Una excepción dentro de un nodo de herramientas corta
   el grafo y el usuario ve un error; un mensaje claro deja que el modelo explique.
"""

from __future__ import annotations

import difflib
import logging
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from langchain_core.tools import BaseTool, tool

from barb.core.config import settings
from barb.core.db import fetch_all, fetch_one
from barb.core.work_order_states import ESTADOS_FINALES, TRANSICIONES

logger = logging.getLogger("barb.ai_tools")

# Estados en los que una OT sigue viva. Se DERIVAN de la máquina de estados, que se declara
# «única fuente de verdad» (`core/work_order_states.py`): todo estado con transiciones
# salientes está abierto. Antes había una tupla escrita a mano que duplicaba ese
# conocimiento y se habría quedado desactualizada al agregar o retirar un estado.
ESTADOS_ABIERTOS: tuple[str, ...] = tuple(
    sorted(estado for estado in TRANSICIONES if estado not in ESTADOS_FINALES)
)

_MAX_MAQUINAS = 5
_MAX_OTS_LISTADAS = 10
# Umbral de parecido para aceptar una coincidencia. Coincide con el `cutoff` estándar de
# `difflib.get_close_matches`, que es el criterio de Python para "se parece lo suficiente".
_UMBRAL_PARECIDO = 0.6
# Parecido mínimo entre dos palabras para tratarlas como la misma dentro de un nombre
# compuesto: tolera «compresor» vs «compressor» sin exigir igualdad exacta.
_UMBRAL_PALABRA = 0.8
# Tope defensivo: una empresa con miles de máquinas no debería recorrerlas todas en una
# tool que el modelo puede llamar varias veces por turno.
_MAX_CANDIDATAS = 500


def _normalizar(texto: str) -> str:
    """Minúsculas, sin acentos y con espacios colapsados."""
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFKD", (texto or "").lower()) if not unicodedata.combining(c)
    )
    return " ".join(sin_acentos.split())


@dataclass
class _Candidata:
    maquina: dict
    puntaje: float


def _parecido(a: str, b: str) -> float:
    """Similitud 0..1 entre dos cadenas ya normalizadas (difflib, el criterio de Python)."""
    return difflib.SequenceMatcher(None, a, b).ratio()


def _cobertura(consulta: list[str], tokens: list[str]) -> float:
    """
    Fracción de `tokens` que aparece en la consulta, con tolerancia ortográfica.

    Es el complemento de `difflib`: `get_close_matches` compara la cadena completa y por
    eso falla cuando la persona agrega palabras («el compresor A1 del sector 2»); medir
    palabra por palabra resuelve ese caso sin conocer ningún equipo de antemano.
    """
    utiles = [t for t in tokens if len(t) >= 2]
    if not utiles or not consulta:
        return 0.0
    hallados = sum(
        1 for t in utiles if any(_parecido(t, c) >= _UMBRAL_PALABRA for c in consulta)
    )
    return hallados / len(utiles)


def _puntaje(consulta: str, nombre: str, codigo: str) -> float:
    """
    Cuán probable es que `consulta` se refiera a esta máquina. No conoce ningún equipo: se
    calcula solo con los datos que vienen de la base.

    Combina dos criterios porque cada uno falla en un caso distinto (medido con un banco de
    17 formas reales de pedir un equipo):

    - `difflib` sobre la cadena completa → resuelve «compresor», «comp 1», «compresr a1».
    - cobertura de palabras → resuelve «el compresor A1 del sector 2», donde las palabras
      extra hunden el parecido de la cadena entera.

    Ninguno de los dos gana solo: difflib elegía «Compresor Neumático N2» para la frase
    larga, y la cobertura no encontraba «el motor». Tomar el máximo de ambos acertó los 17
    casos del banco.
    """
    q = _normalizar(consulta)
    n = _normalizar(nombre)
    c = _normalizar(codigo)

    if q in (n, c):
        return 1.0

    completo = max(_parecido(q, n), _parecido(q, c))

    palabras = [p for p in q.split() if len(p) >= 2]
    por_palabra = max(_cobertura(palabras, n.split()), _cobertura(palabras, c.split()))

    return max(completo, por_palabra)


async def _buscar_maquinas(empresa_id: int, consulta: str) -> list[dict]:
    """
    Candidatas ordenadas por parecido, solo de la empresa indicada.

    Se traen las máquinas de la empresa y se puntúan en Python: son pocas decenas y un
    `LIKE` estricto no tolera que el usuario escriba «Compresor» donde dice «Compressor».
    """
    filas = await fetch_all(
        """
        SELECT m.maquina_id, m.nombre, m.codigo, p.nombre AS planta
          FROM maquina m
          JOIN planta  p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = %(empresa)s
         ORDER BY m.nombre
         LIMIT %(limite)s
        """,
        {"empresa": empresa_id, "limite": _MAX_CANDIDATAS},
    )

    candidatas = [
        _Candidata(fila, _puntaje(consulta, fila["nombre"], fila["codigo"])) for fila in filas
    ]
    buenas = [c for c in candidatas if c.puntaje >= _UMBRAL_PARECIDO]
    buenas.sort(key=lambda c: c.puntaje, reverse=True)
    logger.info(
        "Tool consultar_ots_maquina: empresa=%s consulta=%r maquinas=%d candidatas=%d %s",
        empresa_id,
        consulta,
        len(filas),
        len(buenas),
        [(c.maquina["nombre"], round(c.puntaje, 2)) for c in buenas[:3]],
    )

    # Si el mejor es claramente mejor que el segundo, es una sola máquina: no tiene
    # sentido preguntar «¿cuál de estas 3?» cuando una gana por 0.9 contra 0.75.
    if len(buenas) >= 2 and buenas[0].puntaje - buenas[1].puntaje < 0.05:
        return [c.maquina for c in buenas[:_MAX_MAQUINAS]]
    return [c.maquina for c in buenas[:1]]


async def _resumen_maquina(empresa_id: int, maquina: dict) -> str:
    filas = await fetch_all(
        """
        SELECT estado::text AS estado, COUNT(*) AS total
          FROM orden_trabajo
         WHERE maquina_id = %(maquina)s
         GROUP BY estado
        """,
        {"maquina": maquina["maquina_id"]},
    )
    por_estado = {f["estado"]: int(f["total"]) for f in filas}
    abiertas = sum(por_estado.get(e, 0) for e in ESTADOS_ABIERTOS)

    recientes = await fetch_all(
        """
        SELECT numero_ot, estado::text AS estado, priority::text AS prioridad,
               fecha_creacion
          FROM orden_trabajo
         WHERE maquina_id = %(maquina)s AND estado::text = ANY(%(abiertos)s)
         ORDER BY fecha_creacion DESC
         LIMIT %(limite)s
        """,
        {"maquina": maquina["maquina_id"], "abiertos": list(ESTADOS_ABIERTOS), "limite": _MAX_OTS_LISTADAS},
    )

    detalle = ", ".join(
        f"{e}={por_estado[e]}" for e in ESTADOS_ABIERTOS if por_estado.get(e)
    ) or "ninguna"
    lineas = [
        f"Máquina: {maquina['nombre']} (código {maquina['codigo']}) — planta {maquina['planta']}.",
        f"Órdenes de trabajo abiertas: {abiertas} ({detalle}).",
        f"Total histórico de OTs de la máquina: {sum(por_estado.values())}.",
    ]
    if recientes:
        listado = "; ".join(
            f"{o['numero_ot']} ({o['estado']}, prioridad {o['prioridad']})" for o in recientes
        )
        lineas.append(f"Abiertas más recientes: {listado}.")
    return " ".join(lineas)


async def _listar_maquinas(empresa_id: int, limite: int = 8) -> tuple[list[str], int]:
    """
    Nombres de las máquinas de la empresa, para sugerir cuando no hay coincidencia.

    Devuelve (primeras `limite`, total). Sin esto, un «no encontré» deja al usuario en un
    callejón sin salida: en una conversación real insistió cuatro veces con un código
    inventado («S1») porque no sabía qué equipos existen.
    """
    filas = await fetch_all(
        """
        SELECT m.nombre, m.codigo
          FROM maquina m
          JOIN planta  p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = %(empresa)s
         ORDER BY m.nombre
         LIMIT %(limite)s
        """,
        {"empresa": empresa_id, "limite": limite},
    )
    total = await fetch_all(
        """
        SELECT COUNT(*) AS n
          FROM maquina m
          JOIN planta  p ON p.planta_id = m.planta_id
         WHERE p.empresa_id = %(empresa)s
        """,
        {"empresa": empresa_id},
    )
    return [f"{f['nombre']} ({f['codigo']})" for f in filas], int(total[0]["n"]) if total else 0


async def _resolver_maquina(
    empresa_id: int, consulta: str, accion: str
) -> tuple[dict | None, str | None]:
    """
    Traduce lo que escribió la persona a UNA máquina de su empresa.

    Devuelve `(maquina, None)` si hay una sola coincidencia, o `(None, mensaje)` con una
    respuesta ya redactada para el usuario (no existe, o es ambigua). Las dos tools
    comparten esto para que crear y consultar resuelvan los nombres igual.

    `accion` es la frase que cierra el mensaje de error («consulto sus órdenes de trabajo»
    o «creo la orden de trabajo»), para que la sugerencia tenga sentido en cada caso.
    """
    try:
        maquinas = await _buscar_maquinas(empresa_id, consulta)
    except Exception:  # noqa: BLE001 — una tool no debe tumbar el grafo
        # Se registra: un fallo silencioso dejaría al usuario creyendo que la máquina no
        # existe, cuando en realidad la consulta se rompió.
        logger.exception("Tool: fallo buscando %r en empresa %s", consulta, empresa_id)
        return None, "No pude consultar el inventario de máquinas. Intenta de nuevo."

    if not maquinas:
        try:
            nombres, total = await _listar_maquinas(empresa_id)
        except Exception:  # noqa: BLE001 — la sugerencia es un extra, no el dato pedido
            logger.warning(
                "Tool: no se pudo listar alternativas (empresa %s)", empresa_id, exc_info=True
            )
            nombres, total = [], 0

        if not nombres:
            return None, (
                f"No encontré ninguna máquina que coincida con «{consulta}» y tu empresa "
                "todavía no tiene equipos registrados en el mantenedor."
            )

        listado = ", ".join(nombres)
        resto = f" (hay {total} en total)" if total > len(nombres) else ""
        return None, (
            f"No encontré ninguna máquina que coincida con «{consulta}» en tu empresa.\n"
            f"Estas son las disponibles{resto}: {listado}.\n"
            f"Dime cuál te interesa y {accion}."
        )

    if len(maquinas) > 1:
        opciones = "; ".join(f"{m['nombre']} ({m['codigo']})" for m in maquinas)
        return None, (
            f"«{consulta}» coincide con varias máquinas: {opciones}. "
            "Indica cuál de ellas te interesa."
        )

    return maquinas[0], None


# ---------------------------------------------------------------------------
# Creación de OTs (Skill de acción)
# ---------------------------------------------------------------------------

# El modelo puede escribir la prioridad en español. Se normaliza acá y no en el prompt:
# un enum inválido haría fallar el INSERT y el usuario vería un error en vez de una OT.
_PRIORIDADES = {
    "baja": "low",
    "low": "low",
    "media": "medium",
    "medium": "medium",
    "normal": "medium",
    "alta": "high",
    "high": "high",
    "critica": "high",
    "crítica": "high",
    "urgente": "urgent",
    "urgent": "urgent",
}

# Si en los últimos minutos ya se creó una OT idéntica, no se duplica. Protege del modelo
# que llama dos veces a la tool (o del reintento automático del grafo) sin que el usuario
# vea dos órdenes iguales.
_MINUTOS_ANTIDUPLICADO = 10


def _normalizar_prioridad(valor: str | None) -> tuple[str, bool]:
    """Devuelve (prioridad_valida, era_reconocida)."""
    clave = _normalizar(valor or "")
    if clave in _PRIORIDADES:
        return _PRIORIDADES[clave], True
    return "medium", False


def _nuevo_numero_ot() -> str:
    """
    Número legible y único: OT-IA-AAAAMMDD-HHMMSS-XXXX.

    Se distingue de las del seed (SYN-HIST-) para poder auditar qué creó la IA. El sufijo
    aleatorio evita chocar con la restricción UNIQUE si se crean dos en el mismo segundo.
    """
    ahora = datetime.now(UTC)
    return f"OT-IA-{ahora:%Y%m%d-%H%M%S}-{uuid4().hex[:4].upper()}"


async def _resolver_tecnico(empresa_id: int, usuario_id: int | None, rol: str | None) -> dict | None:
    """
    A quién se le asigna la OT. `tecnico_id` es NOT NULL, así que hay que resolverlo.

    - Si quien escribe es técnico, se le asigna a él (es quien atiende en planta).
    - Si no (admin, supervisor, gerente...), se asigna al primer técnico de su empresa:
      asignar el trabajo a un administrador sería un dato falso en el tablero de carga.
    - Si la empresa no tiene técnicos, se devuelve None y la tool explica el bloqueo.
    """
    if rol == "tecnico" and usuario_id:
        fila = await fetch_one(
            """
            SELECT u.usuario_id, u.nombre
              FROM usuario u
              JOIN empresa e ON e.empresa_id = u.empresa_id
             WHERE u.usuario_id = %(uid)s AND u.empresa_id = %(empresa)s AND u.rol = 'tecnico'
            """,
            {"uid": usuario_id, "empresa": empresa_id},
        )
        if fila:
            return fila

    return await fetch_one(
        """
        SELECT usuario_id, nombre
          FROM usuario
         WHERE empresa_id = %(empresa)s AND rol = 'tecnico'
         ORDER BY usuario_id
         LIMIT 1
        """,
        {"empresa": empresa_id},
    )


def crear_tools(
    empresa_id: int, usuario_id: int | None = None, rol: str | None = None
) -> list[BaseTool]:
    """
    Tools disponibles para una empresa concreta y su usuario.

    Se construyen por request porque llevan el `empresa_id` dentro. Es barato (no hay I/O
    acá) y evita cualquier forma de fuga entre empresas: el modelo nunca recibe ni puede
    escribir el id de la empresa ni el del usuario.
    """

    @tool("consultar_ots_maquina")
    async def consultar_ots_maquina(nombre_maquina: str) -> str:
        """Consulta cuántas órdenes de trabajo (OTs) abiertas tiene una máquina.

        Úsala cuando pregunten por el estado, la carga de trabajo, las OTs pendientes o
        las fallas de un equipo concreto. Devuelve el desglose por estado y las OTs
        abiertas más recientes de esa máquina, dentro de la empresa del usuario.

        Args:
            nombre_maquina: Nombre o código del equipo, por ejemplo "Compresor A1" o
                "COMP-A1". Se admite coincidencia parcial.
        """
        consulta = (nombre_maquina or "").strip()
        if not consulta:
            return "Necesito el nombre o el código de la máquina para consultar sus OTs."

        maquina, error = await _resolver_maquina(
            empresa_id, consulta, "consulto sus órdenes de trabajo"
        )
        if error:
            return error

        try:
            return await _resumen_maquina(empresa_id, maquina)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "Tool consultar_ots_maquina: fallo leyendo OTs de %r", maquina.get("nombre")
            )
            return f"No pude leer las órdenes de trabajo ({type(e).__name__})."

    @tool("crear_ot")
    async def crear_ot(
        nombre_maquina: str,
        descripcion_problema: str,
        prioridad: str = "medium",
    ) -> str:
        """Crea una orden de trabajo (OT) correctiva para una máquina de la empresa.

        Úsala SOLO cuando el usuario pida explícitamente crear una OT, o cuando describa
        una falla y confirme que quiere registrarla. Antes de llamarla, pide confirmación
        y repite qué equipo, qué problema y qué prioridad vas a registrar.

        Args:
            nombre_maquina: Nombre o código del equipo, por ejemplo "Compresor A1".
                Se admite coincidencia parcial.
            descripcion_problema: Qué falla hay que atender, con el detalle que dio el
                usuario (síntoma, desde cuándo, qué se observó).
            prioridad: "low", "medium", "high" o "urgent". Por defecto "medium".

        Returns:
            Confirmación con el número de OT creado, o el motivo por el que no se creó.
        """
        maquina_txt = (nombre_maquina or "").strip()
        problema = " ".join((descripcion_problema or "").split())

        if not maquina_txt:
            return "Necesito el equipo al que corresponde la orden de trabajo."

        # Una OT con una descripción vacía o de dos palabras no le sirve a nadie en planta.
        if len(problema) < 8:
            return (
                "Necesito una descripción del problema un poco más concreta antes de crear "
                "la OT (qué falla, cuándo empezó o qué se observó)."
            )

        objetivo, error = await _resolver_maquina(empresa_id, maquina_txt, "creo la orden de trabajo")
        if error:
            return error

        prioridad_valida, reconocida = _normalizar_prioridad(prioridad)

        try:
            tecnico = await _resolver_tecnico(empresa_id, usuario_id, rol)
            if not tecnico:
                return (
                    f"La empresa no tiene técnicos registrados, así que no puedo asignar la "
                    f"OT de «{objetivo['nombre']}». Carga un técnico y vuelvo a intentarlo."
                )

            # Antiduplicado: mismo equipo y misma descripción abierta hace pocos minutos.
            repetida = await fetch_one(
                """
                SELECT ot_id, numero_ot, estado
                  FROM orden_trabajo
                 WHERE maquina_id = %(maquina)s
                   AND lower(trim(descripcion_problema)) = lower(trim(%(problema)s))
                   AND estado NOT IN ('completed', 'cancelled')
                   AND fecha_creacion > (NOW() - make_interval(mins => %(mins)s))
                 ORDER BY ot_id DESC
                 LIMIT 1
                """,
                {
                    "maquina": objetivo["maquina_id"],
                    "problema": problema,
                    "mins": _MINUTOS_ANTIDUPLICADO,
                },
            )
            if repetida:
                return (
                    f"Esa OT ya estaba creada: **{repetida['numero_ot']}** "
                    f"({repetida['estado']}) para {objetivo['nombre']}. No creé otra igual."
                )

            fecha_vencimiento = await fetch_one(
                "SELECT (NOW() + make_interval(mins => %(mins)s)) AS vence",
                {"mins": settings.sla_target_minutes},
            )

            creada = await fetch_one(
                """
                INSERT INTO orden_trabajo (
                    numero_ot, maquina_id, tecnico_id, creado_por,
                    tipo, descripcion_problema, priority, estado, fecha_vencimiento
                )
                VALUES (
                    %(numero)s, %(maquina)s, %(tecnico)s, %(creador)s,
                    'corrective', %(problema)s, %(prioridad)s, 'pending', %(vence)s
                )
                RETURNING ot_id, numero_ot, estado, priority, fecha_vencimiento
                """,
                {
                    "numero": _nuevo_numero_ot(),
                    "maquina": objetivo["maquina_id"],
                    "tecnico": tecnico["usuario_id"],
                    "creador": usuario_id or tecnico["usuario_id"],
                    "problema": problema,
                    "prioridad": prioridad_valida,
                    "vence": fecha_vencimiento["vence"] if fecha_vencimiento else None,
                },
            )
        except Exception as e:  # noqa: BLE001 — una tool no debe tumbar el grafo
            logger.exception(
                "Tool crear_ot: fallo creando OT para %r en empresa %s",
                objetivo.get("nombre"),
                empresa_id,
            )
            return f"No pude crear la orden de trabajo ({type(e).__name__}). No se creó nada."

        aviso_prioridad = (
            ""
            if reconocida
            else " (no reconocí la prioridad que pediste, usé «medium»)"
        )
        return (
            f"OT creada: **{creada['numero_ot']}**\n"
            f"- Equipo: {objetivo['nombre']} ({objetivo['codigo']}) — {objetivo.get('planta') or 'sin planta'}\n"
            f"- Problema: {problema}\n"
            f"- Tipo: correctivo · Prioridad: {creada['priority']}{aviso_prioridad}\n"
            f"- Estado: {creada['estado']} · Asignada a: {tecnico['nombre']}\n"
            "Puedes verla en el tablero de órdenes de trabajo."
        )

    return [consultar_ots_maquina, crear_ot]