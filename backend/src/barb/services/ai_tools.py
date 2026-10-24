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

logger = logging.getLogger("barb.ai_tools")

# Estados que cuentan como "abierta" para el negocio. `overdue` es una OT que sigue
# pendiente de cierre, solo que atrasada.
ESTADOS_ABIERTOS = ("pending", "assigned", "in_progress", "overdue")

_MAX_MAQUINAS = 5
_MAX_OTS_LISTADAS = 10
# Umbral de parecido para aceptar una coincidencia difusa. Calibrado a la vista de los
# casos reales: «Compresor A1» vs «Compressor A1» da 0.96; un nombre inventado no pasa 0.5.
_UMBRAL_PARECIDO = 0.72
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


def _puntaje(consulta: str, nombre: str, codigo: str) -> float:
    """
    Cuán probable es que `consulta` se refiera a esta máquina.

    El modelo repite lo que dijo el usuario, y el usuario no escribe el nombre exacto:
    «Compresor A1» vs «Compressor A1», o solo el código. Por eso se combina coincidencia
    exacta, cobertura de palabras y parecido de secuencia, en vez de un LIKE estricto que
    fallaba con una sola letra de diferencia.
    """
    q = _normalizar(consulta)
    n = _normalizar(nombre)
    c = _normalizar(codigo)

    if q in (n, c):
        return 1.0

    parecidos = [
        difflib.SequenceMatcher(None, q, n).ratio(),
        difflib.SequenceMatcher(None, q, c).ratio(),
    ]

    # Cobertura de palabras: "compressor a1 manual" debe encontrar "Compressor A1".
    palabras_q = [p for p in q.split() if len(p) >= 2]

    def cobertura(tokens: list[str]) -> float:
        """Fracción de `tokens` que aparece en la consulta (con tolerancia ortográfica)."""
        utiles = [t for t in tokens if len(t) >= 2]
        if not utiles:
            return 0.0
        hallados = sum(
            1
            for t in utiles
            if any(difflib.SequenceMatcher(None, t, pq).ratio() >= 0.8 for pq in palabras_q)
        )
        return hallados / len(utiles)

    # Contener el nombre completo es una señal fuerte ("compressor a1 del sector 2").
    if n and n in q:
        parecidos.append(0.95)

    # Cobertura difusa: qué parte del nombre (o del código) aparece en la consulta aunque
    # el usuario agregue palabras o escriba con otra ortografía («el compresor A1 del
    # sector 2»). Sin esto, las palabras extra hundían el parecido de secuencia.
    # Nombre y código se puntúan por separado y se toma el mejor: sumarlos hacía que un
    # código que no aparece en la frase arrastrara el puntaje hacia abajo.
    cobertura_nombre = max(cobertura(n.split()), cobertura(c.split()))

    return max(*parecidos, cobertura_nombre * 0.9)


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
            return f"No pude consultar las órdenes de trabajo ({type(e).__name__})."

        if not maquinas:
            # Sugerir alternativas reales convierte un "no encontré" en un siguiente paso.
            # El usuario no tiene por qué saberse los nombres del inventario.
            try:
                nombres, total = await _listar_maquinas(empresa_id)
            except Exception:  # noqa: BLE001 — la sugerencia es un extra, no el dato pedido
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
            return f"No pude leer las órdenes de trabajo ({type(e).__name__})."

    return [consultar_ots_maquina]
