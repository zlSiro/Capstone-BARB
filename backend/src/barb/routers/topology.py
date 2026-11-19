from __future__ import annotations

import logging
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg_pool import PoolTimeout

from barb.core.db import fetch_all
from barb.core.permissions import get_sesion_actual, require_route, resolver_empresa

# Se reutiliza el contrato de OTs en vez de inventar uno paralelo (CGBIDA-379).
from barb.routers.work_orders import _EMPRESA_FILTER, _WORK_ORDER_SELECT, _alcance_propio, row_to_work_order

logger = logging.getLogger("barb.topology")

router = APIRouter()

# Prefijo del `nodo_id` -> tipo de nodo. El contrato los emite en español.
TIPO_POR_PREFIJO = {"p": "Planta", "d": "Disciplina", "m": "Máquina"}


async def _cargar_grafo(scope: dict[str, Any]) -> dict[str, list[dict]]:
    """Construye el grafo de topología (nodos y conexiones) para el alcance de empresa dado.

    Única fuente del layout sintético: `pos_x`/`pos_y` se calculan aquí. El endpoint de
    detalle por nodo reutiliza este resultado para que las coordenadas de un nodo sean
    idénticas a las que muestra el mapa.
    """
    filtro = "(%(empresa_id)s::int IS NULL OR empresa_id = %(empresa_id)s)"
    plantas = await fetch_all(f"SELECT planta_id, nombre FROM planta WHERE {filtro} ORDER BY planta_id", scope)
    disciplinas = await fetch_all(
        f"SELECT disciplina_id, nombre FROM disciplina WHERE {filtro} ORDER BY disciplina_id", scope
    )
    maquinas = await fetch_all(
        """
        SELECT m.maquina_id, m.nombre, m.planta_id, m.disciplina_id
        FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
        WHERE (%(empresa_id)s::int IS NULL OR p.empresa_id = %(empresa_id)s)
        ORDER BY m.maquina_id
        """,
        scope,
    )

    machine_status_rows = await fetch_all(
        """
        SELECT
            maquina_id,
            BOOL_OR(estado NOT IN ('completed', 'cancelled') AND (priority = 'urgent' OR estado = 'overdue')) AS tiene_falla,
            BOOL_OR(estado NOT IN ('completed', 'cancelled')) AS tiene_alerta
        FROM orden_trabajo
        WHERE maquina_id = ANY(%(maquinas)s)
        GROUP BY maquina_id
        """,
        {"maquinas": [m["maquina_id"] for m in maquinas]},
    )
    machine_status = {}
    for row in machine_status_rows:
        if row["tiene_falla"]:
            machine_status[row["maquina_id"]] = "falla"
        elif row["tiene_alerta"]:
            machine_status[row["maquina_id"]] = "alerta"
        else:
            machine_status[row["maquina_id"]] = "operativo"

    nodos: list[dict] = []
    conexiones: list[dict] = []

    # --- Jerarquía estricta por planta (Opción 1) ------------------------------
    # Reglas de visualización:
    #   A-2: una planta sin máquinas no se dibuja (sugeriría actividad inexistente).
    #   A-3: jerarquía estricta árbol Planta -> Disciplina -> Máquina.
    #        Las disciplinas se instancian por planta (nodo `d_{planta_id}_{disciplina_id}`)
    #        para que cada rama del árbol sea independiente y no contamine el conteo ni
    #        el resaltado de máquinas entre plantas.
    ids_planta_visibles = {m["planta_id"] for m in maquinas}
    disciplina_por_id = {d["disciplina_id"]: d for d in disciplinas}

    current_x = 100
    STEP_MAQUINA = 200
    GAP_ENTRE_PLANTAS = 160

    plantas_nodos: list[dict] = []
    disciplinas_nodos: list[dict] = []
    maquinas_nodos: list[dict] = []

    for p in plantas:
        planta_id = p["planta_id"]
        if planta_id not in ids_planta_visibles:
            continue  # A-2: planta sin máquinas, no se dibuja

        maquinas_planta = [m for m in maquinas if m["planta_id"] == planta_id]
        # Disciplinas presentes en esta planta, en el orden del catálogo
        disciplinas_planta_ids = [
            d["disciplina_id"]
            for d in disciplinas
            if any(m.get("disciplina_id") == d["disciplina_id"] for m in maquinas_planta)
        ]

        pos_x_disciplinas_planta: list[int] = []

        for disc_id in disciplinas_planta_ids:
            d_info = disciplina_por_id.get(disc_id, {"nombre": f"Disciplina {disc_id}"})
            maquinas_disc = [m for m in maquinas_planta if m.get("disciplina_id") == disc_id]
            pos_x_maquinas: list[int] = []

            for m in maquinas_disc:
                m_id = m["maquina_id"]
                m_nodo_id = f"m_{m_id}"
                m_x = current_x
                pos_x_maquinas.append(m_x)
                maquinas_nodos.append({
                    "nodo_id": m_nodo_id,
                    "maquina_id": m_id,
                    "nombre_visual": m["nombre"],
                    "tipo": "Máquina",
                    "icono": "🤖",
                    "pos_x": m_x,
                    "pos_y": 500,
                    "estado_actual": machine_status.get(m_id, "operativo"),
                })
                current_x += STEP_MAQUINA

            disc_nodo_id = f"d_{planta_id}_{disc_id}"
            disc_x = round(sum(pos_x_maquinas) / len(pos_x_maquinas)) if pos_x_maquinas else current_x
            pos_x_disciplinas_planta.append(disc_x)

            disciplinas_nodos.append({
                "nodo_id": disc_nodo_id,
                "nombre_visual": d_info["nombre"],
                "tipo": "Disciplina",
                "icono": "⚙️",
                "pos_x": disc_x,
                "pos_y": 300,
                "estado_actual": "operativo",
            })

            # Conexión jerarquía Planta -> Disciplina
            conexiones.append({
                "conexion_id": f"conn_p{planta_id}_{disc_nodo_id}",
                "origen_nodo_id": f"p_{planta_id}",
                "destino_nodo_id": disc_nodo_id,
                "tipo_relacion": "jerarquia",
            })

            # Conexiones pertenece Disciplina -> Máquinas
            for m in maquinas_disc:
                conexiones.append({
                    "conexion_id": f"conn_{disc_nodo_id}_m{m['maquina_id']}",
                    "origen_nodo_id": disc_nodo_id,
                    "destino_nodo_id": f"m_{m['maquina_id']}",
                    "tipo_relacion": "pertenece",
                })

        # Máquinas sin disciplina en esta planta (si las hubiera)
        maquinas_sin_disc = [m for m in maquinas_planta if not m.get("disciplina_id")]
        for m in maquinas_sin_disc:
            m_id = m["maquina_id"]
            m_nodo_id = f"m_{m_id}"
            m_x = current_x
            pos_x_disciplinas_planta.append(m_x)
            maquinas_nodos.append({
                "nodo_id": m_nodo_id,
                "maquina_id": m_id,
                "nombre_visual": m["nombre"],
                "tipo": "Máquina",
                "icono": "🤖",
                "pos_x": m_x,
                "pos_y": 500,
                "estado_actual": machine_status.get(m_id, "operativo"),
            })
            conexiones.append({
                "conexion_id": f"conn_p{planta_id}_{m_nodo_id}",
                "origen_nodo_id": f"p_{planta_id}",
                "destino_nodo_id": m_nodo_id,
                "tipo_relacion": "pertenece",
            })
            current_x += STEP_MAQUINA

        planta_x = (
            round(sum(pos_x_disciplinas_planta) / len(pos_x_disciplinas_planta))
            if pos_x_disciplinas_planta
            else current_x
        )
        plantas_nodos.append({
            "nodo_id": f"p_{planta_id}",
            "nombre_visual": p["nombre"],
            "tipo": "Planta",
            "icono": "🏭",
            "pos_x": planta_x,
            "pos_y": 100,
            "estado_actual": "operativo",
        })

        current_x += GAP_ENTRE_PLANTAS

    nodos = plantas_nodos + disciplinas_nodos + maquinas_nodos
    return {"nodos": nodos, "conexiones": conexiones}


def _hijos_de(nodo_id: str, grafo: dict[str, list[dict]]) -> list[dict]:
    """Nodos directamente contenidos por `nodo_id`, según las aristas del grafo.

    Planta -> disciplinas · Disciplina -> máquinas · Máquina -> nada.
    Se apoya en las aristas en vez de recalcular el árbol, para no duplicar las reglas A-2/A-3.
    """
    ids = {n["nodo_id"] for n in grafo["nodos"]}
    destinos = [
        c["destino_nodo_id"]
        for c in grafo["conexiones"]
        if c["origen_nodo_id"] == nodo_id and c["destino_nodo_id"] in ids
    ]
    return [n for n in grafo["nodos"] if n["nodo_id"] in destinos]


@router.get("/api/topologia", dependencies=[Depends(require_route("topology", solo_lectura=True))])
@router.get("/api/topology", dependencies=[Depends(require_route("topology", solo_lectura=True))])
async def get_topologia(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    """Mapa completo: plantas, disciplinas y máquinas de la empresa del usuario."""
    # Multi-empresa: solo plantas, disciplinas y máquinas de la empresa del usuario
    # (NULL = todas, exclusivo del super_usuario).
    scope = {"empresa_id": resolver_empresa(sesion, empresa_id)}
    try:
        return await _cargar_grafo(scope)
    except HTTPException:
        # Errores deliberados (permisos, validación) no se enmascaran como fallo de BD.
        raise
    except (psycopg.OperationalError, PoolTimeout) as e:
        # Dependencia caída o inalcanzable: no se pudo consultar la base.
        logger.warning("Topología: base de datos inalcanzable: %s", e)
        raise HTTPException(
            status_code=503,
            detail="No se pudo consultar la topología: la base de datos no está disponible.",
        ) from e
    except Exception as e:
        # Cualquier otro fallo inesperado se propaga como 500.
        logger.exception("Error generando topología automática")
        raise HTTPException(
            status_code=500,
            detail="Error interno al generar la topología.",
        ) from e


@router.get("/api/topologia/{nodo_id}", dependencies=[Depends(require_route("topology", solo_lectura=True))])
@router.get("/api/topology/{nodo_id}", dependencies=[Depends(require_route("topology", solo_lectura=True))])
async def get_nodo_topologia(
    nodo_id: str,
    empresa_id: int | None = Query(default=None),
    sesion: dict = Depends(get_sesion_actual),
):
    """Un nodo del mapa con su contenido: órdenes de trabajo (si es máquina) e hijos.

    CGBIDA-379. Decisión D2/D3/D4 en `CGBIDA-378_decisiones-tecnicas.md`:
    - Ruta nueva en vez de ampliar `/api/work-orders`, para no reabrir la superficie de HU-09.
    - Los hijos se derivan de las aristas del grafo, no de una consulta aparte.
    - Permiso `require_route("topology", solo_lectura=True)`: quien ve el mapa ve su contenido.
    """
    scope = resolver_empresa(sesion, empresa_id)
    try:
        grafo = await _cargar_grafo({"empresa_id": scope})
        nodo = next((n for n in grafo["nodos"] if n["nodo_id"] == nodo_id), None)
        if nodo is None:
            # No existe, o existe en otra empresa: en ambos casos 404, sin revelar cuál.
            raise HTTPException(status_code=404, detail="Nodo de topología no encontrado.")

        ordenes: list[dict] = []
        if nodo["tipo"] == "Máquina":
            alcance, alcance_params = _alcance_propio(sesion)
            filas = await fetch_all(
                f"{_WORK_ORDER_SELECT} WHERE ot.maquina_id = %(maquina_id)s AND {_EMPRESA_FILTER} AND {alcance} "
                "ORDER BY ot.fecha_creacion DESC, ot.ot_id DESC",
                {"maquina_id": nodo["maquina_id"], "empresa_id": scope, **alcance_params},
            )
            ordenes = [row_to_work_order(f, rol=sesion["rol"], usuario_id=sesion["usuario_id"]) for f in filas]

        return {"nodo": nodo, "ordenes": ordenes, "hijos": _hijos_de(nodo_id, grafo)}

    except HTTPException:
        raise
    except (psycopg.OperationalError, PoolTimeout) as e:
        logger.warning("Topología: base de datos inalcanzable: %s", e)
        raise HTTPException(
            status_code=503,
            detail="No se pudo consultar el nodo: la base de datos no está disponible.",
        ) from e
    except Exception as e:
        logger.exception("Error generando el detalle del nodo de topología")
        raise HTTPException(
            status_code=500,
            detail="Error interno al generar el detalle del nodo.",
        ) from e
