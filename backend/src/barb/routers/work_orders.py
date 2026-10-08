from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from starlette.datastructures import UploadFile as StarletteUploadFile

from barb.core.config import settings
from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import get_sesion_actual, require_action, require_auth, resolver_empresa
from barb.core.work_order_states import ETIQUETA_ES, rol_puede_ir_a, transiciones_permitidas, transiciones_posibles
from barb.schemas.work_orders import WorkOrderStatusRequest
from barb.services.files import delete_ot_files, save_ot_photos
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
) -> dict:
    """`rol` habilita `allowed_transitions` (destinos que ese rol puede aplicar); `history` agrega `status_history`."""
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
        "diagnostico_id": row.get("diagnostico_id"),
        "allowed_transitions": transiciones_permitidas(str(row.get("estado") or "pending"), rol),
        **({"status_history": history} if history is not None else {}),
    }


_WORK_ORDER_SELECT = """
    SELECT
        ot.ot_id, ot.numero_ot, ot.maquina_id, ot.tecnico_id, ot.creado_por,
        ot.diagnostico_id, ot.reporte_id, ot.tipo, ot.descripcion_problema,
        ot.descripcion_reparacion, ot.resolution, ot.priority, ot.severity,
        ot.fecha_creacion, ot.fecha_inicio, ot.fecha_cierre, ot.fecha_vencimiento,
        ot.tiempo_reparacion_min, ot.downtime_minutes, ot.costo_estimado,
        ot.costo_real, ot.estado,
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
"""


# Filtro multi-empresa reutilizable: NULL = sin restricción (solo el super_usuario).
_EMPRESA_FILTER = "(%(empresa_id)s::int IS NULL OR p.empresa_id = %(empresa_id)s)"


async def fetch_work_order_row(numero_ot: str, empresa_id: int | None = None) -> dict | None:
    """Carga una OT. Si `empresa_id` no es None, solo la devuelve si pertenece a esa empresa."""
    return await fetch_one(
        f"{_WORK_ORDER_SELECT} WHERE ot.numero_ot = %(numero_ot)s AND {_EMPRESA_FILTER} LIMIT 1",
        {"numero_ot": numero_ot, "empresa_id": empresa_id},
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
    try:
        rows = await fetch_all(
            f"{_WORK_ORDER_SELECT} WHERE {_EMPRESA_FILTER} ORDER BY ot.fecha_creacion DESC, ot.ot_id DESC",
            {"empresa_id": scope},
        )
        return [row_to_work_order(row, rol=sesion["rol"]) for row in rows]
    except Exception:
        logger.exception("Error al listar órdenes de trabajo")
        return []


@router.get("/api/work-orders/{numero_ot}", dependencies=[Depends(require_auth)])
@router.get("/api/work_orders/{numero_ot}", dependencies=[Depends(require_auth)])
async def get_work_order(numero_ot: str, sesion: dict = Depends(get_sesion_actual)):
    row = await fetch_work_order_row(numero_ot, resolver_empresa(sesion))
    if not row:
        raise HTTPException(status_code=404, detail="OT no encontrada.")
    photos = await fetch_work_order_photos(int(row["ot_id"]))
    history = await fetch_status_history(int(row["ot_id"]))
    return row_to_work_order(row, photos=photos, rol=sesion["rol"], history=history)


@router.patch("/api/work-orders/{numero_ot}/status", dependencies=[Depends(require_action("cambiar_estado_ot"))])
@router.patch("/api/work_orders/{numero_ot}/status", dependencies=[Depends(require_action("cambiar_estado_ot"))])
# PUT se mantiene por compatibilidad con el contrato anterior; mismo comportamiento.
@router.put("/api/work-orders/{numero_ot}/status", dependencies=[Depends(require_action("cambiar_estado_ot"))])
@router.put("/api/work_orders/{numero_ot}/status", dependencies=[Depends(require_action("cambiar_estado_ot"))])
async def update_work_order_status(numero_ot: str, payload: WorkOrderStatusRequest, sesion: dict = Depends(get_sesion_actual)):
    """Cambia el estado de una OT respetando la máquina de estados (`core/work_order_states.py`) y deja auditoría."""
    desired_status = parse_work_order_status(payload.status)
    comment = safe_text(payload.comment) or None
    rol = sesion["rol"]
    now = datetime.now(UTC)

    try:
        async with transaction() as cur:
            # FOR UPDATE: serializa cambios simultáneos sobre la misma OT (la transición se valida contra el estado vigente).
            await cur.execute(
                f"""
                SELECT ot.ot_id, ot.estado::text AS estado, ot.fecha_inicio, ot.fecha_cierre
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
            if not rol_puede_ir_a(rol, desired_status):
                raise HTTPException(
                    status_code=403,
                    detail=f"El rol '{rol}' no puede cambiar una OT a '{ETIQUETA_ES[desired_status]}'.",
                )

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

        updated = await fetch_work_order_row(numero_ot)
        if not updated:
            return {"status": "ok"}
        ot_id = int(updated["ot_id"])
        return row_to_work_order(
            updated,
            photos=await fetch_work_order_photos(ot_id),
            rol=rol,
            history=await fetch_status_history(ot_id),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al actualizar estado de OT")
        raise HTTPException(status_code=500, detail="Error interno al actualizar el estado de la OT.") from e


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


def _validate_enum(value: str, allowed: tuple[str, ...], field_name: str) -> str:
    if value not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Valor inválido para '{field_name}': '{value}'. Permitidos: {', '.join(allowed)}.",
        )
    return value


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
    await _ensure_technician_exists(tecnico_id, empresa_maquina)

    temp_numero_ot = f"OT-TEMP-{uuid.uuid4().hex[:6]}"

    try:
        async with transaction() as cur:
            await cur.execute(
                """
                INSERT INTO orden_trabajo (
                    numero_ot, maquina_id, tecnico_id, creado_por, tipo,
                    descripcion_problema, descripcion_reparacion, resolution,
                    priority, severity, fecha_vencimiento, estado
                ) VALUES (
                    %(numero_ot)s, %(maquina_id)s, %(tecnico_id)s, %(creado_por)s, %(tipo)s,
                    %(descripcion_problema)s, %(descripcion_reparacion)s, %(resolution)s,
                    %(priority)s, %(severity)s, %(fecha_vencimiento)s, %(estado)s
                )
                RETURNING ot_id
                """,
                {
                    "numero_ot": temp_numero_ot,
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
                    "estado": estado,
                },
            )
            row = await cur.fetchone()
            ot_id = int(row["ot_id"])
            clean_numero_ot = f"OT-{datetime.now(UTC).year}-{ot_id:04d}"
            await cur.execute(
                "UPDATE orden_trabajo SET numero_ot = %(numero_ot)s WHERE ot_id = %(ot_id)s",
                {"numero_ot": clean_numero_ot, "ot_id": ot_id},
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

    created = await fetch_work_order_row(clean_numero_ot, empresa_maquina)
    photos = await fetch_work_order_photos(ot_id)
    response_data = (
        row_to_work_order(created, photos=photos, rol=sesion["rol"])
        if created
        else {"numero_ot": clean_numero_ot, "ot_id": ot_id}
    )
    response_data["photos"] = photos
    response_data["photo_count"] = len(photos)
    return response_data
