"""
Avisos de falla: del reporte en planta a la decisión del supervisor.

Quienes trabajan en planta (operador, técnico, supervisor, ingeniero, gerente) reportan una falla. El aviso
llega a un repositorio que supervisor y gerente ven completo; ellos deciden si se genera una OT para atenderlo
o si se descarta (con motivo). Quien reportó solo ve sus propios avisos y en qué quedaron.

Los avisos viven en la tabla `aviso_falla` (migración 0012), con las columnas del formulario «Reportar falla»:

    pendiente   reportado, esperando la decisión del supervisor
    con_ot      el supervisor generó una OT; `orden_trabajo.aviso_falla_id` guarda el id del aviso que la originó
    descartado  el supervisor lo descartó; el motivo (obligatorio) queda en `motivo_descarte`

`resuelto_por` y `resuelto_en` guardan quién y cuándo decidió. La empresa del aviso se deriva de
maquina -> planta, igual que en las OT.

La foto de la falla (opcional: una imagen JPEG/PNG/WEBP de hasta 5 MB) se guarda en disco bajo `upload_dir/avisos/<id>/`;
en la tabla quedan su nombre original, el nombre guardado, el tipo y la ruta relativa a `upload_dir`. Se sirve por
`GET /api/avisos/{id}/foto` (con la misma visibilidad que el aviso) y, al generar la OT, se copia a `ot_foto` para que
la OT nazca con la evidencia.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.datastructures import UploadFile as StarletteUploadFile

from barb.core.config import settings
from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import get_sesion_actual, puede_ejecutar_accion, require_action, resolver_empresa
from barb.routers.work_orders import (
    _ensure_machine_exists,
    _ensure_technician_exists,
    _sla_efectivo_minutos,
    fetch_work_order_photos,
    fetch_work_order_row,
    insert_work_order,
    row_to_work_order,
    visibles_para,
)
from barb.schemas.avisos import AvisoCreateRequest, AvisoDescartarRequest, AvisoGenerarOtRequest
from barb.services.files import ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, attach_existing_photo_to_ot, is_valid_image
from barb.services.realtime import EVENT_OT_CREATED, VISIBLE_A, publish_safe
from barb.utils import iso_z

logger = logging.getLogger("barb.avisos")

router = APIRouter()

PREFIJO = "AV-"
COLUMNAS_FOTO = ("foto_nombre", "foto_archivo", "foto_content_type", "foto_ruta")
ETIQUETAS = {"pendiente": "Pendiente", "con_ot": "Con OT", "descartado": "Descartado"}

_AVISO_SELECT = """
    SELECT af.aviso_falla_id, af.numero_aviso, af.maquina_id, af.descripcion, af.severidad::text AS severidad,
           af.estado, af.created_at, af.resuelto_en, af.resuelto_por, af.motivo_descarte,
           af.foto_nombre, af.foto_archivo, af.foto_content_type, af.foto_ruta,
           m.nombre AS machine_name, p.nombre AS plant_name, p.empresa_id,
           ru.usuario_id AS reportado_por_id, ru.nombre AS reportado_por_nombre, ru.rol AS reportado_por_rol,
           au.nombre AS resuelto_por_nombre, ot.numero_ot
    FROM aviso_falla af
    JOIN maquina m ON m.maquina_id = af.maquina_id
    JOIN planta p ON p.planta_id = m.planta_id
    JOIN usuario ru ON ru.usuario_id = af.reportado_por
    LEFT JOIN usuario au ON au.usuario_id = af.resuelto_por
    LEFT JOIN orden_trabajo ot ON ot.aviso_falla_id = af.aviso_falla_id
"""

# Orden del repositorio: primero lo pendiente, y dentro de eso lo más grave y lo más reciente.
_ORDEN = (
    "ORDER BY CASE af.estado WHEN 'pendiente' THEN 0 ELSE 1 END, "
    "CASE af.severidad::text WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, "
    "af.created_at DESC, af.aviso_falla_id DESC"
)


def _foto_de(row: dict) -> dict | None:
    """Metadata de la foto del aviso, o None si no tiene."""
    if not row.get("foto_ruta"):
        return None
    return {
        "original_name": row["foto_nombre"],
        "content_type": row["foto_content_type"],
        "ruta": row["foto_ruta"],
    }


def _serializar(row: dict) -> dict:
    estado = str(row["estado"])
    foto = _foto_de(row)
    return {
        "aviso_id": int(row["aviso_falla_id"]),
        "numero_aviso": str(row["numero_aviso"]),
        "maquina_id": int(row["maquina_id"]),
        "machine": str(row.get("machine_name") or ""),
        "machine_name": str(row.get("machine_name") or ""),
        "plant": str(row.get("plant_name") or ""),
        "plant_name": str(row.get("plant_name") or ""),
        "empresa_id": row.get("empresa_id"),
        "descripcion": str(row.get("descripcion") or ""),
        "description": str(row.get("descripcion") or ""),
        "severidad": row.get("severidad"),
        "severity": row.get("severidad"),
        "estado": estado,
        "status": ETIQUETAS.get(estado, estado),
        "reportado_por": {
            "id": int(row["reportado_por_id"]),
            "nombre": str(row.get("reportado_por_nombre") or ""),
            "rol": str(row.get("reportado_por_rol") or "").lower(),
        },
        "created_at": iso_z(row.get("created_at")),
        "resuelto_en": iso_z(row.get("resuelto_en")) if estado != "pendiente" else None,
        "resuelto_por": row.get("resuelto_por_nombre") if estado != "pendiente" else None,
        "motivo_descarte": row.get("motivo_descarte") if estado == "descartado" else None,
        "numero_ot": row.get("numero_ot") if estado == "con_ot" else None,
        # La foto en sí se descarga por GET /api/avisos/{id}/foto.
        "foto": {"original_name": foto["original_name"], "content_type": foto["content_type"]} if foto else None,
    }


def _alcance(sesion: dict) -> tuple[str, dict]:
    """Empresa de la sesión + visibilidad: supervisor/gerente ven todo; el resto, solo lo que reportó."""
    clausulas = ["(%(empresa_id)s::int IS NULL OR p.empresa_id = %(empresa_id)s)"]
    params: dict = {"empresa_id": resolver_empresa(sesion)}
    if not puede_ejecutar_accion(sesion["rol"], "gestionar_avisos"):
        clausulas.append("af.reportado_por = %(uid)s")
        params["uid"] = sesion["usuario_id"]
    return " AND ".join(clausulas), params


async def _cargar(aviso_id: int, sesion: dict) -> dict:
    donde, params = _alcance(sesion)
    consulta = f"{_AVISO_SELECT} WHERE af.aviso_falla_id = %(aviso_id)s AND {donde}"
    row = await fetch_one(consulta, {**params, "aviso_id": aviso_id})
    # 404 tanto si no existe como si es de otra empresa o de otro usuario: no se revela cuál.
    if not row:
        raise HTTPException(status_code=404, detail="Aviso no encontrado.")
    return row


async def _leer_aviso(request: Request) -> tuple[AvisoCreateRequest, tuple[bytes, UploadFile] | None]:
    """Cuerpo del aviso: JSON, o multipart con la foto opcional (campo `foto`; también `photo`/`image`)."""
    content_type = (request.headers.get("content-type") or "").lower()
    raw: dict[str, Any]
    foto: tuple[bytes, UploadFile] | None = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        raw = {k: form.get(k) for k in ("maquina_id", "descripcion", "severidad") if form.get(k) not in (None, "")}
        candidatos = (form.get("foto"), form.get("photo"), form.get("image"))
        archivo = next((v for v in candidatos if isinstance(v, StarletteUploadFile) and v.filename), None)
        if archivo is not None:
            tipo = (archivo.content_type or "").strip().lower()
            if tipo not in ALLOWED_IMAGE_CONTENT_TYPES:
                raise HTTPException(status_code=415, detail="Solo se permiten imágenes JPEG, PNG o WEBP.")
            contenido = await archivo.read(MAX_IMAGE_BYTES + 1)
            if len(contenido) > MAX_IMAGE_BYTES:
                maximo = MAX_IMAGE_BYTES // (1024 * 1024)
                raise HTTPException(status_code=413, detail=f"La imagen supera el máximo de {maximo} MB.")
            if not is_valid_image(contenido, tipo):
                raise HTTPException(status_code=415, detail="El archivo no es una imagen válida.")
            foto = (contenido, archivo)
    elif "application/json" in content_type:
        try:
            raw = await request.json()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="El cuerpo JSON es inválido.") from exc
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="El cuerpo JSON debe ser un objeto.")
    else:
        raise HTTPException(status_code=415, detail="Content-Type no soportado para reportar una falla.")

    try:
        return AvisoCreateRequest(**raw), foto
    except ValidationError as exc:
        # Mismo formato que las validaciones de FastAPI: el frontend ya sabe mostrarlo.
        raise HTTPException(status_code=422, detail=json.loads(exc.json(include_url=False, include_context=False))) from exc


async def _guardar_foto(aviso_id: int, contenido: bytes, archivo: UploadFile) -> tuple[Path, dict]:
    """Escribe la foto en disco. Devuelve el archivo y los valores de las columnas `foto_*`."""
    original = Path(archivo.filename or "foto").name
    directorio = settings.upload_dir / "avisos" / str(aviso_id)
    directorio.mkdir(parents=True, exist_ok=True)
    guardado = f"aviso_{aviso_id}_{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}{Path(original).suffix.lower() or '.bin'}"
    destino = directorio / guardado
    await anyio.to_thread.run_sync(destino.write_bytes, contenido)
    columnas = {
        "foto_nombre": original,
        "foto_archivo": guardado,
        "foto_content_type": (archivo.content_type or "").strip().lower(),
        "foto_ruta": f"avisos/{aviso_id}/{guardado}",  # relativa a upload_dir
    }
    return destino, columnas


def _ruta_de_foto(foto: dict) -> Path:
    """Ruta absoluta de la foto, garantizando que queda dentro de `upload_dir` (sin escapar con `..`)."""
    base = settings.upload_dir.resolve()
    ruta = (base / foto["ruta"]).resolve()
    if not ruta.is_relative_to(base):
        raise HTTPException(status_code=404, detail="Foto no encontrada.")
    return ruta


@router.post("/api/avisos", status_code=201, dependencies=[Depends(require_action("reportar_falla"))])
async def reportar_falla(request: Request, sesion: dict = Depends(get_sesion_actual)):
    """
    Registra un aviso de falla. Queda pendiente en el repositorio del supervisor.
    Acepta JSON, o `multipart/form-data` con los mismos campos y la foto opcional en `foto`.
    """
    payload, foto = await _leer_aviso(request)
    await _ensure_machine_exists(payload.maquina_id, resolver_empresa(sesion))

    guardada: Path | None = None
    try:
        async with transaction() as cur:
            await cur.execute(
                """
                INSERT INTO aviso_falla (numero_aviso, maquina_id, reportado_por, descripcion, severidad)
                VALUES (%(numero)s, %(maquina_id)s, %(usuario_id)s, %(descripcion)s, %(severidad)s)
                RETURNING aviso_falla_id
                """,
                {
                    "numero": f"{PREFIJO}TEMP-{datetime.now(UTC).strftime('%H%M%S%f')}",
                    "maquina_id": payload.maquina_id,
                    "usuario_id": sesion["usuario_id"],
                    "descripcion": payload.descripcion,
                    "severidad": payload.severidad,
                },
            )
            aviso_id = int((await cur.fetchone())["aviso_falla_id"])
            columnas_foto: dict[str, str | None] = dict.fromkeys(COLUMNAS_FOTO)
            if foto is not None:
                guardada, columnas_foto = await _guardar_foto(aviso_id, foto[0], foto[1])
            await cur.execute(
                """
                UPDATE aviso_falla
                SET numero_aviso = %(numero)s, foto_nombre = %(foto_nombre)s, foto_archivo = %(foto_archivo)s,
                    foto_content_type = %(foto_content_type)s, foto_ruta = %(foto_ruta)s
                WHERE aviso_falla_id = %(id)s
                """,
                {"numero": f"{PREFIJO}{datetime.now(UTC).year}-{aviso_id:04d}", "id": aviso_id, **columnas_foto},
            )
    except Exception as e:
        # Si la transacción se revirtió, no debe quedar la foto huérfana en disco.
        if guardada is not None:
            guardada.unlink(missing_ok=True)
        logger.exception("Error al registrar el aviso de falla")
        raise HTTPException(status_code=500, detail="Error interno al registrar el aviso de falla.") from e
    return _serializar(await _cargar(aviso_id, sesion))


@router.get("/api/avisos", dependencies=[Depends(require_action("reportar_falla"))])
async def listar_avisos(
    estado: Literal["pendiente", "con_ot", "descartado"] | None = Query(default=None),
    sesion: dict = Depends(get_sesion_actual),
):
    """Repositorio de avisos. Supervisor y gerente ven los de toda la empresa; el resto, solo los que reportó."""
    donde, params = _alcance(sesion)
    if estado:
        donde += " AND af.estado = %(estado)s"
        params["estado"] = estado
    rows = await fetch_all(f"{_AVISO_SELECT} WHERE {donde} {_ORDEN}", params)
    return [_serializar(r) for r in rows]


@router.get("/api/avisos/{aviso_id}", dependencies=[Depends(require_action("reportar_falla"))])
async def obtener_aviso(aviso_id: int, sesion: dict = Depends(get_sesion_actual)):
    return _serializar(await _cargar(aviso_id, sesion))


@router.get("/api/avisos/{aviso_id}/foto", dependencies=[Depends(require_action("reportar_falla"))])
async def obtener_foto_aviso(aviso_id: int, sesion: dict = Depends(get_sesion_actual)):
    """Foto que adjuntó quien reportó. Misma visibilidad que el aviso: supervisor/gerente, o quien lo reportó."""
    foto = _foto_de(await _cargar(aviso_id, sesion))
    if not foto:
        raise HTTPException(status_code=404, detail="Este aviso no tiene foto.")
    ruta = _ruta_de_foto(foto)
    if not ruta.is_file():
        # El disco de Render es efímero: la foto puede haberse perdido tras un redespliegue.
        raise HTTPException(status_code=404, detail="La foto ya no está disponible.")
    return FileResponse(
        ruta,
        media_type=foto["content_type"],
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
    )


@router.post("/api/avisos/{aviso_id}/generar-ot", dependencies=[Depends(require_action("gestionar_avisos"))])
async def generar_ot(aviso_id: int, payload: AvisoGenerarOtRequest, sesion: dict = Depends(get_sesion_actual)):
    """
    El supervisor decide atender el aviso: se crea la OT (con `aviso_falla_id` apuntando al aviso) y el aviso pasa a «con OT».
    La descripción y la severidad se heredan del aviso salvo que se indiquen otras.
    """
    aviso = await _cargar(aviso_id, sesion)
    if aviso["estado"] != "pendiente":
        raise HTTPException(status_code=409, detail="El aviso ya fue atendido o descartado.")

    empresa_id = int(aviso["empresa_id"])
    await _ensure_technician_exists(payload.tecnico_id, empresa_id)
    # SLA efectivo antes de abrir la transacción: consulta la máquina en otra conexión.
    sla_minutos = await _sla_efectivo_minutos(int(aviso["maquina_id"]), payload.priority)

    try:
        async with transaction() as cur:
            # FOR UPDATE: dos supervisores no pueden convertir el mismo aviso a la vez.
            await cur.execute("SELECT estado FROM aviso_falla WHERE aviso_falla_id = %(id)s FOR UPDATE", {"id": aviso_id})
            if (await cur.fetchone())["estado"] != "pendiente":
                raise HTTPException(status_code=409, detail="El aviso ya fue atendido o descartado.")

            ot_id, numero_ot = await insert_work_order(
                cur,
                maquina_id=int(aviso["maquina_id"]),
                tecnico_id=payload.tecnico_id,
                creado_por=sesion["usuario_id"],
                tipo=payload.tipo,
                descripcion_problema=payload.descripcion_problema or str(aviso["descripcion"]),
                priority=payload.priority,
                severity=payload.severity or aviso["severidad"],
                fecha_vencimiento=payload.fecha_vencimiento,
                sla_minutos=sla_minutos,
                aviso_falla_id=aviso_id,
            )
            await cur.execute(
                """
                UPDATE aviso_falla SET estado = 'con_ot', resuelto_por = %(uid)s, resuelto_en = NOW()
                WHERE aviso_falla_id = %(id)s
                """,
                {"uid": sesion["usuario_id"], "id": aviso_id},
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al generar la OT desde el aviso")
        raise HTTPException(status_code=500, detail="Error interno al generar la OT desde el aviso.") from e

    publish_safe(
        EVENT_OT_CREATED,
        {
            "numero_ot": numero_ot,
            "ot_id": ot_id,
            "estado": "pending",
            "usuario_id": sesion["usuario_id"],
            VISIBLE_A: visibles_para(payload.tecnico_id, sesion["usuario_id"], aviso["reportado_por_id"]),
        },
        empresa_id,
    )

    # La OT nace con la evidencia que reportó la planta. Si la foto ya no está, la OT se crea igual.
    foto = _foto_de(aviso)
    if foto:
        try:
            await attach_existing_photo_to_ot(
                numero_ot, ot_id, _ruta_de_foto(foto), foto["original_name"], foto["content_type"], settings.upload_dir
            )
        except Exception:
            logger.exception("No se pudo adjuntar la foto del aviso %s a la OT %s", aviso_id, numero_ot)

    creada = await fetch_work_order_row(numero_ot, empresa_id)
    return {
        "aviso": _serializar(await _cargar(aviso_id, sesion)),
        "ot": row_to_work_order(
            creada,
            photos=await fetch_work_order_photos(ot_id),
            rol=sesion["rol"],
            usuario_id=sesion["usuario_id"],
        ),
    }


@router.post("/api/avisos/{aviso_id}/descartar", dependencies=[Depends(require_action("gestionar_avisos"))])
async def descartar_aviso(aviso_id: int, payload: AvisoDescartarRequest, sesion: dict = Depends(get_sesion_actual)):
    """El supervisor decide que el aviso no requiere OT. El motivo es obligatorio y lo ve quien reportó."""
    aviso = await _cargar(aviso_id, sesion)
    if aviso["estado"] != "pendiente":
        raise HTTPException(status_code=409, detail="El aviso ya fue atendido o descartado.")

    try:
        async with transaction() as cur:
            await cur.execute("SELECT estado FROM aviso_falla WHERE aviso_falla_id = %(id)s FOR UPDATE", {"id": aviso_id})
            if (await cur.fetchone())["estado"] != "pendiente":
                raise HTTPException(status_code=409, detail="El aviso ya fue atendido o descartado.")
            await cur.execute(
                """
                UPDATE aviso_falla
                SET estado = 'descartado', resuelto_por = %(uid)s, resuelto_en = NOW(), motivo_descarte = %(motivo)s
                WHERE aviso_falla_id = %(id)s
                """,
                {"uid": sesion["usuario_id"], "motivo": payload.motivo, "id": aviso_id},
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al descartar el aviso")
        raise HTTPException(status_code=500, detail="Error interno al descartar el aviso.") from e
    return _serializar(await _cargar(aviso_id, sesion))
