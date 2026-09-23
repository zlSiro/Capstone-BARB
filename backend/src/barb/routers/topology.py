from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from barb.core.db import fetch_all
from barb.core.permissions import require_route

logger = logging.getLogger("barb.topology")

router = APIRouter()


@router.get("/api/topologia", dependencies=[Depends(require_route("topology", solo_lectura=True))])
@router.get("/api/topology", dependencies=[Depends(require_route("topology", solo_lectura=True))])
async def get_topologia():
    try:
        plantas = await fetch_all("SELECT planta_id, nombre FROM planta")
        disciplinas = await fetch_all("SELECT disciplina_id, nombre FROM disciplina")
        maquinas = await fetch_all("SELECT maquina_id, nombre, planta_id, disciplina_id FROM maquina")

        machine_status_rows = await fetch_all(
            """
            SELECT
                maquina_id,
                BOOL_OR(estado NOT IN ('completed', 'cancelled') AND (priority = 'urgent' OR estado = 'overdue')) AS tiene_falla,
                BOOL_OR(estado NOT IN ('completed', 'cancelled')) AS tiene_alerta
            FROM orden_trabajo
            GROUP BY maquina_id
            """
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

        x_offset_planta = 500
        for p in plantas:
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

        x_offset_disc = 200
        for d in disciplinas:
            n_id = f"d_{d['disciplina_id']}"
            nodos.append({
                "nodo_id": n_id,
                "nombre_visual": d["nombre"],
                "tipo": "Disciplina",
                "icono": "⚙️",
                "pos_x": x_offset_disc,
                "pos_y": 300,
                "estado_actual": "operativo"
            })
            if plantas:
                conexiones.append({
                    "conexion_id": f"conn_p{plantas[0]['planta_id']}_{n_id}",
                    "origen_nodo_id": f"p_{plantas[0]['planta_id']}",
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

    except Exception:
        logger.exception("Error generando topología automática")
        return {"nodos": [], "conexiones": []}
