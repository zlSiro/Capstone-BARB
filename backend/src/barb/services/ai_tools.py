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

from langchain_core.tools import BaseTool, tool

from barb.core.db import fetch_all
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


def crear_tools(empresa_id: int) -> list[BaseTool]:
    """
    Tools disponibles para una empresa concreta.

    Se construyen por request porque llevan el `empresa_id` dentro. Es barato (no hay I/O
    acá) y evita cualquier forma de fuga entre empresas.
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

        try:
            maquinas = await _buscar_maquinas(empresa_id, consulta)
        except Exception as e:  # noqa: BLE001 — una tool no debe tumbar el grafo
            # Se registra: un fallo silencioso dejaría al usuario creyendo que la máquina
            # no existe, cuando en realidad la consulta se rompió.
            logger.exception(
                "Tool consultar_ots_maquina: fallo buscando %r en empresa %s", consulta, empresa_id
            )
            return f"No pude consultar las órdenes de trabajo ({type(e).__name__})."

        if not maquinas:
            # Sugerir alternativas reales convierte un "no encontré" en un siguiente paso.
            # El usuario no tiene por qué saberse los nombres del inventario.
            try:
                nombres, total = await _listar_maquinas(empresa_id)
            except Exception:  # noqa: BLE001 — la sugerencia es un extra, no el dato pedido
                logger.warning(
                    "Tool consultar_ots_maquina: no se pudo listar alternativas (empresa %s)",
                    empresa_id,
                    exc_info=True,
                )
                nombres, total = [], 0

            if not nombres:
                return (
                    f"No encontré ninguna máquina que coincida con «{consulta}» y tu empresa "
                    "todavía no tiene equipos registrados en el mantenedor."
                )

            listado = ", ".join(nombres)
            resto = f" (hay {total} en total)" if total > len(nombres) else ""
            return (
                f"No encontré ninguna máquina que coincida con «{consulta}» en tu empresa.\n"
                f"Estas son las disponibles{resto}: {listado}.\n"
                "Dime cuál te interesa y consulto sus órdenes de trabajo."
            )

        if len(maquinas) > 1:
            opciones = "; ".join(f"{m['nombre']} ({m['codigo']})" for m in maquinas)
            return (
                f"«{consulta}» coincide con varias máquinas: {opciones}. "
                "Indica cuál de ellas te interesa."
            )

        try:
            return await _resumen_maquina(empresa_id, maquinas[0])
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "Tool consultar_ots_maquina: fallo leyendo OTs de %r", maquinas[0].get("nombre")
            )
            return f"No pude leer las órdenes de trabajo ({type(e).__name__})."

    return [consultar_ots_maquina]
