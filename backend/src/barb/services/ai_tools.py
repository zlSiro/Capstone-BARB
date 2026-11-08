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
3. **El INSERT de OTs está fuera del alcance del modelo (CGBIDA-476).** `proponer_ot` solo
   arma la propuesta y no toca la base; el INSERT vive en `crear_ot_aprobada`, que no es
   una tool: la ejecuta el gate del grafo (`chat_graph.py`) cuando el usuario confirma.
   Ni aunque el modelo insista puede crear una OT.
"""

from __future__ import annotations

import difflib
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field, ValidationError

from barb.core.config import settings
from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import ACCIONES, RUTAS, puede_acceder_ruta, puede_ejecutar_accion
from barb.core.work_order_states import ESTADOS_FINALES, TRANSICIONES
from barb.schemas.plantas import MaquinaCreate, PlantaCompletaCreate
from barb.services import catalog_service

logger = logging.getLogger("barb.ai_tools")

# Estados en los que una OT sigue viva. Se DERIVAN de la máquina de estados, que se declara
# «única fuente de verdad» (`core/work_order_states.py`): todo estado con transiciones
# salientes está abierto. Antes había una tupla escrita a mano que duplicaba ese
# conocimiento y se habría quedado desactualizada al agregar o retirar un estado.
ESTADOS_ABIERTOS: tuple[str, ...] = tuple(sorted(estado for estado in TRANSICIONES if estado not in ESTADOS_FINALES))

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
    sin_acentos = "".join(c for c in unicodedata.normalize("NFKD", (texto or "").lower()) if not unicodedata.combining(c))
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
    hallados = sum(1 for t in utiles if any(_parecido(t, c) >= _UMBRAL_PALABRA for c in consulta))
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

    candidatas = [_Candidata(fila, _puntaje(consulta, fila["nombre"], fila["codigo"])) for fila in filas]
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

    detalle = ", ".join(f"{e}={por_estado[e]}" for e in ESTADOS_ABIERTOS if por_estado.get(e)) or "ninguna"
    lineas = [
        f"Máquina: {maquina['nombre']} (código {maquina['codigo']}) — planta {maquina['planta']}.",
        f"Órdenes de trabajo abiertas: {abiertas} ({detalle}).",
        f"Total histórico de OTs de la máquina: {sum(por_estado.values())}.",
    ]
    if recientes:
        listado = "; ".join(f"{o['numero_ot']} ({o['estado']}, prioridad {o['prioridad']})" for o in recientes)
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


async def _resolver_maquina(empresa_id: int, consulta: str, accion: str) -> tuple[dict | None, str | None]:
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
            logger.warning("Tool: no se pudo listar alternativas (empresa %s)", empresa_id, exc_info=True)
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
        return None, (f"«{consulta}» coincide con varias máquinas: {opciones}. Indica cuál de ellas te interesa.")

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
# `crear_ot` es solo del supervisor por decisión del negocio (ver permissions.ACCIONES), pero
# las tools no pasan por las dependencias de FastAPI: sin este chequeo, un técnico creaba
# por el chat OTs que el endpoint le rechaza con 403.
# Texto fijado por el negocio: se muestra tal cual (la propuesta termina el turno con el texto EXACTO de la tool).
SIN_PERMISO_OT = "No tiene privilegios para generar OT sin un aviso de falla. Por favor generar conforme al flujo"


def _puede_crear_ot(rol: str | None) -> bool:
    """
    ¿El rol puede crear OTs? El mismo permiso que exige el endpoint (`require_action`).

    Falla cerrado: `puede_ejecutar_accion` lanza 403 si el rol no está en la matriz, y
    una tool nunca debe tumbar el grafo por eso. Ante la duda, no se crea la OT.
    """
    try:
        return puede_ejecutar_accion(rol or "", "crear_ot")
    except Exception:  # rol desconocido o matriz incompleta
        logger.exception("No se pudo evaluar el permiso 'crear_ot' para el rol %r", rol)
        return False


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


# ---------------------------------------------------------------------------
# Propuesta y confirmación de OTs (CGBIDA-476: el candado)
# ---------------------------------------------------------------------------

# Etiquetas humanas para el texto de la propuesta; la clave es el enum ya normalizado.
_ETIQUETA_PRIORIDAD = {"low": "baja", "medium": "media", "high": "alta", "urgent": "urgente"}

# La propuesta se PERSISTE como texto del asistente (el historial de chat_session guarda
# solo user/assistant y el grafo se re-crea en cada turno), así que su formato es
# parseable a propósito: el gate del turno siguiente (`chat_graph.py`) lo reconoce por el
# prefijo y re-extrae los datos para ejecutar el INSERT.
_PREFIJO_PROPUESTA = "PROPUESTA DE ORDEN DE TRABAJO"

TEXTO_RECHAZO = (
    "Entendido, descarté la propuesta de orden de trabajo. "
    "Si quieres crearla más adelante, pídemelo y armamos la propuesta de nuevo."
)

# Clasificación conservadora de la respuesta del usuario: solo el arranque explícito de la
# frase cuenta. Ante la duda se vuelve a preguntar — el error barato es re-preguntar, no
# crear una OT de más.
_AFIRMATIVAS = frozenset(
    {
        "si",
        "dale",
        "confirmo",
        "confirmada",
        "ok",
        "okey",
        "claro",
        "adelante",
        "correcto",
        "exacto",
        "creala",
        "hazlo",
        "yes",
        "yep",
        "listo",
    }
)
_NEGATIVAS = frozenset({"no", "espera", "todavia", "aun", "cancela", "cancelar", "despues", "frena", "detente"})

# Extracción de los datos desde el texto de la propuesta persistido. `consulta_maquina`
# queda con nombre y código tal como se propuso: es lo que el INSERT re-resuelve (y
# valida de nuevo) al confirmar.
_RE_EQUIPO = re.compile(r"- Equipo: (?P<consulta>.+?) \((?P<codigo>[^)]+)\)")
_RE_PROBLEMA = re.compile(r"- Problema: (?P<problema>.+)\n- Prioridad: ")
_RE_PRIORIDAD = re.compile(r"- Prioridad: (?P<prioridad>.+)")


def _texto_propuesta(maquina: dict, problema: str, prioridad: str) -> str:
    """Texto exacto que el asistente muestra (y persiste) al proponer una OT."""
    return (
        f"{_PREFIJO_PROPUESTA}\n\n"
        "Voy a crear una orden de trabajo con estos datos:\n\n"
        f"- Equipo: {maquina['nombre']} ({maquina['codigo']})"
        f" — planta {maquina.get('planta') or 'sin planta'}\n"
        f"- Problema: {problema}\n"
        f"- Prioridad: {_ETIQUETA_PRIORIDAD.get(prioridad, prioridad)}\n\n"
        "¿Confirmas la creación? (responde sí o no)"
    )


def _parsear_propuesta(texto: str) -> dict | None:
    """Datos de la propuesta desde su texto; None si el formato no cierra."""
    equipo = _RE_EQUIPO.search(texto)
    problema = _RE_PROBLEMA.search(texto)
    prioridad = _RE_PRIORIDAD.search(texto)
    if not (equipo and problema and prioridad):
        return None
    return {
        "consulta_maquina": equipo.group("consulta").strip(),
        "problema": problema.group("problema").strip(),
        "prioridad": _normalizar_prioridad(prioridad.group("prioridad"))[0],
    }


def propuesta_pendiente(messages: list[BaseMessage]) -> dict | None:
    """
    ¿El turno anterior dejó una propuesta (OT o planta) sin resolver? Devuelve sus datos
    con un campo `tipo` para que el gate sepa qué ejecutar.

    El historial guarda solo texto user/assistant y el turno de propuesta termina con el
    texto EXACTO de la tool (ver `chat_graph.finalizar_propuesta`), así que alcanza con
    mirar el último mensaje del asistente: si es una propuesta, está pendiente; si es una
    resolución («OT creada…», «Planta … creada», descarte) o charla común, no hay nada
    pendiente. La propuesta caduca sola en cuanto la conversación sigue.

    Regla de fallo cerrado: un texto con prefijo pero formato roto se descarta (None);
    nunca se interpreta un parseo fallido como aprobación.
    """
    ultimo_ai = next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)
    if ultimo_ai is None:
        return None
    texto = str(ultimo_ai.content)
    if texto.startswith(_PREFIJO_PROPUESTA_PLANTA):
        return _parsear_propuesta_planta(texto)  # ya lleva "tipo": "planta"
    if texto.startswith(_PREFIJO_PROPUESTA_PARAMETROS):
        return _parsear_propuesta_parametros(texto)  # ya lleva "tipo": "parametros"
    if texto.startswith(_PREFIJO_PROPUESTA_AVISO):
        return _parsear_propuesta_aviso(texto)  # ya lleva "tipo": "aviso"
    if texto.startswith(_PREFIJO_PROPUESTA):
        datos = _parsear_propuesta(texto)
        return {"tipo": "ot", **datos} if datos else None
    return None


def _primera_palabra(texto: str) -> str:
    """Primera palabra de la respuesta, sin puntuación y normalizada."""
    encontrada = re.search(r"[a-z0-9]+", _normalizar(texto))
    return encontrada.group(0) if encontrada else ""


def es_confirmacion(texto: str) -> bool:
    """True solo si la respuesta ARRANCA con una afirmación inequívoca."""
    return _primera_palabra(texto) in _AFIRMATIVAS


def es_rechazo(texto: str) -> bool:
    """True solo si la respuesta ARRANCA con un rechazo explícito."""
    return _primera_palabra(texto) in _NEGATIVAS


async def crear_ot_aprobada(
    consulta_maquina: str,
    problema: str,
    prioridad: str,
    empresa_id: int,
    usuario_id: int | None = None,
    rol: str | None = None,
) -> str:
    """
    Ejecuta el INSERT de una OT YA CONFIRMADA por el usuario.

    NO es una tool: el modelo no la ve ni puede llamarla. La única vía de entrada es el
    gate del grafo (`chat_graph.py`), que la invoca con los datos de la propuesta solo
    después de validar la confirmación del usuario. Re-resuelve la máquina en el momento
    de insertar: entre la propuesta y el «sí» pueden pasar minutos y el mantenedor puede
    haber cambiado.
    """
    # Defensa en profundidad: el gate del grafo ya pidió la confirmación, pero el permiso
    # se vuelve a evaluar con el rol de ESTE request (pudo cambiar entre la propuesta y el "sí").
    if not _puede_crear_ot(rol):
        return SIN_PERMISO_OT

    objetivo, error = await _resolver_maquina(empresa_id, consulta_maquina, "creo la orden de trabajo")
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
    except Exception as e:  # noqa: BLE001 — el gate no debe tumbar el grafo
        logger.exception(
            "crear_ot_aprobada: fallo insertando OT para %r en empresa %s",
            objetivo.get("nombre"),
            empresa_id,
        )
        return f"No pude crear la orden de trabajo ({type(e).__name__}). No se creó nada."

    aviso_prioridad = "" if reconocida else " (no reconocí la prioridad que pediste, usé «medium»)"
    return (
        f"OT creada: **{creada['numero_ot']}**\n"
        f"- Equipo: {objetivo['nombre']} ({objetivo['codigo']}) — {objetivo.get('planta') or 'sin planta'}\n"
        f"- Problema: {problema}\n"
        f"- Tipo: correctivo · Prioridad: {creada['priority']}{aviso_prioridad}\n"
        f"- Estado: {creada['estado']} · Asignada a: {tecnico['nombre']}\n"
        "Puedes verla en el tablero de órdenes de trabajo."
    )


# ---------------------------------------------------------------------------
# Permisos y plantas (HU-26: Skills de topología)
# ---------------------------------------------------------------------------

# El mantenedor es de gerente/admin (misma matriz que `require_route("plantas")`). Se
# replica acá porque las tools no pasan por las dependencias de FastAPI: el Depends del
# router nunca se ejecuta cuando la escritura la hace una tool.
# ---------------------------------------------------------------------------
# Mensaje de permisos unificado (pedido Alloxentrin, 05-11): cuando el rol no puede
# ejecutar una acción, el mensaje SIEMPRE dice qué role(s) lo pueden hacer, para que el
# usuario sepa a quién pedirle. Los responsables se DERIVAN de la matriz (`core/
# permissions.py`, única fuente): si el negocio cambia la matriz, el mensaje cambia
# con ella, no queda desalineado.
# ---------------------------------------------------------------------------
_ETIQUETA_ROL = {
    "operador": "operador",
    "tecnico": "técnico",
    "supervisor": "supervisor",
    "engineer": "ingeniero",
    "gerente": "gerente",
    "admin": "administrador",
    "super_usuario": "super usuario",
}

DESCRIPCION_ACCIONES = {
    "crear_ot": "crear órdenes de trabajo directas (sin aviso de falla previo)",
    "reportar_falla": "registrar avisos de falla",
    "gestionar_avisos": "generar la OT desde un aviso de falla o descartarlo",
    "subir_documentos": "subir documentación",
    "plantas": "gestionar el mantenedor de plantas, disciplinas y máquinas",
}


def _lista_en_espanol(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + f" o {items[-1]}"


def _responsables_de(accion: str) -> str:
    """Roles que SÍ pueden `accion`, leídos de la matriz de permisos (no escritos aquí).

    Las acciones viven en `ACCIONES`; las rutas (plantas, documentos…) en `RUTAS` — un
    valor `"ver"` de RUTAS no es acceso total, así que solo cuenta el `True` exacto.
    """
    matriz = ACCIONES.get(accion) if accion in ACCIONES else RUTAS.get(accion, {})
    roles = [_ETIQUETA_ROL.get(r, r) for r, tiene in matriz.items() if tiene is True]
    return _lista_en_espanol(sorted(roles))


def _mensaje_sin_permiso(accion: str) -> str:
    lo_que = DESCRIPCION_ACCIONES.get(accion, accion)
    responsables = _responsables_de(accion)
    return (
        f"No te está permitido {lo_que} con tu rol. "
        f"Esto lo hace un {responsables} de la empresa; pídeselo a esa persona o contacta al encargado para más información."
    )


PERMISO_DENEGADO = _mensaje_sin_permiso("plantas")


def _puede_gestionar(rol: str | None) -> bool:
    """El mantenedor es de gerente/admin: mismo permiso que el endpoint usaría."""
    try:
        return puede_acceder_ruta(rol or "", "plantas") is True
    except Exception:  # noqa: BLE001 — ruta no definida en la matriz
        logger.exception("No se pudo evaluar el permiso 'plantas' para el rol %r", rol)
        return False


_MAX_PLANTAS = 10


async def _buscar_plantas(empresa_id: int, consulta: str) -> list[dict]:
    """Plantas de la empresa que se parecen a la consulta (mismo criterio que máquinas)."""
    filas = await fetch_all(
        """
        SELECT p.planta_id, p.nombre, p.ubicacion,
               (SELECT COUNT(*) FROM maquina m WHERE m.planta_id = p.planta_id) AS maquinas
          FROM planta p
         WHERE p.empresa_id = %(empresa)s
         ORDER BY p.nombre
         LIMIT %(limite)s
        """,
        {"empresa": empresa_id, "limite": _MAX_CANDIDATAS},
    )
    candidatas = [_Candidata(fila, _puntaje(consulta, fila["nombre"], "")) for fila in filas]
    buenas = [c for c in candidatas if c.puntaje >= _UMBRAL_PARECIDO]
    buenas.sort(key=lambda c: c.puntaje, reverse=True)
    # Desempate igual que las máquinas: si el mejor le saca poco al segundo, se pide
    # desambiguación en vez de adivinar.
    if len(buenas) >= 2 and buenas[0].puntaje - buenas[1].puntaje < 0.05:
        return [c.maquina for c in buenas[:_MAX_PLANTAS]]
    return [c.maquina for c in buenas[:1]]


async def _resolver_planta(empresa_id: int, consulta: str, accion: str) -> tuple[dict | None, str | None]:
    """
    Traduce lo escrito a UNA planta de la empresa: `(planta, None)` si hay una sola
    coincidencia, o `(None, mensaje)` con la respuesta ya redactada (no existe o es
    ambigua). Mismo contrato que `_resolver_maquina`.
    """
    try:
        plantas = await _buscar_plantas(empresa_id, consulta)
    except Exception:  # noqa: BLE001 — una tool no debe tumbar el grafo
        logger.exception("Tool: fallo buscando planta %r en empresa %s", consulta, empresa_id)
        return None, "No pude consultar las plantas. Intenta de nuevo."

    if not plantas:
        return None, (
            f"No encontré ninguna planta que coincida con «{consulta}» en tu empresa. Dime el nombre exacto y {accion}."
        )

    if len(plantas) > 1:
        opciones = "; ".join(p["nombre"] for p in plantas)
        return None, (f"«{consulta}» coincide con varias plantas: {opciones}. Indica cuál de ellas te interesa.")

    return plantas[0], None


# ---------------------------------------------------------------------------
# Propuesta de planta nueva (mismo candado que las OTs: propuesta parseable + aprobada)
# ---------------------------------------------------------------------------

_PREFIJO_PROPUESTA_PLANTA = "PROPUESTA DE PLANTA NUEVA"

# Una línea por máquina, con separador "|". El formato lo generamos nosotros y lo
# parseamos nosotros: no depende de cómo redacte el modelo.
_RE_MAQUINA_PLANTA = re.compile(
    r"^- MAQ codigo=(?P<codigo>[^|]+?) \| nombre=(?P<nombre>[^|]+?) \| "
    r"disciplina=(?P<disciplina>[^|]*) \| sla=(?P<sla>[^|]*) \| costo=(?P<costo>[^|]*)$"
)


def _sin_separadores(texto: str) -> str:
    """Quita | y saltos de línea: un nombre con '|' podría inyectar campos en el parseo."""
    return " ".join(str(texto).replace("|", "/").split())


def _texto_propuesta_planta(nombre: str, ubicacion: str | None, maquinas: list[dict]) -> str:
    """Texto exacto que el asistente muestra (y persiste) al proponer una planta."""
    lineas = [
        _PREFIJO_PROPUESTA_PLANTA,
        "",
        f"Voy a crear la planta «{_sin_separadores(nombre)}»"
        + (f" en {_sin_separadores(ubicacion)}" if ubicacion else "")
        + " con estas máquinas:",
        "",
    ]
    if not maquinas:
        # QA del 05-11: se puede crear una planta vacía (el service lo permite), pero el
        # usuario debe verlo explicíto antes de confirmar, no descubrirlo después.
        lineas += [
            "⚠️ La propuesta va SIN MÁQUINAS: la planta quedará vacía y podrás "
            "agregarle equipos después desde el mantenedor o pidiéndomelo.",
            "",
        ]
    for m in maquinas:
        lineas.append(
            f"- MAQ codigo={_sin_separadores(m.get('codigo', ''))} "
            f"| nombre={_sin_separadores(m.get('nombre', ''))} "
            f"| disciplina={_sin_separadores(m.get('disciplina') or '')} "
            f"| sla={m.get('sla_horas') if m.get('sla_horas') is not None else ''} "
            f"| costo={m.get('costo_inactividad_minuto') if m.get('costo_inactividad_minuto') is not None else ''}"
        )
    lineas += ["", "¿Confirmas la creación? (responde sí o no)"]
    return "\n".join(lineas)


def _parsear_propuesta_planta(texto: str) -> dict | None:
    """Datos de la propuesta de planta, o None si el formato no cierra."""
    if not texto.startswith(_PREFIJO_PROPUESTA_PLANTA):
        return None

    # El sufijo es OBLIGATORIO porque el formato lo escribió siempre `_texto_propuesta_planta`
    # (parceo estricto: ejecutar un parseo que no cierre = no creó nada). La ubicación es
    # codiciosa y limitada a una línea: hasta la refactorización, `[^»]+?` (+ un grupo
    # opcional a su derecha) capturaba solo la primera letra («Q» en vez de «Quilicura»).
    cabecera = re.search(
        r"Voy a crear la planta «(?P<nombre>[^»]+)»(?: en (?P<ubicacion>[^\n»]+))?"
        r" con estas máquinas:",
        texto,
    )
    if not cabecera:
        return None

    maquinas = []
    for linea in texto.splitlines():
        m = _RE_MAQUINA_PLANTA.match(linea.strip())
        if not m:
            continue
        try:
            sla = float(m.group("sla")) if m.group("sla").strip() else None
            costo = float(m.group("costo")) if m.group("costo").strip() else None
        except ValueError:
            return None  # propuesta corrupta: se descarta, no se adivina
        maquinas.append(
            {
                "nombre": m.group("nombre").strip(),
                "codigo": m.group("codigo").strip(),
                "disciplina": m.group("disciplina").strip() or None,
                "sla_horas": sla,
                "costo_inactividad_minuto": costo,
            }
        )

    return {
        "tipo": "planta",
        "nombre": cabecera.group("nombre").strip(),
        "ubicacion": (cabecera.group("ubicacion") or "").strip() or None,
        "maquinas": maquinas,
    }


class _MaquinaPlanta(BaseModel):
    """Una máquina del alta masiva. El modelo ve estos campos y sus descripciones."""

    nombre: str = Field(description="Nombre del equipo, ej. 'Compressor A1'")
    codigo: str = Field(description="Código único dentro de la planta, ej. 'COMP-A1'")
    disciplina: str | None = Field(default=None, description="Mecánica, Eléctrica, Neumática… (opcional)")
    sla_horas: float | None = Field(default=None, ge=0, le=8760, description="Horas de SLA (opcional)")
    costo_inactividad_minuto: float | None = Field(default=None, ge=0, description="Costo por minuto detenida (opcional)")


_MAX_MAQUINAS_ALTA = 15


async def crear_planta_aprobada(
    nombre: str,
    maquinas: list[dict],
    empresa_id: int,
    usuario_id: int | None = None,
    rol: str | None = None,
    ubicacion: str | None = None,
) -> str:
    """
    Crea la planta YA CONFIRMADA por el usuario.

    NO es una tool: el modelo no la ve ni puede llamarla. La invoca el gate del grafo
    (`chat_graph.py`) con los datos de la propuesta, solo después de validar el «sí».
    La propuesta llega parseada del texto de la conversación, así que se revalida entera
    con Pydantic antes de escribir.
    """
    if not _puede_gestionar(rol):
        return PERMISO_DENEGADO

    try:
        payload = PlantaCompletaCreate(
            nombre=nombre,
            ubicacion=ubicacion,
            disciplinas=sorted(
                {str(m["disciplina"]).strip() for m in maquinas if m.get("disciplina") and str(m["disciplina"]).strip()}
            ),
            maquinas=[MaquinaCreate(**m) for m in maquinas],
        )
    except ValidationError:
        return (
            "La propuesta quedó incompleta o inválida, así que no creé nada. Volvamos a armarla con `proponer_planta_completa`."
        )

    try:
        resultado = await catalog_service.crear_planta_completa(empresa_id, payload)
    except catalog_service.DomainError as e:
        return f"No pude crear la planta: {e.mensaje}"
    except Exception as e:  # noqa: BLE001
        logger.exception("crear_planta_aprobada: fallo creando %r", nombre)
        return f"No pude crear la planta ({type(e).__name__}). No se guardó nada."

    logger.info(
        "crear_planta_aprobada: empresa=%s usuario=%s planta=%s maquinas=%d",
        empresa_id,
        usuario_id,
        resultado.get("planta_id"),
        len(maquinas),
    )
    return f"Planta «{resultado['nombre']}» creada con {len(resultado.get('maquinas', []))} máquina(s)."


# ---------------------------------------------------------------------------
# Propuesta de cambio de parámetros (mismo candado: propuesta parseable + aprobada)
#
# La v1 dejaba el write dentro de la tool y frenaba el cambio solo con una regla del
# prompt: en prod el modelo la ignoró y cambió un SLA sin confirmación (31-10). Como el
# modelo es probabilístico, el freno tenía que ser mecánico, como el de las OTs y las
# plantas: la tool SOLO redacta la propuesta; el write vive en `actualizar_parametros_
# aprobada`, que no es tool y la ejecuta el gate tras validar el «sí».
# ---------------------------------------------------------------------------

_PREFIJO_PROPUESTA_PARAMETROS = "PROPUESTA DE CAMBIO DE PARÁMETROS"

# Una línea por la máquina tocada, con separador "|". `sla=`/`costo=` vacíos = sin cambio.
_RE_LINEA_PARAMETROS = re.compile(
    r"^- MAQ codigo=(?P<codigo>[^|]+?) \| nombre=(?P<nombre>[^|]+?) "
    r"\| planta=(?P<planta>[^|]*?) "
    r"\| sla=(?P<sla>[^|]*) \| costo=(?P<costo>[^|]*)$"
)


def _texto_propuesta_parametros(maquina: dict, antes: dict, cambios: dict) -> str:
    """Texto exacto que el asistente muestra (y persiste) al proponer cambiar SLA/costo.

    `maquina` es el dict del resolver (nombre, codigo, planta); `antes` trae los valores
    actuales; `cambios` SOLO los campos a cambiar. El valor nuevo que queda si el usuario
    confirma se muestra tal cual se guardará.
    """
    lineas = [
        _PREFIJO_PROPUESTA_PARAMETROS,
        "",
        f"Voy a actualizar «{_sin_separadores(maquina['nombre'])}» "
        f"[{_sin_separadores(maquina['codigo'])}]"
        + (f" en {_sin_separadores(maquina.get('planta') or '')}" if maquina.get("planta") else "")
        + ":",
        "",
    ]
    sla_nuevo = f"{cambios['sla_horas']:g}" if "sla_horas" in cambios else ""
    costo_nuevo = f"{cambios['costo_inactividad_minuto']:g}" if "costo_inactividad_minuto" in cambios else ""
    lineas.append(
        f"- MAQ codigo={_sin_separadores(maquina['codigo'])} "
        f"| nombre={_sin_separadores(maquina['nombre'])} "
        f"| planta={_sin_separadores(maquina.get('planta') or '')} "
        f"| sla={sla_nuevo} | costo={costo_nuevo}"
    )
    detalles = []
    if "sla_horas" in cambios:
        antes_sla = "sin definir (usa el general)" if antes["sla_horas"] is None else f"{float(antes['sla_horas']):g} h"
        detalles.append(f"- SLA: {antes_sla} → {float(cambios['sla_horas']):g} h")
    if "costo_inactividad_minuto" in cambios:
        antes_costo = (
            "sin definir (usa el general)"
            if antes["costo_inactividad_minuto"] is None
            else f"{float(antes['costo_inactividad_minuto']):,.0f}/min".replace(",", ".")
        )
        detalles.append(
            f"- Costo por minuto: {antes_costo} → {float(cambios['costo_inactividad_minuto']):,.0f}/min".replace(",", ".")
        )
    lineas += [*detalles, "", "¿Confirmas el cambio? (responde sí o no)"]
    return "\n".join(lineas)


def _parsear_propuesta_parametros(texto: str) -> dict | None:
    """Datos de la propuesta de parámetros, o None si el formato no cierra (fallo cerrado)."""
    if not texto.startswith(_PREFIJO_PROPUESTA_PARAMETROS):
        return None

    maquinas = []
    for linea in texto.splitlines():
        m = _RE_LINEA_PARAMETROS.match(linea.strip())
        if not m:
            continue
        try:
            sla = float(m.group("sla")) if m.group("sla").strip() else None
            costo = float(m.group("costo")) if m.group("costo").strip() else None
        except ValueError:
            return None  # propuesta corrupta: se descarta, no se adivina
        maquinas.append(
            {
                "nombre": m.group("nombre").strip(),
                "codigo": m.group("codigo").strip(),
                "planta": m.group("planta").strip() or None,
                "sla_horas": sla,
                "costo_inactividad_minuto": costo,
            }
        )

    if len(maquinas) != 1 or (maquinas[0]["sla_horas"] is None and maquinas[0]["costo_inactividad_minuto"] is None):
        # Debe haber EXACTAMENTE una máquina y al menos un campo a cambiar; cualquier
        # cosa fuera de eso no es interpretable y no se escribe nada.
        return None

    return {
        "tipo": "parametros",
        **maquinas[0],
    }


async def actualizar_parametros_aprobada(
    codigo: str,
    sla_horas: float | None,
    costo_inactividad_minuto: float | None,
    empresa_id: int,
    usuario_id: int | None = None,
    rol: str | None = None,
) -> str:
    """
    Cambia los parámetros de la máquina YA CONFIRMADOS por el usuario.

    NO es una tool: el modelo no la ve ni puede llamarla. La invoca el gate del grafo
    (`chat_graph.py`) con la propuesta parseada del texto de la conversación, solo
    después de validar el «sí». Se revalida TODO: rangos, permiso y la máquina se
    re-resuelve por código EXACTO (no por lo que el modelo haya parecido entender).
    """
    if not _puede_gestionar(rol):
        return PERMISO_DENEGADO

    cambios = {}
    if sla_horas is not None:
        cambios["sla_horas"] = sla_horas
    if costo_inactividad_minuto is not None:
        cambios["costo_inactividad_minuto"] = costo_inactividad_minuto
    if not cambios:
        return "La propuesta no indicaba ningún valor nuevo, así que no cambié nada."

    if sla_horas is not None and not (0 <= sla_horas <= 8760):
        return "La propuesta tenía un SLA fuera de rango (0 a 8760 h); no cambié nada."
    if costo_inactividad_minuto is not None and costo_inactividad_minuto < 0:
        return "La propuesta tenía un costo negativo; no cambié nada."

    # Re-resolución por código EXACTO: la duplicidad o la máquina borrada después de la
    # propuesta se detectan acá, no se adivinan con el nombre difuso.
    try:
        objetivo = await fetch_one(
            """
            SELECT m.maquina_id, m.nombre
              FROM maquina m
              JOIN planta p ON p.planta_id = m.planta_id
             WHERE lower(m.codigo) = lower(%(c)s) AND p.empresa_id = %(e)s
             LIMIT 1
            """,
            {"c": (codigo or "").strip(), "e": empresa_id},
        )
    except Exception:  # noqa: BLE001 — el gate no debe tumbar el turno
        logger.exception("actualizar_parametros_aprobada: fallo buscando %r", codigo)
        return "No pude validar la máquina. No cambié nada."
    if not objetivo:
        return (
            f"No encontré la máquina con código «{codigo}» en tu empresa "
            "(¿se borró o cambió de planta desde la propuesta?). No cambié nada."
        )

    try:
        antes = await fetch_one(
            "SELECT sla_horas, costo_inactividad_minuto FROM maquina WHERE maquina_id = %(m)s",
            {"m": objetivo["maquina_id"]},
        )
        # La MISMA función que usa el PATCH: 404 multi-empresa, validación y FOR UPDATE
        # salen de ahí. Una sola lógica de escritura para HTTP y chat.
        await catalog_service.actualizar_maquina(empresa_id, objetivo["maquina_id"], cambios)
    except catalog_service.DomainError as e:
        return e.mensaje
    except Exception as e:  # noqa: BLE001
        logger.exception("actualizar_parametros_aprobada: fallo con %r (empresa %s)", codigo, empresa_id)
        return f"No pude actualizar «{objetivo['nombre']}» ({type(e).__name__}). No cambié nada."

    logger.info(
        "actualizar_parametros_aprobada: empresa=%s usuario=%s maquina=%s cambios=%s",
        empresa_id,
        usuario_id,
        objetivo["maquina_id"],
        cambios,
    )

    def _fmt(valor, sufijo: str) -> str:
        return "sin definir (usa el general)" if valor is None else f"{float(valor):g} {sufijo}"

    # OJO: `.get()`, no `or`: un SLA de 0 es válido y el `or` lo descartaría.
    nuevo_sla = cambios.get("sla_horas", antes["sla_horas"])
    nuevo_costo = cambios.get("costo_inactividad_minuto", antes["costo_inactividad_minuto"])

    return (
        f"Actualicé «{objetivo['nombre']}»:\n"
        f"- SLA: {_fmt(antes['sla_horas'], 'h')} → {_fmt(nuevo_sla, 'h')}\n"
        f"- Costo por minuto: {_fmt(antes['costo_inactividad_minuto'], '/min')} → "
        f"{_fmt(nuevo_costo, '/min')}\n"
        "Los próximos vencimientos de OT ya se calculan con el SLA nuevo."
    )


# ---------------------------------------------------------------------------
# Propuesta de aviso de falla (HU-20 / CGBIDA-512): tercer candado, misma mecánica.
#
# La lógica de avisos de Samuel (HU-23, migración 0012) ya escribe y ya tiene permisos
# (`reportar_falla`); el chat respeta EXACTO eso: la tool solo redacta la propuesta y el
# write (`registrar_aviso_aprobada`, no-tool) lo ejecuta el gate tras el «sí», revalidando
# permiso, severidad y re-resolviendo la máquina por CÓDIGO EXACTO. Un aviso NO es una OT:
# queda `pendiente` en la bandeja hasta que el supervisor decida.
# ---------------------------------------------------------------------------

_PREFIJO_PROPUESTA_AVISO = "PROPUESTA DE AVISO DE FALLA"

_PREFIJO_AVISO = "AV-"  # espejo de routers.avisos.PREFIJO (importarlo traería la capa HTTP)

# Una sola línea con separador "|", misma disciplina que las otras propuestas.
_RE_LINEA_AVISO = re.compile(
    r"^- AVISO codigo=(?P<codigo>[^|]+?) \| severidad=(?P<severidad>[^|]+?) \| descripcion=(?P<descripcion>.+)$"
)

_SEVERIDADES_VALIDAS = ("low", "medium", "high", "critical")

_SEVERIDAD_A_CLAVE = {
    "low": "low",
    "baja": "low",
    "medium": "medium",
    "media": "medium",
    "high": "high",
    "alta": "high",
    "critical": "critical",
    "critica": "critical",
    "crítica": "critical",
    "criteriosa": "critical",
    "severa": "critical",
}
_ETIQUETA_SEVERIDAD = {"low": "baja", "medium": "media", "high": "alta", "critical": "crítica"}


def _normalizar_severidad(valor: str | None) -> tuple[str, bool]:
    """Devuelve (severidad_valida_en_ingles, era_reconocida). Sin dato → media."""
    clave = _normalizar(valor or "media")
    if clave in _SEVERIDAD_A_CLAVE:
        return _SEVERIDAD_A_CLAVE[clave], True
    return "medium", False


def _texto_propuesta_aviso(maquina: dict, descripcion: str, severidad: str) -> str:
    """Texto exacto que el asistente muestra (y persiste) al proponer registrar una falla."""
    return (
        f"{_PREFIJO_PROPUESTA_AVISO}\n\n"
        f"Voy a registrar un aviso de falla de «{_sin_separadores(maquina['nombre'])}» "
        f"[{_sin_separadores(maquina['codigo'])}]"
        + (f" en {_sin_separadores(maquina['planta'])}" if maquina.get("planta") else "")
        + ":\n\n"
        f"- AVISO codigo={_sin_separadores(maquina['codigo'])} "
        f"| severidad={_ETIQUETA_SEVERIDAD[severidad]} "
        f"| descripcion={_sin_separadores(descripcion)}\n\n"
        "La falla queda pendiente para el supervisor (no se crea una OT al instante).\n"
        "¿Confirmas el registro? (responde sí o no)"
    )


def _parsear_propuesta_aviso(texto: str) -> dict | None:
    """Datos del aviso propuesto, o None si el formato no cierra (fallo cerrado)."""
    if not texto.startswith(_PREFIJO_PROPUESTA_AVISO):
        return None
    for linea in texto.splitlines():
        m = _RE_LINEA_AVISO.match(linea.strip())
        if not m:
            continue
        clave = _normalizar(m.group("severidad"))
        if clave not in _SEVERIDAD_A_CLAVE:
            return None  # severidad que no cierra: la propuesta se descarta entera
        descripcion = m.group("descripcion").strip()
        if len(descripcion) < 5:
            return None
        return {
            "tipo": "aviso",
            "codigo": m.group("codigo").strip(),
            "severidad": _SEVERIDAD_A_CLAVE[clave],
            "descripcion": descripcion,
        }
    return None


async def registrar_aviso_aprobada(
    codigo: str,
    descripcion: str,
    severidad: str,
    empresa_id: int,
    usuario_id: int | None = None,
    rol: str | None = None,
) -> str:
    """
    Registra el aviso de falla YA CONFIRMADO por el usuario.

    NO es una tool: el modelo no la ve ni puede llamarla. La invoca el gate del grafo
    tras validar el «sí». Se revalida TODO: permiso `reportar_falla` (misma matriz del
    endpoint de Samuel), severidad y la máquina se re-resuelve por CÓDIGO EXACTO. El
    INSERT es la MISMA lógica del endpoint (`AvisoCreateRequest`): numero temporal que se
    reemplaza por `AV-año-id`, dentro de UNA transacción.
    """
    try:
        puede = puede_ejecutar_accion(rol or "", "reportar_falla")
    except Exception:  # noqa: BLE001 — rol desconocido: el fallo cerrado no registra
        puede = False
    if not puede:
        return _mensaje_sin_permiso("reportar_falla")

    desc = " ".join((descripcion or "").split())
    if len(desc) < 5:
        return "La propuesta no tenía descripción utilizable, así que no registré nada."
    if len(desc) > 5000:
        return "La descripción supera el máximo de 5000 caracteres; acórtala y lo volvemos a registrar."
    sev, reconocida = _normalizar_severidad(severidad)
    if not reconocida:
        return f"La severidad «{severidad}» no es válida (baja, media, alta o crítica); no registré nada."

    # Re-resolución por código EXACTO: igual que en los parámetros, nada de adivinar.
    try:
        objetivo = await fetch_one(
            """
            SELECT m.maquina_id, m.nombre, m.codigo, p.nombre AS planta
              FROM maquina m
              JOIN planta p ON p.planta_id = m.planta_id
             WHERE lower(m.codigo) = lower(%(c)s) AND p.empresa_id = %(e)s
             LIMIT 1
            """,
            {"c": (codigo or "").strip(), "e": empresa_id},
        )
    except Exception:  # noqa: BLE001 — el gate no debe tumbar el turno
        logger.exception("registrar_aviso_aprobada: fallo buscando %r", codigo)
        return "No pude validar la máquina. No registré nada."
    if not objetivo:
        return (
            f"No encontré la máquina con código «{codigo}» en tu empresa "
            "(¿se borró o cambió de planta desde la propuesta?). No registré nada."
        )

    try:
        async with transaction() as cur:
            await cur.execute(
                """
                INSERT INTO aviso_falla (numero_aviso, maquina_id, reportado_por, descripcion, severidad)
                VALUES (%(numero)s, %(maquina_id)s, %(usuario_id)s, %(descripcion)s, %(severidad)s)
                RETURNING aviso_falla_id
                """,
                {
                    "numero": f"{_PREFIJO_AVISO}TEMP-{datetime.now(UTC).strftime('%H%M%S%f')}",
                    "maquina_id": objetivo["maquina_id"],
                    "usuario_id": usuario_id,
                    "descripcion": desc,
                    "severidad": sev,
                },
            )
            aviso_id = int((await cur.fetchone())["aviso_falla_id"])
            numero = f"{_PREFIJO_AVISO}{datetime.now(UTC).year}-{aviso_id:04d}"
            await cur.execute(
                "UPDATE aviso_falla SET numero_aviso = %(numero)s WHERE aviso_falla_id = %(id)s",
                {"numero": numero, "id": aviso_id},
            )
    except Exception as e:  # noqa: BLE001
        logger.exception("registrar_aviso_aprobada: fallo registrando para %r", objetivo["nombre"])
        return f"No pude registrar el aviso ({type(e).__name__}). No se guardó nada."

    logger.info(
        "registrar_aviso_aprobada: empresa=%s usuario=%s maquina=%s aviso=%s severidad=%s",
        empresa_id,
        usuario_id,
        objetivo["maquina_id"],
        numero,
        sev,
    )
    return (
        f"Aviso {numero} registrado para «{objetivo['nombre']}» "
        f"[{_sin_separadores(objetivo['codigo'])}] con gravedad {_ETIQUETA_SEVERIDAD[sev]}.\n"
        "Queda pendiente en la bandeja de avisos: el supervisor decidirá si se genera la OT. "
        "Puedes seguirlo en Avisos > mis avisos."
    )


# Los cuatro prefijos de propuesta, en un solo lugar: `chat_graph.tras_tools` decide con
# ellos si el turno termina con el texto EXACTO de la tool (propuesta) o si el error
# vuelve al modelo para conversarse (QA 07-11: la tool pedía ubicación con texto crudo
# y el turno quedaba pegado en él).
PREFIJOS_DE_PROPUESTA: tuple[str, ...] = (
    _PREFIJO_PROPUESTA,
    _PREFIJO_PROPUESTA_PLANTA,
    _PREFIJO_PROPUESTA_PARAMETROS,
    _PREFIJO_PROPUESTA_AVISO,
)


def crear_tools(
    empresa_id: int,
    usuario_id: int | None = None,
    rol: str | None = None,
    habla_del_usuario: list[str] | None = None,
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

        maquina, error = await _resolver_maquina(empresa_id, consulta, "consulto sus órdenes de trabajo")
        if error:
            return error

        try:
            return await _resumen_maquina(empresa_id, maquina)
        except Exception as e:  # noqa: BLE001
            logger.exception("Tool consultar_ots_maquina: fallo leyendo OTs de %r", maquina.get("nombre"))
            return f"No pude leer las órdenes de trabajo ({type(e).__name__})."

    @tool("proponer_ot")
    async def proponer_ot(
        nombre_maquina: str,
        descripcion_problema: str,
        prioridad: str = "medium",
    ) -> str:
        """Registra la propuesta de crear una orden de trabajo (OT) correctiva y el
        sistema le pide confirmación al usuario.

        Úsala SOLO cuando el usuario pida explícitamente crear una OT, o cuando describa
        una falla y confirme que quiere registrarla. NO crea nada: la OT se crea solo si
        el usuario responde que sí. Si el usuario corrige un dato (equipo, problema o
        prioridad), vuelve a llamarla con los datos corregidos.

        Args:
            nombre_maquina: Nombre o código del equipo, por ejemplo "Compresor A1".
                Se admite coincidencia parcial.
            descripcion_problema: Qué falla hay que atender, con el detalle que dio el
                usuario (síntoma, desde cuándo, qué se observó).
            prioridad: "low", "medium", "high" o "urgent". Por defecto "medium".
        """
        if not _puede_crear_ot(rol):
            return SIN_PERMISO_OT

        maquina_txt = (nombre_maquina or "").strip()
        problema = " ".join((descripcion_problema or "").split())

        if not maquina_txt:
            return "Necesito el equipo al que corresponde la orden de trabajo."

        # Una OT con una descripción vacía o de dos palabras no le sirve a nadie en planta.
        if len(problema) < 8:
            return (
                "Necesito una descripción del problema un poco más concreta antes de proponer "
                "la OT (qué falla, cuándo empezó o qué se observó)."
            )

        objetivo, error = await _resolver_maquina(empresa_id, maquina_txt, "creo la orden de trabajo")
        if error:
            return error

        prioridad_valida, _ = _normalizar_prioridad(prioridad)
        return _texto_propuesta(objetivo, problema, prioridad_valida)

    @tool("listar_maquinas_planta")
    async def listar_maquinas_planta(planta: str = "") -> str:
        """Lista las máquinas de una planta, con su SLA, su costo de inactividad y sus
        OTs abiertas.

        Úsala SIEMPRE antes de modificar o crear algo en el mantenedor: es la forma de
        saber qué existe de verdad y no inventar nombres, códigos ni plantas.

        Args:
            planta: Nombre o parte del nombre de la planta. Si se omite, devuelve el
                listado de plantas de la empresa con cuántas máquinas tiene cada una.
        """
        # Sin `_puede_gestionar`: leer el catálogo lo puede hacer cualquier usuario
        # autenticado (es lo que hacen los GET del router). Ver spec §4.6.
        consulta = (planta or "").strip()

        if not consulta:
            filas = await fetch_all(
                """
                SELECT p.nombre, p.ubicacion,
                       (SELECT COUNT(*) FROM maquina m WHERE m.planta_id = p.planta_id) AS n
                  FROM planta p
                 WHERE p.empresa_id = %(e)s
                 ORDER BY p.nombre
                """,
                {"e": empresa_id},
            )
            if not filas:
                return "Tu empresa todavía no tiene plantas en el mantenedor."
            lineas = [f"- {f['nombre']} ({f['n']} máquina(s), {f['ubicacion'] or 'sin ubicación'})" for f in filas]
            return "Plantas de tu empresa:\n" + "\n".join(lineas)

        objetivo, error = await _resolver_planta(empresa_id, consulta, "reviso sus máquinas")
        if error:
            return error

        maquinas = await fetch_all(
            """
            SELECT m.nombre, m.codigo, m.sla_horas, m.costo_inactividad_minuto,
                   d.nombre AS disciplina,
                   (SELECT COUNT(*) FROM orden_trabajo ot
                     WHERE ot.maquina_id = m.maquina_id
                       AND ot.estado NOT IN ('completed', 'cancelled')) AS abiertas
              FROM maquina m
              LEFT JOIN disciplina d ON d.disciplina_id = m.disciplina_id
             WHERE m.planta_id = %(p)s
             ORDER BY m.nombre
            """,
            {"p": objetivo["planta_id"]},
        )
        if not maquinas:
            return f"«{objetivo['nombre']}» todavía no tiene máquinas."

        # Tabla, no viñetas: con 12+ equipos una lista plana se pierde en el chat; la tabla
        # es lo que el frontend renderiza con columnas alineadas. Los valores con una sola
        # línea de contexto van en su celda («el general» = usa el SLA/costo de la planta,
        # no inventado). Cada celda se sanea con `_sin_separadores`: un «|» en un nombre
        # rompería la tabla.
        filas = []
        for i, m in enumerate(maquinas, start=1):
            sla = f"{float(m['sla_horas']):g} h" if m["sla_horas"] is not None else "el general"
            costo = (
                f"{float(m['costo_inactividad_minuto']):,.0f}".replace(",", ".")
                if m["costo_inactividad_minuto"] is not None
                else "el general"
            )
            filas.append(
                f"| {i} | {_sin_separadores(m['nombre'])} | {_sin_separadores(m['codigo'])} "
                f"| {_sin_separadores(m['disciplina'] or 'sin disciplina')} "
                f"| {sla} | {costo} | {m['abiertas']} |"
            )

        return (
            f"Máquinas de «{objetivo['nombre']}» ({len(maquinas)}):\n"
            "\n"
            "| # | Máquina | Código | Disciplina | SLA | Costo/min | OTs abiertas |\n"
            "|---|---------|--------|------------|-----|-----------|--------------|\n" + "\n".join(filas)
        )

    @tool("actualizar_parametros_maquina")
    async def actualizar_parametros_maquina(
        nombre_maquina: str,
        sla_horas: float | None = None,
        costo_inactividad_minuto: float | None = None,
    ) -> str:
        """Registra la propuesta de cambiar el SLA (en horas) y/o el costo de inactividad
        por minuto de una máquina, y el sistema le pide confirmación al usuario.

        NO cambia nada: la escritura ocurre solo si el usuario responde que sí. Si no
        sabes cuál es la máquina, usa `listar_maquinas_planta` antes. NO la llames de
        nuevo en el mismo turno ni insistas después de proponer: la confirmación la
        maneja el sistema, no tú. Si el usuario corrige un valor, vuelve a llamarla con
        el valor corregido.

        Args:
            nombre_maquina: Nombre o código del equipo ("Compressor A1", "COMP-A1").
                Se admite coincidencia parcial.
            sla_horas: Horas de plazo que tolera estar detenida (0 a 8760).
                Omitir si no se cambia.
            costo_inactividad_minuto: Costo por minuto detenida (>= 0).
                Omitir si no se cambia.
        """
        if not _puede_gestionar(rol):
            return PERMISO_DENEGADO

        # Rangos y "qué cambias" se validan ANTES de resolver la máquina: mensajes más
        # útiles y no se gasta la búsqueda en una propuesta que de todos modos se cae.
        if sla_horas is None and costo_inactividad_minuto is None:
            return "Di qué cambias: el SLA en horas, el costo por minuto, o los dos."

        if sla_horas is not None and not (0 <= sla_horas <= 8760):
            return "El SLA tiene que estar entre 0 y 8760 horas (un año)."
        if costo_inactividad_minuto is not None and costo_inactividad_minuto < 0:
            return "El costo por minuto no puede ser negativo."

        consulta = (nombre_maquina or "").strip()
        if not consulta:
            return "Necesito el nombre o el código de la máquina."

        maquina, error = await _resolver_maquina(empresa_id, consulta, "actualizo sus parámetros")
        if error:
            return error

        cambios = {}
        if sla_horas is not None:
            cambios["sla_horas"] = sla_horas
        if costo_inactividad_minuto is not None:
            cambios["costo_inactividad_minuto"] = costo_inactividad_minuto

        try:
            antes = await fetch_one(
                "SELECT sla_horas, costo_inactividad_minuto FROM maquina WHERE maquina_id = %(m)s",
                {"m": maquina["maquina_id"]},
            )
        except Exception:  # noqa: BLE001 — una tool no debe tumbar el grafo
            logger.exception(
                "Tool actualizar_parametros_maquina: fallo leyendo %r (empresa %s)",
                maquina.get("nombre"),
                empresa_id,
            )
            return "No pude leer los valores actuales de la máquina. Intenta de nuevo."

        return _texto_propuesta_parametros(maquina, antes, cambios)

    @tool("proponer_planta_completa")
    async def proponer_planta_completa(
        nombre: str,
        maquinas: list[_MaquinaPlanta] | None = None,
        ubicacion: str | None = None,
    ) -> str:
        """Propone crear una planta nueva con sus máquinas y le pide confirmación al
        usuario.

        NO crea nada: la planta se crea solo si el usuario responde que sí. Úsala cuando
        el usuario pida crear una planta o dar de alta un conjunto de equipos. Si corrige
        un dato, vuelve a llamarla con los datos corregidos.

        Args:
            nombre: Nombre de la planta (2 a 120 caracteres).
            maquinas: Equipos a crear. Máximo 15 por alta.
            ubicacion: Comuna o dirección. Obligatoria y única: no puede repetir la
                ubicación de otra planta de la empresa.
        """
        if not _puede_gestionar(rol):
            return PERMISO_DENEGADO

        nombre_limpio = " ".join((nombre or "").split())
        if len(nombre_limpio) < 2:
            return "Necesito un nombre de planta de al menos 2 caracteres."

        # Ubicación obligatoria y única (QA del 05-11 en prod: «Puente Alto» quedó sin
        # ubicación, y luego dos plantas se quisieron crear en la misma comuna). El
        # schema del endpoint la sigue dejando opcional; acá la exigimos para que el
        # «sí» del usuario siempre nazca con la planta bien catalogada. La regla
        # autoritativa en el service/BD queda como propuesta al equipo (HU-20).
        ubicacion_limpia = " ".join((ubicacion or "").split())
        if len(ubicacion_limpia) < 2:
            return "Necesito la ubicación de la planta (comuna o dirección) antes de proponer el alta."

        # La ubicación la da el USUARIO, no el modelo (QA 07-11: el chat inventó una
        # ubicación para rellenar el hueco). Se verifica contra lo que dijeron los
        # usuarios en la conversación; si no está ahí, no se propone nada y el turno
        # vuelve al modelo para que pregunte. `habla_del_usuario` vacío (tests y
        # flujos sin historial) no aplica el chequeo.
        frases = [_normalizar(f) for f in (habla_del_usuario or []) if f]
        if frases and not any(_normalizar(ubicacion_limpia) in f for f in frases):
            return (
                f"La ubicación «{_sin_separadores(ubicacion_limpia)}» no la dijiste tú en la conversación "
                "y no la invento. Pregúntale al usuario en qué comuna o dirección va la planta "
                "y vuelve a llamar esta herramienta con ESE dato literal."
            )

        repetida = await fetch_one(
            "SELECT nombre FROM planta WHERE empresa_id = %(e)s AND lower(ubicacion) = lower(%(u)s)",
            {"e": empresa_id, "u": ubicacion_limpia},
        )
        if repetida:
            return (
                f"La ubicación «{ubicacion_limpia}» ya la tiene la planta «{repetida['nombre']}»: "
                "no se permiten dos plantas en la misma ubicación. Cambia la ubicación, o el alta va por el mantenedor."
            )

        equipos = [m.model_dump() for m in (maquinas or [])]
        if len(equipos) > _MAX_MAQUINAS_ALTA:
            return (
                f"Son {len(equipos)} máquinas y el máximo por alta es {_MAX_MAQUINAS_ALTA}. "
                "Cárgalas en tandas o desde el mantenedor."
            )

        # Códigos repetidos dentro de la propia lista: el 409 los detectaría recién al
        # insertar, después de que el usuario ya confirmó, y el mensaje sería peor.
        vistos: set[str] = set()
        for m in equipos:
            codigo = str(m.get("codigo") or "").strip().lower()
            if not codigo:
                return "Cada máquina necesita un código."
            if codigo in vistos:
                return f"Hay un código repetido en la lista: «{m.get('codigo')}»."
            vistos.add(codigo)

        # Disciplinas simples (QA del 05-11: «Neumática / Mecánica» creó disciplinas
        # basura en el catálogo). Una máquina pertenece a UNA disciplina; el equipo
        # secundario se menciona en el nombre, no en el catálogo.
        compuestas = [
            str(m["disciplina"]).strip()
            for m in equipos
            if m.get("disciplina") and ("/" in str(m["disciplina"]) or "," in str(m["disciplina"]) or ";" in str(m["disciplina"]))
        ]
        if compuestas:
            ejemplo = ", ".join(sorted(set(compuestas))[:3])
            return (
                "La disciplina debe ser UNA sola (Mecánica, Eléctrica, Neumática, Hidráulica…); "
                f"no acepto compuestas como «{ejemplo}». "
                "Ponle la principal a cada máquina y menciona la otra en el nombre."
            )

        return _texto_propuesta_planta(nombre_limpio, ubicacion_limpia, equipos)

    @tool("proponer_aviso_falla")
    async def proponer_aviso_falla(
        nombre_maquina: str,
        descripcion: str,
        severidad: str = "media",
    ) -> str:
        """Registra la propuesta de un aviso de falla y le pide confirmación al usuario.

        NO registra nada: el aviso se crea solo si el usuario responde que sí. Úsala
        cuando alguien en planta reporta una falla («esta máquina se está defectando»,
        «reporta esta falla») y quiere que quede en el sistema para el supervisor. El
        aviso NO es una orden de trabajo: el supervisor decidirá si se genera la OT.

        Args:
            nombre_maquina: Nombre o código del equipo con la falla ("Compressor A1").
                Se admite coincidencia parcial.
            descripcion: Qué pasa y desde cuándo; la nota que leerá el supervisor
                (es literal, no la reformules ni resumas).
            severidad: baja, media, alta o crítica (por defecto, media).
        """
        try:
            puede = puede_ejecutar_accion(rol or "", "reportar_falla")
        except Exception:  # noqa: BLE001 — una tool no debe tumbar el grafo
            puede = False
        if not puede:
            return _mensaje_sin_permiso("reportar_falla")

        desc = " ".join((descripcion or "").split())
        if len(desc) < 10:
            return "Necesito una descripción concreta de la falla (mínimo 10 caracteres): qué pasa, dónde y desde cuándo."
        if len(desc) > 2000:
            return "La descripción es demasiado larga para el chat (máximo 2000); resumela y lo propongo."

        consulta = (nombre_maquina or "").strip()
        if not consulta:
            return "Necesito el nombre o el código de la máquina con la falla."

        sev, reconocida = _normalizar_severidad(severidad)
        if not reconocida:
            return f"La severidad «{severidad}» no la reconocí: usa baja, media, alta o crítica."

        maquina, error = await _resolver_maquina(empresa_id, consulta, "registro una falla")
        if error:
            return error

        return _texto_propuesta_aviso(maquina, desc, sev)

    return [
        consultar_ots_maquina,
        proponer_ot,
        listar_maquinas_planta,
        actualizar_parametros_maquina,
        proponer_planta_completa,
        proponer_aviso_falla,
    ]
