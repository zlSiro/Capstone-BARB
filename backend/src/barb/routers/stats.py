from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from barb.core.config import settings
from barb.core.db import pool
from barb.core.permissions import get_sesion_actual, require_route, resolver_empresa

logger = logging.getLogger("barb.stats")

router = APIRouter()


@router.get("/api/stats/financial-impact", dependencies=[Depends(require_route("dashboard", solo_lectura=True))])
async def get_financial_impact(
    days: int | None = Query(default=None, ge=1),
    empresa_id: int | None = Query(default=None),
    sesion: dict = Depends(get_sesion_actual),
):
    date_filter = "AND ot.fecha_creacion >= NOW() - (%(days)s || ' days')::interval" if days else ""
    params: dict = {"days": days} if days else {}

    # Multi-empresa: las métricas solo consideran OTs/máquinas de la empresa del usuario
    # (OT -> maquina -> planta -> empresa). NULL = todas (solo super_usuario).
    params["empresa_id"] = resolver_empresa(sesion, empresa_id)
    ot_scope = """AND ot.maquina_id IN (
        SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id
        WHERE (%(empresa_id)s::int IS NULL OR p2.empresa_id = %(empresa_id)s))"""

    sla_target = settings.sla_target_minutes
    downtime_cost = settings.downtime_cost_per_minute

    financials_query = f"""
        SELECT
            COALESCE(AVG(ot.tiempo_reparacion_min) FILTER (WHERE ot.estado = 'completed'), 0) AS mttr,
            COALESCE(SUM(ot.costo_real), 0) AS costo_total_acumulado,
            COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.estado = 'completed'), 0) AS downtime_evitado_min,
            COUNT(*) FILTER (WHERE ot.estado = 'completed') AS total_completadas,
            COUNT(*) FILTER (
                WHERE ot.estado = 'completed' AND ot.tiempo_reparacion_min <= {sla_target}
            ) AS completadas_en_sla,
            COUNT(*) AS total_ots
        FROM orden_trabajo ot
        WHERE 1=1 {date_filter} {ot_scope}
        """

    trend_query = f"""
        SELECT
            d::date AS date,
            COUNT(*) FILTER (WHERE ot.fecha_creacion::date = d::date) AS abiertas,
            COUNT(*) FILTER (WHERE ot.fecha_cierre::date = d::date) AS cerradas
        FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') d
        LEFT JOIN orden_trabajo ot
            ON (ot.fecha_creacion::date = d::date OR ot.fecha_cierre::date = d::date)
            {ot_scope}
        GROUP BY d
        ORDER BY d
        """

    machines_query = f"""
        SELECT
            m.maquina_id AS id,
            m.nombre AS name,
            COUNT(ot.ot_id) AS total,
            COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.estado = 'completed'), 0) AS downtime_evitado_min,
            COALESCE(AVG(ot.tiempo_reparacion_min) FILTER (WHERE ot.estado = 'completed'), 0) AS mttr,
            COALESCE(
                100.0 * COUNT(*) FILTER (WHERE ot.estado = 'completed' AND ot.tiempo_reparacion_min <= {sla_target})
                / NULLIF(COUNT(*) FILTER (WHERE ot.estado = 'completed'), 0),
                0
            ) AS sla_compliance
        FROM maquina m
        JOIN planta pl ON pl.planta_id = m.planta_id
        LEFT JOIN orden_trabajo ot ON ot.maquina_id = m.maquina_id {date_filter}
        WHERE (%(empresa_id)s::int IS NULL OR pl.empresa_id = %(empresa_id)s)
        GROUP BY m.maquina_id, m.nombre
        ORDER BY total DESC
        LIMIT 5
        """

    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(financials_query, params)
                f = await cur.fetchone()

                await cur.execute(trend_query, {"empresa_id": params["empresa_id"]})
                trend_rows = await cur.fetchall()

                await cur.execute(machines_query, params)
                machine_rows = await cur.fetchall()

        mttr = float(f["mttr"])
        costo_total = float(f["costo_total_acumulado"])
        downtime_evitado = float(f["downtime_evitado_min"])
        total_completadas = int(f["total_completadas"])
        completadas_en_sla = int(f["completadas_en_sla"])

        ahorro_generado = downtime_evitado * downtime_cost
        efficiency = round(100.0 * completadas_en_sla / total_completadas, 1) if total_completadas > 0 else 0.0
        mtbf_hours = None
        if total_completadas >= 2:
            window_hours = (days * 24) if days else 24 * 365
            mtbf_hours = round(window_hours / total_completadas, 1)

        return {
            "financials": {
                "ahorro_generado": round(ahorro_generado, 2),
                "mttr": round(mttr, 1),
                "efficiency": efficiency,
                "costo_total_acumulado": round(costo_total, 2),
                "mtbfHours": mtbf_hours,
            },
            "trend14Days": [
                {"date": row["date"].isoformat(), "abiertas": int(row["abiertas"]), "cerradas": int(row["cerradas"])}
                for row in trend_rows
            ],
            "machines": [
                {
                    "id": str(row["id"]),
                    "name": row["name"],
                    "total": int(row["total"]),
                    "ahorroGenerado": round(float(row["downtime_evitado_min"]) * downtime_cost, 2),
                    "mttr": round(float(row["mttr"]), 1),
                    "slaCompliance": round(float(row["sla_compliance"]), 1),
                }
                for row in machine_rows
            ],
        }
    except Exception:
        logger.exception("Error calculando stats financieras")
        return {
            "financials": {
                "ahorro_generado": 0.0,
                "mttr": 0.0,
                "efficiency": 0.0,
                "costo_total_acumulado": 0.0,
                "mtbfHours": None,
            },
            "trend14Days": [],
            "machines": [],
        }
