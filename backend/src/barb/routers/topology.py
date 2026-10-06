from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

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
