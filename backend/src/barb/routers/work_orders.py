from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from psycopg import errors as pg_errors
from starlette.datastructures import UploadFile as StarletteUploadFile

from barb.core.config import settings
from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import (
    ROLES_VISTA_PROPIA,
    get_sesion_actual,
    puede_ejecutar_accion,
    require_action,
    require_any_action,
    require_auth,
    resolver_empresa,
)
from barb.core.work_order_states import (
    ESTADOS_FINALES,
    ETIQUETA_ES,
    rol_puede_ir_a,
    transiciones_permitidas,
    transiciones_posibles,
)
from barb.schemas.work_orders import WorkOrderAssignRequest, WorkOrderStatusRequest
from barb.services.files import delete_ot_files, save_ot_photos
from barb.services.realtime import EVENT_OT_CREATED, EVENT_OT_DELETED, EVENT_OT_STATUS_CHANGED, VISIBLE_A, publish_safe
from barb.utils import (
    humanize_status,
    iso_z,
    parse_optional_datetime,
    parse_work_order_status,
    safe_int,
    safe_text,
)

logger = logging.getLogger("barb.work_orders")

router = APIRouter()


def row_to_work_order(
    row: dict,
    photos: list[dict] | None = None,
    rol: str | None = None,
    history: list[dict] | None = None,
    usuario_id: int | None = None,
) -> dict:
    """
    `rol` habilita `allowed_transitions` (destinos que ese rol puede aplicar); `history` agrega `status_history`.
    `usuario_id` (el que consulta) permite saber si es el técnico asignado: solo él puede iniciar su OT.
    """
    es_responsable = usuario_id is not None and row.get("tecnico_id") is not None and int(row["tecnico_id"]) == usuario_id
    photo_list = photos or row.get("photos") or []
    return {
        "id": str(row["numero_ot"]),
        "numero_ot": str(row["numero_ot"]),
        "ot_id": int(row["ot_id"]),
        "title": str(row.get("descripcion_problema") or f"OT {row['numero_ot']}"),
        "description": row.get("descripcion_problema"),
        "resolution": row.get("resolution"),
        "machine": str(row.get("machine_name") or ""),
        "machine_name": str(row.get("machine_name") or ""),
        "machine_id": int(row["maquina_id"]),
        "plant": str(row.get("plant_name") or ""),
        "plant_name": str(row.get("plant_name") or ""),
        "plant_id": int(row.get("planta_id") or 1),
        # Multi-empresa: empresa dueña de la OT (derivada de maquina -> planta).
        "empresa_id": row.get("empresa_id"),
        "empresa_nombre": str(row.get("empresa_nombre") or ""),
        "discipline": str(row.get("discipline_name") or ""),
        "discipline_name": str(row.get("discipline_name") or ""),
        "priority": str(row.get("priority") or "medium"),
        "status": humanize_status(str(row.get("estado") or "pending")),
        "estado": str(row.get("estado") or "pending"),
        "severity": row.get("severity"),
        "age_minutes": int(row.get("tiempo_reparacion_min") or 0),
        "created_at": iso_z(row.get("fecha_creacion")),
        "fecha_inicio": iso_z(row.get("fecha_inicio")),
        "fecha_cierre": iso_z(row.get("fecha_cierre")),
        "photo_count": len(photo_list),
        "photos": photo_list,
        "tecnico_nombre": str(row.get("tecnico_nombre") or ""),
        "tipo": str(row.get("tipo") or "corrective"),
        "costo_estimado": float(row.get("costo_estimado") or 0),
        "costo_real": float(row.get("costo_real") or 0),
        "downtime_minutes": int(row.get("downtime_minutes")) if row.get("downtime_minutes") is not None else None,
        "reporte_id": row.get("reporte_id"),
        # Aviso de falla (reporte desde planta) que originó la OT; None si se creó directamente.
        "aviso_falla_id": row.get("aviso_falla_id"),
        "numero_aviso": row.get("numero_aviso"),
        "diagnostico_id": row.get("diagnostico_id"),
        "tecnico_id": int(row["tecnico_id"]) if row.get("tecnico_id") is not None else None,
        "allowed_transitions": transiciones_permitidas(str(row.get("estado") or "pending"), rol, es_responsable),
        **({"status_history": history} if history is not None else {}),
    }


_WORK_ORDER_SELECT = """
    SELECT
        ot.ot_id, ot.numero_ot, ot.maquina_id, ot.tecnico_id, ot.creado_por,
        ot.diagnostico_id, ot.reporte_id, ot.tipo, ot.descripcion_problema,
        ot.descripcion_reparacion, ot.resolution, ot.priority, ot.severity,
        ot.fecha_creacion, ot.fecha_inicio, ot.fecha_cierre, ot.fecha_vencimiento,
        ot.tiempo_reparacion_min, ot.downtime_minutes, ot.costo_estimado,
        ot.costo_real, ot.estado, ot.aviso_falla_id, af.numero_aviso,
        m.nombre AS machine_name, m.planta_id,
        d.disciplina_id AS discipline_id, d.nombre AS discipline_name,
        p.nombre AS plant_name, u.nombre AS tecnico_nombre,
        p.empresa_id, em.nombre AS empresa_nombre
    FROM orden_trabajo ot
    JOIN maquina m ON m.maquina_id = ot.maquina_id
    LEFT JOIN disciplina d ON d.disciplina_id = m.disciplina_id
    LEFT JOIN planta p ON p.planta_id = m.planta_id
    LEFT JOIN empresa em ON em.empresa_id = p.empresa_id
    LEFT JOIN usuario u ON u.usuario_id = ot.tecnico_id
    LEFT JOIN aviso_falla af ON af.aviso_falla_id = ot.aviso_falla_id
"""


# Filtro multi-empresa reutilizable: NULL = sin restricción (solo el super_usuario).
_EMPRESA_FILTER = "(%(empresa_id)s::int IS NULL OR p.empresa_id = %(empresa_id)s)"


def visibles_para(*usuario_ids: int | None) -> list[int]:
    """Ids de los usuarios a quienes concierne una OT (para filtrar los eventos en tiempo real)."""
    return sorted({int(i) for i in usuario_ids if i is not None})


def _alcance_propio(sesion: dict) -> tuple[str, dict]:
    """
    Filtro SQL de visibilidad por rol (alias `ot`). Operador y técnico solo ven las OT que les corresponden:
    las asignadas a ellos, las que crearon, o las nacidas de un aviso de falla que ellos reportaron.
    El resto de los roles de empresa ve todas las OT de su empresa (el filtro por empresa va aparte).
    """
    if sesion["rol"] in ROLES_VISTA_PROPIA:
        clausula = (
            "(ot.tecnico_id = %(alcance_uid)s OR ot.creado_por = %(alcance_uid)s OR EXISTS ("
            "SELECT 1 FROM aviso_falla afp WHERE afp.aviso_falla_id = ot.aviso_falla_id "
            "AND afp.reportado_por = %(alcance_uid)s))"
        )
        return clausula, {"alcance_uid": sesion["usuario_id"]}
    return "TRUE", {}


async def fetch_work_order_row(numero_ot: str, empresa_id: int | None = None, sesion: dict | None = None) -> dict | None:
    """
    Carga una OT. Si `empresa_id` no es None, solo la devuelve si pertenece a esa empresa.
    Si se pasa `sesion`, además aplica la visibilidad del rol (operador/técnico: solo lo suyo).
    """
    alcance, alcance_params = _alcance_propio(sesion) if sesion else ("TRUE", {})
    return await fetch_one(
        f"{_WORK_ORDER_SELECT} WHERE ot.numero_ot = %(numero_ot)s AND {_EMPRESA_FILTER} AND {alcance} LIMIT 1",
        {"numero_ot": numero_ot, "empresa_id": empresa_id, **alcance_params},
    )


async def fetch_work_order_photos(ot_id: int) -> list[dict]:
    rows = await fetch_all(
        """
        SELECT ot_foto_id, ot_id, file_name, original_name, content_type, file_path, created_at
        FROM ot_foto WHERE ot_id = %(ot_id)s ORDER BY ot_foto_id ASC
        """,
        {"ot_id": ot_id},
    )
    return [
        {
            "id": int(row["ot_foto_id"]),
            "ot_id": int(row["ot_id"]),
            "file_name": row["file_name"],
            "original_name": row["original_name"],
            "content_type": row["content_type"],
            "file_path": row["file_path"],
            "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        }
        for row in rows
    ]


async def fetch_status_history(ot_id: int) -> list[dict]:
    """Auditoría de cambios de estado de una OT, del más reciente al más antiguo."""
    rows = await fetch_all(
        """
        SELECT a.audit_id, a.estado_anterior, a.estado_nuevo, a.comentario, a."timestamp" AS changed_at,
               a.usuario_id, u.nombre AS usuario_nombre, u.rol AS usuario_rol
        FROM ot_audit_log a
        LEFT JOIN usuario u ON u.usuario_id = a.usuario_id
        WHERE a.ot_id = %(ot_id)s
        ORDER BY a."timestamp" DESC, a.audit_id DESC
        """,
        {"ot_id": ot_id},
    )
    return [
        {
            "id": int(r["audit_id"]),
            "from_status": r["estado_anterior"],
            "to_status": r["estado_nuevo"],
            "comment": r["comentario"],
            "user_id": int(r["usuario_id"]),
            "user_name": str(r.get("usuario_nombre") or ""),
            "user_role": r.get("usuario_rol"),
            "changed_at": iso_z(r["changed_at"]),
        }
        for r in rows
    ]


@router.get("/api/work-orders", dependencies=[Depends(require_auth)])
@router.get("/api/work_orders", dependencies=[Depends(require_auth)])
async def get_work_orders(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    scope = resolver_empresa(sesion, empresa_id)
    alcance, alcance_params = _alcance_propio(sesion)
    try:
        rows = await fetch_all(
            f"{_WORK_ORDER_SELECT} WHERE {_EMPRESA_FILTER} AND {alcance} "
            f"ORDER BY {_ORDEN_PRIORIDAD}, ot.fecha_creacion DESC, ot.ot_id DESC",
            {"empresa_id": scope, **alcance_params},
        )
        return [row_to_work_order(row, rol=sesion["rol"], usuario_id=sesion["usuario_id"]) for row in rows]
    except Exception:
        logger.exception("Error al listar órdenes de trabajo")
        return []


@router.get("/api/work-orders/{numero_ot}", dependencies=[Depends(require_auth)])
@router.get("/api/work_orders/{numero_ot}", dependencies=[Depends(require_auth)])
async def get_work_order(numero_ot: str, sesion: dict = Depends(get_sesion_actual)):
    # 404 (y no 403) si la OT existe pero el rol no debe verla: no se revela su existencia.
    row = await fetch_work_order_row(numero_ot, resolver_empresa(sesion), sesion)
    if not row:
        raise HTTPException(status_code=404, detail="OT no encontrada.")
    photos = await fetch_work_order_photos(int(row["ot_id"]))
    history = await fetch_status_history(int(row["ot_id"]))
    return row_to_work_order(row, photos=photos, rol=sesion["rol"], history=history, usuario_id=sesion["usuario_id"])


# Supervisión hacia arriba cambia estados; el técnico asignado solo inicia su OT (se valida dentro del endpoint).
_CAMBIAR_ESTADO = [Depends(require_any_action("cambiar_estado_ot", "iniciar_ot_asignada"))]


@router.patch("/api/work-orders/{numero_ot}/status", dependencies=_CAMBIAR_ESTADO)
@router.patch("/api/work_orders/{numero_ot}/status", dependencies=_CAMBIAR_ESTADO)
# PUT se mantiene por compatibilidad con el contrato anterior; mismo comportamiento.
@router.put("/api/work-orders/{numero_ot}/status", dependencies=_CAMBIAR_ESTADO)
@router.put("/api/work_orders/{numero_ot}/status", dependencies=_CAMBIAR_ESTADO)
async def update_work_order_status(numero_ot: str, payload: WorkOrderStatusRequest, sesion: dict = Depends(get_sesion_actual)):
    """
    Cambia el estado de una OT respetando la máquina de estados (`core/work_order_states.py`) y deja auditoría.

    Supervisión hacia arriba cambia estados según `cambiar_estado_ot`/`cancelar_ot`. El técnico solo puede
    iniciar (pending -> in_progress) la OT que tiene asignada.
    """
    desired_status = parse_work_order_status(payload.status)
    comment = safe_text(payload.comment) or None
    rol = sesion["rol"]
    now = datetime.now(UTC)

    try:
        async with transaction() as cur:
            # FOR UPDATE: serializa cambios simultáneos sobre la misma OT (la transición se valida contra el estado vigente).
            await cur.execute(
                f"""
                SELECT ot.ot_id, ot.estado::text AS estado, ot.fecha_inicio, ot.fecha_cierre, ot.tecnico_id, ot.creado_por,
                       (SELECT afp.reportado_por FROM aviso_falla afp
                         WHERE afp.aviso_falla_id = ot.aviso_falla_id) AS reportado_por,
                       p.empresa_id
                FROM orden_trabajo ot
                JOIN maquina m ON m.maquina_id = ot.maquina_id
                LEFT JOIN planta p ON p.planta_id = m.planta_id
                WHERE ot.numero_ot = %(numero_ot)s AND {_EMPRESA_FILTER}
                FOR UPDATE OF ot
                """,
                {"numero_ot": numero_ot, "empresa_id": resolver_empresa(sesion)},
            )
            current = await cur.fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="OT no encontrada.")

            previous_status = str(current["estado"])
            if desired_status == previous_status:
                raise HTTPException(status_code=409, detail=f"La OT ya está en estado '{ETIQUETA_ES[previous_status]}'.")
            if desired_status not in transiciones_posibles(previous_status):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Transición no permitida: una OT '{ETIQUETA_ES[previous_status]}' "
                        f"no puede pasar a '{ETIQUETA_ES[desired_status]}'."
                    ),
                )
            es_responsable = current["tecnico_id"] is not None and int(current["tecnico_id"]) == sesion["usuario_id"]
            if not rol_puede_ir_a(rol, desired_status, es_responsable):
                if desired_status == "in_progress" and puede_ejecutar_accion(rol, "iniciar_ot_asignada"):
                    detalle = "Solo el técnico asignado a la OT puede iniciarla."
                else:
                    detalle = f"El rol '{rol}' no puede cambiar una OT a '{ETIQUETA_ES[desired_status]}'."
                raise HTTPException(status_code=403, detail=detalle)

            next_fecha_inicio = current["fecha_inicio"]
            next_fecha_cierre = current["fecha_cierre"]
            if desired_status == "in_progress" and next_fecha_inicio is None:
                next_fecha_inicio = now
            if desired_status == "completed":
                next_fecha_cierre = now
                if next_fecha_inicio is None:
                    next_fecha_inicio = now

            await cur.execute(
                """
                UPDATE orden_trabajo SET estado = %(estado)s, fecha_inicio = %(fecha_inicio)s, fecha_cierre = %(fecha_cierre)s
                WHERE ot_id = %(ot_id)s
                """,
                {
                    "estado": desired_status,
                    "fecha_inicio": next_fecha_inicio,
                    "fecha_cierre": next_fecha_cierre,
                    "ot_id": current["ot_id"],
                },
            )
            await cur.execute(
                """
                INSERT INTO ot_audit_log (ot_id, usuario_id, estado_anterior, estado_nuevo, comentario, "timestamp")
                VALUES (%(ot_id)s, %(usuario_id)s, %(anterior)s, %(nuevo)s, %(comentario)s, %(ts)s)
                """,
                {
                    "ot_id": current["ot_id"],
                    "usuario_id": sesion["usuario_id"],
                    "anterior": previous_status,
                    "nuevo": desired_status,
                    "comentario": comment,
                    "ts": now,
                },
            )

        publish_safe(
            EVENT_OT_STATUS_CHANGED,
            {
                "numero_ot": numero_ot,
                "ot_id": int(current["ot_id"]),
                "estado_anterior": previous_status,
                "estado_nuevo": desired_status,
                "usuario_id": sesion["usuario_id"],
                VISIBLE_A: visibles_para(current["tecnico_id"], current["creado_por"], current["reportado_por"]),
            },
            current["empresa_id"],
        )

        updated = await fetch_work_order_row(numero_ot)
        if not updated:
            return {"status": "ok"}
        ot_id = int(updated["ot_id"])
        return row_to_work_order(
            updated,
            photos=await fetch_work_order_photos(ot_id),
            rol=rol,
            history=await fetch_status_history(ot_id),
            usuario_id=sesion["usuario_id"],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al actualizar estado de OT")
        raise HTTPException(status_code=500, detail="Error interno al actualizar el estado de la OT.") from e


@router.patch("/api/work-orders/{numero_ot}/assignment", dependencies=[Depends(require_action("asignar_ot"))])
@router.patch("/api/work_orders/{numero_ot}/assignment", dependencies=[Depends(require_action("asignar_ot"))])
async def assign_work_order(numero_ot: str, payload: WorkOrderAssignRequest, sesion: dict = Depends(get_sesion_actual)):
    """
    Prioriza y asigna (o reasigna) una OT abierta: técnico, prioridad y/o fecha de vencimiento.
    Supervisor y gerente. Una OT cerrada o cancelada no se modifica. El cambio queda en la bitácora de transacciones.
    """
    if payload.tecnico_id is None and payload.priority is None and payload.fecha_vencimiento is None:
        raise HTTPException(status_code=422, detail="Indica al menos un cambio: tecnico_id, priority o fecha_vencimiento.")
    priority = _validate_enum(payload.priority.lower(), PRIORIDADES_VALIDAS, "priority") if payload.priority else None

    current = await fetch_work_order_row(numero_ot, resolver_empresa(sesion))
    if not current:
        raise HTTPException(status_code=404, detail="OT no encontrada.")
    if str(current["estado"]) in ESTADOS_FINALES:
        raise HTTPException(status_code=409, detail=f"Una OT '{ETIQUETA_ES[str(current['estado'])]}' no se puede reasignar.")
    if payload.tecnico_id is not None:
        await _ensure_technician_exists(payload.tecnico_id, current["empresa_id"])

    try:
        async with transaction() as cur:
            await cur.execute(
                """
                UPDATE orden_trabajo
                SET tecnico_id = COALESCE(%(tecnico_id)s, tecnico_id),
                    priority = COALESCE(%(priority)s::prioridad_ot, priority),
                    fecha_vencimiento = COALESCE(%(vence)s, fecha_vencimiento)
                WHERE ot_id = %(ot_id)s AND estado NOT IN ('completed', 'cancelled')
                """,
                {
                    "tecnico_id": payload.tecnico_id,
                    "priority": priority,
                    "vence": payload.fecha_vencimiento,
                    "ot_id": current["ot_id"],
                },
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=409, detail="La OT cambió de estado: ya no se puede reasignar.")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al asignar la OT")
        raise HTTPException(status_code=500, detail="Error interno al asignar la OT.") from e

    updated = await fetch_work_order_row(numero_ot, resolver_empresa(sesion))
    ot_id = int(current["ot_id"])
    return row_to_work_order(
        updated,
        photos=await fetch_work_order_photos(ot_id),
        rol=sesion["rol"],
        history=await fetch_status_history(ot_id),
        usuario_id=sesion["usuario_id"],
    )


@router.delete("/api/work-orders/{numero_ot}", status_code=204, dependencies=[Depends(require_action("eliminar_ot"))])
@router.delete("/api/work_orders/{numero_ot}", status_code=204, dependencies=[Depends(require_action("eliminar_ot"))])
async def delete_work_order(numero_ot: str, sesion: dict = Depends(get_sesion_actual)):
    current = await fetch_work_order_row(numero_ot, resolver_empresa(sesion))
    if not current:
        raise HTTPException(status_code=404, detail="OT no encontrada.")
    ot_id = int(current["ot_id"])
    await delete_ot_files(ot_id, settings.upload_dir)

    try:
        async with transaction() as cur:
            await cur.execute("DELETE FROM orden_trabajo WHERE ot_id = %(ot_id)s;", {"ot_id": ot_id})
            deleted = cur.rowcount
        if deleted == 0:
            raise HTTPException(status_code=404, detail="OT no encontrada para eliminar.")
        publish_safe(
            EVENT_OT_DELETED,
            {
                "numero_ot": numero_ot,
                "ot_id": ot_id,
                "usuario_id": sesion["usuario_id"],
                VISIBLE_A: visibles_para(current.get("tecnico_id"), current.get("creado_por")),
            },
            current.get("empresa_id"),
        )
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al eliminar OT")
        raise HTTPException(status_code=500, detail=f"Error al eliminar OT: {str(e)}") from e


TIPOS_VALIDOS = ("corrective", "preventive", "predictive", "inspection")
PRIORIDADES_VALIDAS = ("low", "medium", "high", "urgent")
SEVERIDADES_VALIDAS = ("low", "medium", "high", "critical")
DESCRIPCION_MAX_LEN = 5000

# Orden del listado: primero lo urgente, después lo más reciente. Un técnico tiene que ver
# arriba lo que más corre riesgo, no lo último que se creó.
_ORDEN_PRIORIDAD = (
    "CASE ot.priority "
    "WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END"
)


def _validate_enum(value: str, allowed: tuple[str, ...], field_name: str) -> str:
    if value not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Valor inválido para '{field_name}': '{value}'. Permitidos: {', '.join(allowed)}.",
        )
    return value


# Multiplicador del SLA según la urgencia de la OT: más urgencia, menos plazo.
# La máquina dice cuánto tiempo tolera estar parada; la prioridad dice cuánto de ese plazo
# se puede usar esta vez. `urgent` = la mitad del SLA, `low` = 50 % más.
SLA_POR_PRIORIDAD = {
    "urgent": 0.5,
    "high": 0.75,
    "medium": 1.0,
    "low": 1.5,
}


async def _sla_efectivo_minutos(maquina_id: int, priority: str) -> int:
    """
    Minutos de plazo para esta OT: SLA de la máquina (o el global) × factor de prioridad.

    `sla_horas` por máquina puede no existir todavía en la base (las columnas están
    pendientes de un ALTER manual), así que la consulta tolera `UndefinedColumn` y cae al
    SLA global. Se hace FUERA de la transacción de creación: una consulta que falla dentro
    de una transacción la deja abortada.
    """
    sla_horas: float | None = None
    try:
        fila = await fetch_one(
            "SELECT sla_horas FROM maquina WHERE maquina_id = %(id)s", {"id": maquina_id}
        )
        if fila and fila.get("sla_horas") is not None:
            sla_horas = float(fila["sla_horas"])
    except pg_errors.UndefinedColumn:
        # La columna todavía no existe: se usa el SLA general. No es un error del usuario.
        logger.info("maquina.sla_horas no existe todavia; la OT usa el SLA global.")

    base_minutos = sla_horas * 60 if sla_horas and sla_horas > 0 else settings.sla_target_minutes
    factor = SLA_POR_PRIORIDAD.get((priority or "").lower(), 1.0)
    return max(1, int(round(base_minutos * factor)))


async def _ensure_machine_exists(maquina_id: int, empresa_id: int | None = None) -> int:
    """
    Verifica que la máquina exista y, si se indica `empresa_id`, que pertenezca a esa
    empresa (un usuario no puede crear OTs sobre máquinas de otra empresa).
    Devuelve la empresa dueña de la máquina.
    """
    row = await fetch_one(
        """
        SELECT m.maquina_id, p.empresa_id FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
        WHERE m.maquina_id = %(id)s AND (%(empresa_id)s::int IS NULL OR p.empresa_id = %(empresa_id)s)
        """,
        {"id": maquina_id, "empresa_id": empresa_id},
    )
    if not row:
        raise HTTPException(status_code=422, detail=f"La máquina {maquina_id} no existe.")
    return int(row["empresa_id"])


async def _ensure_technician_exists(tecnico_id: int, empresa_id: int | None = None) -> None:
    # El técnico debe ser de la misma empresa que la máquina/OT.
    row = await fetch_one(
        """
        SELECT usuario_id, rol, activo FROM usuario
        WHERE usuario_id = %(id)s AND empresa_id IS NOT DISTINCT FROM %(empresa_id)s
        """,
        {"id": tecnico_id, "empresa_id": empresa_id},
    )
    if not row:
        raise HTTPException(status_code=422, detail=f"El técnico {tecnico_id} no existe.")
    if str(row["rol"]).lower() != "tecnico":
        raise HTTPException(status_code=422, detail=f"El usuario {tecnico_id} no tiene rol de técnico.")
    if not row.get("activo", True):
        raise HTTPException(status_code=422, detail=f"El técnico {tecnico_id} está inactivo.")


async def insert_work_order(
    cur,
    *,
    maquina_id: int,
    tecnico_id: int,
    creado_por: int,
    tipo: str,
    descripcion_problema: str,
    priority: str,
    severity: str | None,
    fecha_vencimiento: datetime | None,
    sla_minutos: int,
    estado: str = "pending",
    descripcion_reparacion: str | None = None,
    resolution: str | None = None,
    aviso_falla_id: int | None = None,
) -> tuple[int, str]:
    """
    Inserta la OT dentro de la transacción del llamador y le asigna su `numero_ot` definitivo.
    Devuelve `(ot_id, numero_ot)`. `aviso_falla_id` guarda el id del aviso de falla que originó la OT (None si es directa).
    """
    await cur.execute(
        """
        INSERT INTO orden_trabajo (
            numero_ot, maquina_id, tecnico_id, creado_por, tipo,
            descripcion_problema, descripcion_reparacion, resolution,
            priority, severity, fecha_vencimiento, estado, aviso_falla_id
        ) VALUES (
            %(numero_ot)s, %(maquina_id)s, %(tecnico_id)s, %(creado_por)s, %(tipo)s,
            %(descripcion_problema)s, %(descripcion_reparacion)s, %(resolution)s,
            %(priority)s, %(severity)s,
            COALESCE(%(fecha_vencimiento)s, NOW() + make_interval(mins => %(sla_minutos)s)),
            %(estado)s, %(aviso_falla_id)s
        )
        RETURNING ot_id
        """,
        {
            "numero_ot": f"OT-TEMP-{uuid.uuid4().hex[:6]}",
            "maquina_id": maquina_id,
            "tecnico_id": tecnico_id,
            "creado_por": creado_por,
            "tipo": tipo,
            "descripcion_problema": descripcion_problema or None,
            "descripcion_reparacion": descripcion_reparacion or None,
            "resolution": resolution or None,
            "priority": priority,
            "severity": severity,
            "fecha_vencimiento": fecha_vencimiento,
            "sla_minutos": sla_minutos,
            "estado": estado,
            "aviso_falla_id": aviso_falla_id,
        },
    )
    row = await cur.fetchone()
    ot_id = int(row["ot_id"])
    numero_ot = f"OT-{datetime.now(UTC).year}-{ot_id:04d}"
    await cur.execute(
        "UPDATE orden_trabajo SET numero_ot = %(numero_ot)s WHERE ot_id = %(ot_id)s",
        {"numero_ot": numero_ot, "ot_id": ot_id},
    )
    return ot_id, numero_ot


@router.post("/api/work-orders", dependencies=[Depends(require_action("crear_ot"))])
@router.post("/api/work_orders", dependencies=[Depends(require_action("crear_ot"))])
async def create_work_order(request: Request, sesion: dict = Depends(get_sesion_actual)):
    content_type = (request.headers.get("content-type") or "").lower()
    payload: dict[str, Any] = {}
    images: list[UploadFile] = []

    if "multipart/form-data" in content_type:
        form = await request.form()
        payload = {key: form.get(key) for key in form.keys()}
        for key in ("images", "photos", "attachments", "photo"):
            images.extend([value for value in form.getlist(key) if isinstance(value, StarletteUploadFile)])
    elif "application/json" in content_type:
        try:
            payload = await request.json()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="El cuerpo JSON es inválido.") from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="El cuerpo JSON debe ser un objeto.")
    else:
        raise HTTPException(status_code=415, detail="Content-Type no soportado para crear OT.")

    maquina_id = safe_int(payload.get("maquina_id") or payload.get("machine_id"), "maquina_id")
    tecnico_id = safe_int(payload.get("tecnico_id") or payload.get("technician_id"), "tecnico_id")
    # El creador siempre es el usuario autenticado; no se acepta desde el cliente.
    creado_por = sesion["usuario_id"]
    tipo = _validate_enum(safe_text(payload.get("tipo"), "corrective").lower() or "corrective", TIPOS_VALIDOS, "tipo")
    descripcion_problema = safe_text(
        payload.get("descripcion_problema")
        or payload.get("description")
        or payload.get("title")
        or payload.get("issue_description"),
        "",
    )
    if not descripcion_problema:
        raise HTTPException(status_code=400, detail="El campo 'descripcion_problema' es obligatorio.")
    if len(descripcion_problema) > DESCRIPCION_MAX_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"El campo 'descripcion_problema' excede {DESCRIPCION_MAX_LEN} caracteres.",
        )
    descripcion_reparacion = safe_text(payload.get("descripcion_reparacion"), "")
    resolution = safe_text(payload.get("resolution"), "")
    priority = _validate_enum(
        safe_text(payload.get("priority"), "medium").lower() or "medium", PRIORIDADES_VALIDAS, "priority"
    )
    severity_raw = safe_text(payload.get("severity"), "").lower()
    severity = _validate_enum(severity_raw, SEVERIDADES_VALIDAS, "severity") if severity_raw else None
    estado = parse_work_order_status(safe_text(payload.get("estado") or payload.get("status"), "pending"))
    fecha_vencimiento = parse_optional_datetime(payload.get("fecha_vencimiento") or payload.get("due_date"))

    # Multi-empresa: la máquina debe ser de la empresa del usuario (el super_usuario puede
    # operar sobre cualquiera) y el técnico debe pertenecer a la misma empresa que la máquina.
    empresa_maquina = await _ensure_machine_exists(maquina_id, resolver_empresa(sesion))
    # SLA efectivo: SLA de la máquina (o el global) × factor de prioridad. Se calcula antes
    # de abrir la transacción porque consulta la máquina en otra conexión.
    sla_minutos = await _sla_efectivo_minutos(maquina_id, priority)
    await _ensure_technician_exists(tecnico_id, empresa_maquina)

    try:
        async with transaction() as cur:
            ot_id, clean_numero_ot = await insert_work_order(
                cur,
                maquina_id=maquina_id,
                tecnico_id=tecnico_id,
                creado_por=creado_por,
                tipo=tipo,
                descripcion_problema=descripcion_problema,
                descripcion_reparacion=descripcion_reparacion,
                resolution=resolution,
                priority=priority,
                severity=severity,
                fecha_vencimiento=fecha_vencimiento,
                sla_minutos=sla_minutos,
                estado=estado,
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al crear OT")
        raise HTTPException(status_code=500, detail="Error interno al crear la OT.") from e

    try:
        if images:
            await save_ot_photos(clean_numero_ot, ot_id, images, settings.upload_dir)
    except Exception as e:
        logger.exception("Error al guardar fotos de la OT")
        await delete_ot_files(ot_id, settings.upload_dir)
        async with transaction() as cur:
            await cur.execute("DELETE FROM orden_trabajo WHERE ot_id = %(ot_id)s;", {"ot_id": ot_id})
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="Error al guardar las fotos de la OT.") from e

    publish_safe(
        EVENT_OT_CREATED,
        {
            "numero_ot": clean_numero_ot,
            "ot_id": ot_id,
            "estado": estado,
            "usuario_id": sesion["usuario_id"],
            VISIBLE_A: visibles_para(tecnico_id, creado_por),
        },
        empresa_maquina,
    )

    created = await fetch_work_order_row(clean_numero_ot, empresa_maquina)
    photos = await fetch_work_order_photos(ot_id)
    response_data = (
        row_to_work_order(created, photos=photos, rol=sesion["rol"], usuario_id=sesion["usuario_id"])
        if created
        else {"numero_ot": clean_numero_ot, "ot_id": ot_id}
    )
    response_data["photos"] = photos
    response_data["photo_count"] = len(photos)
    return response_data
