from __future__ import annotations

import logging

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg_pool import PoolTimeout

from barb.core.db import fetch_all
from barb.core.permissions import get_sesion_actual, require_route, resolver_empresa

logger = logging.getLogger("barb.topology")

router = APIRouter()


@router.get("/api/topologia", dependencies=[Depends(require_route("topology", solo_lectura=True))])
@router.get("/api/topology", dependencies=[Depends(require_route("topology", solo_lectura=True))])
async def get_topologia(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    # Multi-empresa: solo plantas, disciplinas y máquinas de la empresa del usuario
    # (NULL = todas, exclusivo del super_usuario).
    scope = {"empresa_id": resolver_empresa(sesion, empresa_id)}
    try:
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

        nodos = []
        conexiones = []

        # --- A-2 / A-3 (CGBIDA-355): el mapa solo muestra actividad real ---------
        # Los nodos visibles se derivan de las MAQUINAS, no del catálogo completo:
        #   A-2: una planta sin máquinas no se dibuja (sugeriría actividad inexistente).
        #   A-3: una disciplina pertenece a la EMPRESA, no a una planta, así que se dibuja
        #        UNA vez y se conecta a cada planta donde tenga máquinas.
        # Una disciplina sin máquinas en las plantas visibles tampoco se dibuja: sería un
        # nodo huérfano, el mismo problema que A-2 evita en el nivel superior.
        ids_planta_visibles = {m["planta_id"] for m in maquinas}

        x_offset_planta = 500
        for p in plantas:
            if p["planta_id"] not in ids_planta_visibles:
                continue  # A-2: planta sin máquinas, no se dibuja
            nodos.append({
                "nodo_id": f"p_{p['planta_id']}",
                "nombre_visual": p["nombre"],
                "tipo": "Planta",
                "icono": "🏭",
                "pos_x": x_offset_planta,
                "pos_y": 100,
                "estado_actual": "operativo"
            })
            x_offset_planta += 300

        maquinas_por_disciplina: dict[int, list[dict]] = {}
        for m in maquinas:
            # `maquinas` ya viene acotada por empresa, así que toda planta aquí es visible.
            if m.get("disciplina_id"):
                maquinas_por_disciplina.setdefault(m["disciplina_id"], []).append(m)

        x_offset_disc = 200
        for d in disciplinas:
            disc_id = d["disciplina_id"]
            maquinas_disc = maquinas_por_disciplina.get(disc_id)
            if not maquinas_disc:
                continue  # sin máquinas en las plantas visibles: no se dibuja

            n_id = f"d_{disc_id}"
            nodos.append({
                "nodo_id": n_id,
                "nombre_visual": d["nombre"],
                "tipo": "Disciplina",
                "icono": "⚙️",
                "pos_x": x_offset_disc,
                "pos_y": 300,
                "estado_actual": "operativo"
            })
            # Una arista por cada planta donde esta disciplina tenga máquinas.
            for planta_id in sorted({m["planta_id"] for m in maquinas_disc}):
                conexiones.append({
                    "conexion_id": f"conn_p{planta_id}_{n_id}",
                    "origen_nodo_id": f"p_{planta_id}",
                    "destino_nodo_id": n_id,
                    "tipo_relacion": "jerarquia"
                })
            x_offset_disc += 250

        x_offset_maq = 50
        for m in maquinas:
            n_id = f"m_{m['maquina_id']}"
            nodos.append({
                "nodo_id": n_id,
                "maquina_id": m["maquina_id"],
                "nombre_visual": m["nombre"],
                "tipo": "Máquina",
                "icono": "🤖",
                "pos_x": x_offset_maq,
                "pos_y": 500,
                "estado_actual": machine_status.get(m["maquina_id"], "operativo")
            })
            if m.get("disciplina_id"):
                conexiones.append({
                    "conexion_id": f"conn_d{m['disciplina_id']}_{n_id}",
                    "origen_nodo_id": f"d_{m['disciplina_id']}",
                    "destino_nodo_id": n_id,
                    "tipo_relacion": "pertenece"
                })
            x_offset_maq += 180

        return {"nodos": nodos, "conexiones": conexiones}

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
