from __future__ import annotations

import logging

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg_pool import PoolTimeout

from barb.core.config import settings
from barb.core.db import pool
from barb.core.permissions import get_sesion_actual, require_route, resolver_empresa

logger = logging.getLogger("barb.stats")

router = APIRouter()

# ---------------------------------------------------------------------------
# MTBF (CGBIDA-404, HU B / CGBIDA-51)
# ---------------------------------------------------------------------------
# El MTBF es una métrica de fiabilidad de LARGO PLAZO: sobre 7 días con una o dos
# fallas es ruido estadístico. Por eso su ventana es SIEMPRE de 365 días y NO lee
# el parámetro `days` del selector temporal.
#
# Para no mostrar un número calculado sobre una ventana distinta a la que el usuario
# eligió, el endpoint devuelve `mtbf_visible`: es `False` cuando el rango pedido es
# menor a un año, y en ese caso ni se calcula (se ahorra la consulta).
MTBF_VENTANA_HORAS = 365 * 24  # 8760
MTBF_VENTANA_DIAS = 365
# Con menos de dos fallas el promedio no es significativo (mismo criterio que el legacy).
MTBF_FALLAS_MINIMAS = 2


def _mtbf_visible(days: int | None) -> bool:
    """El MTBF solo se muestra si el rango pedido justifica una ventana de un año.

    `days=None` = histórico completo, así que es visible. Menos de 365 días, no.
    """
    return days is None or days >= MTBF_VENTANA_DIAS


# ---------------------------------------------------------------------------
# Órdenes estancadas (CGBIDA-396, HU-16)
# ---------------------------------------------------------------------------
# Una OT se considera estancada si cumple CUALQUIERA de estas dos condiciones:
#
#   1. VENCIDA    : tiene `fecha_vencimiento` en el pasado y su estado NO es final
#                   (no está completada ni cancelada).
#   2. DEMORADA   : está `in_progress` hace más de UMBRAL_ESTANCADA_DIAS días. Se mide
#                   desde `fecha_inicio` y, si está vacía, desde `fecha_creacion`.
#
# Las dos condiciones pueden solaparse: una OT vencida que además lleva días en curso
# cuenta una sola vez en `total`, pero aparece en los dos desgloses. Por eso
# `vencidas + demoradas` puede ser mayor que `total`; no es un error.
#
# A diferencia del resto de los indicadores, esta cifra NO lee el selector de rango:
# responde a "qué está trabado AHORA", que es una foto del estado actual y no una
# métrica del período elegido. Sí respeta el filtro por empresa, como todo el endpoint.
#
# TODO(CGBIDA-396): el umbral está fijo en 7 días por definición del equipo. Cuando el
# cliente lo confirme, moverlo a `settings` (core/config.py) para poder configurarlo por
# empresa sin tocar el código.
UMBRAL_ESTANCADA_DIAS = 7

# Estados en los que la OT ya no requiere trabajo: no puede estar estancada.
ESTADOS_FINALES_OT = ("completed", "cancelled")


# ---------------------------------------------------------------------------
# Impacto Anual Proyectado (CGBIDA-406, HU B / CGBIDA-51)
# ---------------------------------------------------------------------------
# Compara dos escenarios sobre los incidentes REALES del período:
#   sin BARB -> los incidentes tardan `impact_without_barb_minutes` (supuesto de negocio)
#   con BARB -> los incidentes tardan el tiempo REAL medido en las OTs
# El ahorro es la diferencia. Si el tiempo real supera el supuesto, el ahorro sale
# NEGATIVO: es información real (el tiempo actual supera el objetivo del modelo), no
# un error, así que NO se recorta a cero.
#
# Este KPI mide SIEMPRE un año, aunque el selector diga "Histórico": cuando no se pide
# un rango, la consulta se acota a los últimos 365 días. Si no, el numerador contaría
# todo el historial y se rotularía como anual.
IMPACTO_DIAS_MINIMOS = 90
IMPACTO_VENTANA_DIAS = 365


def _impacto_visible(days: int | None) -> bool:
    """El impacto anual solo se muestra si el período elegido es representativo.

    Con rangos cortos la extrapolación ×365/dias es ruido, igual que en el MTBF.
    """
    return days is None or days >= IMPACTO_DIAS_MINIMOS


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
    impact_without_barb_minutes = settings.impact_without_barb_minutes

    financials_query = f"""
        SELECT
            COALESCE(AVG(ot.tiempo_reparacion_min) FILTER (WHERE ot.estado = 'completed'), 0) AS mttr,
            -- Costo Directo: las canceladas NO suman (CGBIDA-407). Una OT cancelada
            -- significa que el trabajo no se hizo, así que no hay costo real que sumar.
            -- Matiz conocido: si se canceló DESPUÉS de generar un costo parcial, ese
            -- costo queda huérfano. La salida correcta es marcarla `completed` con nota.
            COALESCE(SUM(ot.costo_real) FILTER (WHERE ot.estado != 'cancelled'), 0) AS costo_total_acumulado,
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

    # Órdenes estancadas (CGBIDA-396). Ver el comentario de UMBRAL_ESTANCADA_DIAS.
    #
    # Se cuentan en una subconsulta para no repetir la expresion de cada condicion ni
    # contar dos veces la OT que cumple las dos. SIN `date_filter` a proposito: es una
    # foto del estado actual, no una metrica del rango elegido.
    estancadas_query = f"""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE vencida) AS vencidas,
            COUNT(*) FILTER (WHERE demorada) AS demoradas
        FROM (
            SELECT
                (
                    ot.fecha_vencimiento IS NOT NULL
                    AND ot.fecha_vencimiento < NOW()
                    AND ot.estado::text NOT IN {ESTADOS_FINALES_OT}
                ) AS vencida,
                (
                    ot.estado = 'in_progress'
                    AND COALESCE(ot.fecha_inicio, ot.fecha_creacion)
                        < NOW() - INTERVAL '{UMBRAL_ESTANCADA_DIAS} days'
                ) AS demorada
            FROM orden_trabajo ot
            WHERE 1=1 {ot_scope}
        ) t
        WHERE vencida OR demorada
        """

    # Distribución por tipo de intervención (CGBIDA-395).
    #
    # Reemplaza la dona del legacy (`Dashboard.tsx:217-224`), que la calculaba en el
    # cliente sobre las OTs ya descargadas. Acá se agrega en el servidor: el dashboard ya
    # hace una sola llamada, y traer las OTs solo para contarlas por tipo sería peor.
    #
    # Se respeta el rango temporal (`date_filter`) porque el legacy también lo respetaba:
    # su dona usaba el arreglo ya filtrado por el selector. Ordena por volumen descendente
    # para que el orden de los segmentos sea estable y no dependa del plan de la consulta.
    por_tipo_query = f"""
        SELECT
            ot.tipo::text AS tipo,
            COUNT(*) AS total
        FROM orden_trabajo ot
        WHERE 1=1 {date_filter} {ot_scope}
        GROUP BY ot.tipo
        ORDER BY total DESC, tipo ASC
        """

    # MTBF: cuenta las fallas (OTs correctivas no canceladas) y su inactividad, en los
    # últimos 365 días. SIN `date_filter`: la ventana es fija y NO depende del selector.
    #
    # El conteo y la inactividad miran LA MISMA población (correctivas no canceladas).
    # Antes el `WHERE` no filtraba nada: el divisor incluía canceladas y el `SUM` sumaba
    # la inactividad de TODAS las órdenes, así que numerador y denominador medían
    # universos distintos. Se detectó al ampliar el seed a 24 meses (CGBIDA-408).
    # Excluir canceladas es coherente con CGBIDA-407: si el trabajo no se hizo, esa
    # orden no es una falla.
    mtbf_query = f"""
        SELECT
            COUNT(*) FILTER (WHERE ot.tipo = 'corrective') AS fallas,
            COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.tipo = 'corrective'), 0) AS downtime_min
        FROM orden_trabajo ot
        WHERE ot.tipo = 'corrective'
          AND ot.estado != 'cancelled'
          AND ot.fecha_creacion >= NOW() - INTERVAL '{MTBF_VENTANA_DIAS} days' {ot_scope}
        """

    # Impacto Anual Proyectado. El filtro de fecha propio garantiza que el numerador
    # (incidentes) y el `dias_periodo` hablen del MISMO período: con `days=None` se
    # acota a 365 días en vez de contar todo el historial.
    if days is not None:
        impacto_fecha = "AND ot.fecha_creacion >= NOW() - (%(days)s || ' days')::interval"
        dias_periodo = days
    else:
        impacto_fecha = f"AND ot.fecha_creacion >= NOW() - INTERVAL '{IMPACTO_VENTANA_DIAS} days'"
        dias_periodo = IMPACTO_VENTANA_DIAS

    # Un incidente es una OT correctiva que NO se canceló: si el trabajo no se hizo,
    # no es un incidente real (mismo criterio que CGBIDA-407 para el costo).
    # El conteo y el promedio usan el MISMO conjunto: solo las que tienen tiempo
    # registrado. Si no hay tiempo, no se puede proyectar el impacto de ese incidente.
    impacto_query = f"""
        SELECT
            COUNT(*) FILTER (
                WHERE ot.tipo = 'corrective' AND ot.tiempo_reparacion_min IS NOT NULL
            ) AS incidentes_periodo,
            AVG(ot.tiempo_reparacion_min) FILTER (WHERE ot.tipo = 'corrective') AS tiempo_promedio_real
        FROM orden_trabajo ot
        WHERE ot.tipo = 'corrective' AND ot.estado != 'cancelled' {impacto_fecha} {ot_scope}
        """

    try:
        visible = _mtbf_visible(days)
        impacto_visible = _impacto_visible(days)
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(financials_query, params)
                f = await cur.fetchone()

                await cur.execute(trend_query, {"empresa_id": params["empresa_id"]})
                trend_rows = await cur.fetchall()

                await cur.execute(machines_query, params)
                machine_rows = await cur.fetchall()

                await cur.execute(por_tipo_query, params)
                tipo_rows = await cur.fetchall()

                # Las estancadas no leen el rango: solo el filtro por empresa.
                await cur.execute(estancadas_query, {"empresa_id": params["empresa_id"]})
                estancadas_row = await cur.fetchone()

                # Si el rango no justifica un MTBF anual, ni se consulta.
                mtbf_row = None
                if visible:
                    await cur.execute(mtbf_query, params)
                    mtbf_row = await cur.fetchone()

                # Mismo criterio: con un rango corto no se consulta el impacto anual.
                impacto_row = None
                if impacto_visible:
                    await cur.execute(impacto_query, params)
                    impacto_row = await cur.fetchone()

        mttr = float(f["mttr"])
        costo_total = float(f["costo_total_acumulado"])
        downtime_evitado = float(f["downtime_evitado_min"])
        total_completadas = int(f["total_completadas"])
        completadas_en_sla = int(f["completadas_en_sla"])

        ahorro_generado = downtime_evitado * downtime_cost
        efficiency = round(100.0 * completadas_en_sla / total_completadas, 1) if total_completadas > 0 else 0.0

        # MTBF = tiempo de operación / número de fallas.
        #   uptime  = ventana anual - inactividad acumulada
        #   fallas  = OTs correctivas del período
        # Se devuelve None si no hay al menos dos fallas: un promedio sobre una sola no
        # es representativo (el legacy ya lo advertía en su subtítulo).
        mtbf_hours = None
        if mtbf_row is not None:
            fallas = int(mtbf_row["fallas"])
            if fallas >= MTBF_FALLAS_MINIMAS:
                uptime_horas = MTBF_VENTANA_HORAS - (float(mtbf_row["downtime_min"]) / 60.0)
                mtbf_hours = round(uptime_horas / fallas, 1)

        # --- Impacto Anual Proyectado (CGBIDA-406) ------------------------------
        # Los supuestos se devuelven SIEMPRE, incluso sin cifras, para que el frontend
        # pueda explicar el modelo aunque no lo muestre.
        supuestos = {
            "minutos_sin_barb": impact_without_barb_minutes,
            "costo_por_minuto": downtime_cost,
            "dias_periodo": dias_periodo,
        }
        impacto = {
            "escenario_sin_barb": None,
            "escenario_con_barb": None,
            "ahorro_proyectado": None,
            "incidentes_anuales": None,
            "impacto_visible": impacto_visible,
            "supuestos": supuestos,
            "supuestos_incompletos": False,
        }
        if impacto_row is not None:
            incidentes = int(impacto_row["incidentes_periodo"])
            tiempo_real = impacto_row["tiempo_promedio_real"]
            if incidentes > 0 and dias_periodo > 0:
                factor_anual = IMPACTO_VENTANA_DIAS / dias_periodo
                # Sin tiempos medidos se usa el mismo supuesto en ambos lados: el ahorro
                # sale 0 y el flag avisa de que falta el dato.
                incompletos = tiempo_real is None
                minutos_con_barb = float(tiempo_real) if tiempo_real is not None else impact_without_barb_minutes

                sin_barb = incidentes * factor_anual * impact_without_barb_minutes * downtime_cost
                con_barb = incidentes * factor_anual * minutos_con_barb * downtime_cost
                impacto.update({
                    "escenario_sin_barb": round(sin_barb, 2),
                    "escenario_con_barb": round(con_barb, 2),
                    "ahorro_proyectado": round(sin_barb - con_barb, 2),
                    "incidentes_anuales": round(incidentes * factor_anual, 2),
                    "supuestos_incompletos": incompletos,
                })

        return {
            "financials": {
                "ahorro_generado": round(ahorro_generado, 2),
                "mttr": round(mttr, 1),
                "efficiency": efficiency,
                "costo_total_acumulado": round(costo_total, 2),
                "mtbfHours": mtbf_hours,
                # El frontend decide con esto si muestra el valor o el aviso de que el
                # rango no alcanza para un MTBF (CGBIDA-392).
                "mtbf_visible": visible,
            },
            "impacto_anual": impacto,
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
            # Distribución por tipo de intervención para la dona (CGBIDA-395).
            # `tipo` es el valor del enum; el frontend lo traduce con su bloque i18n.
            "por_tipo": [
                {"tipo": row["tipo"], "total": int(row["total"])}
                for row in tipo_rows
            ],
            # Órdenes estancadas para el banner de alerta (CGBIDA-396).
            # `vencidas` y `demoradas` pueden solaparse, así que su suma puede superar
            # a `total`. `umbral_dias` viaja para que el frontend no repita el numero.
            "estancadas": {
                "total": int(estancadas_row["total"]),
                "vencidas": int(estancadas_row["vencidas"]),
                "demoradas": int(estancadas_row["demoradas"]),
                "umbral_dias": UMBRAL_ESTANCADA_DIAS,
            },
        }
    except HTTPException:
        # Errores deliberados (permisos, validación) no se enmascaran como fallo de BD.
        raise
    except (psycopg.OperationalError, PoolTimeout) as e:
        # Dependencia caída o inalcanzable: no se pudo consultar la base.
        logger.warning("Stats: base de datos inalcanzable: %s", e)
        raise HTTPException(
            status_code=503,
            detail="No se pudieron calcular las métricas: la base de datos no está disponible.",
        ) from e
    except Exception as e:
        # Cualquier otro fallo inesperado se propaga como 500.
        # NO se devuelven ceros: mostrar $0 y 0% haría creer que la planta no tiene costos.
        logger.exception("Error calculando stats financieras")
        raise HTTPException(
            status_code=500,
            detail="Error interno al calcular las métricas del dashboard.",
        ) from e
