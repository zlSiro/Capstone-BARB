"""
Mantenedor de empresas (clientes de la plataforma BARB).

Exclusivo del `super_usuario` (acción `gestionar_empresas`). Cada empresa es un
tenant: sus usuarios, plantas, OTs y documentación quedan aislados del resto.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from psycopg import errors as pg_errors

from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import require_action
from barb.core.security import hash_password
from barb.schemas.empresas import EmpresaCreateRequest, EmpresaUpdateRequest

logger = logging.getLogger("barb.empresas")

router = APIRouter(dependencies=[Depends(require_action("gestionar_empresas"))])

# Contadores por empresa para la grilla del mantenedor. Las OTs se cuentan a
# través de maquina -> planta porque ORDEN_TRABAJO no guarda empresa_id.
_EMPRESA_SELECT = """
    SELECT e.empresa_id, e.nombre, e.rut, e.pais, e.industria, e.contacto_nombre, e.contacto_email,
           e.contacto_telefono, e.plan, e.estado, e.max_usuarios, e.max_plantas,
           e.licencia_inicio, e.licencia_fin, e.notas, e.created_at, e.updated_at,
           (SELECT COUNT(*) FROM usuario u WHERE u.empresa_id = e.empresa_id AND u.activo)      AS usuarios_activos,
           (SELECT COUNT(*) FROM usuario u WHERE u.empresa_id = e.empresa_id)                   AS usuarios_total,
           (SELECT COUNT(*) FROM documento d WHERE d.empresa_id = e.empresa_id)                 AS documentos,
           (SELECT COUNT(*) FROM planta p WHERE p.empresa_id = e.empresa_id)                    AS plantas,
           (SELECT COUNT(*) FROM orden_trabajo ot
              JOIN maquina m ON m.maquina_id = ot.maquina_id
              JOIN planta p  ON p.planta_id  = m.planta_id
             WHERE p.empresa_id = e.empresa_id)                                                 AS ordenes_trabajo
    FROM empresa e
"""


def _serialize(row: dict) -> dict:
    return {
        "empresa_id": int(row["empresa_id"]),
        "nombre": row["nombre"],
        "rut": row["rut"],
        "pais": row["pais"],
        "industria": row["industria"],
        "contacto_nombre": row["contacto_nombre"],
        "contacto_email": row["contacto_email"],
        "contacto_telefono": row["contacto_telefono"],
        "plan": row["plan"],
        "estado": row["estado"],
        "max_usuarios": int(row["max_usuarios"]),
        "max_plantas": int(row["max_plantas"]),
        "licencia_inicio": row["licencia_inicio"].isoformat() if row["licencia_inicio"] else None,
        "licencia_fin": row["licencia_fin"].isoformat() if row["licencia_fin"] else None,
        "notas": row["notas"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "usuarios_activos": int(row["usuarios_activos"]),
        "usuarios_total": int(row["usuarios_total"]),
        "documentos": int(row["documentos"]),
        "plantas": int(row["plantas"]),
        "ordenes_trabajo": int(row["ordenes_trabajo"]),
    }


async def _get_empresa(empresa_id: int) -> dict:
    row = await fetch_one(f"{_EMPRESA_SELECT} WHERE e.empresa_id = %(id)s", {"id": empresa_id})
    if not row:
        raise HTTPException(status_code=404, detail="Empresa no encontrada.")
    return _serialize(row)


@router.get("/api/empresas")
async def list_empresas():
    rows = await fetch_all(f"{_EMPRESA_SELECT} ORDER BY e.nombre")
    return [_serialize(r) for r in rows]


@router.get("/api/empresas/{empresa_id}")
async def get_empresa(empresa_id: int):
    return await _get_empresa(empresa_id)


@router.post("/api/empresas", status_code=201)
async def create_empresa(payload: EmpresaCreateRequest):
    data = payload.model_dump(exclude={"admin"})
    data["rut"] = (data["rut"] or "").strip() or None  # '' -> NULL para no chocar con UNIQUE(rut)
    try:
        async with transaction() as cur:
            await cur.execute(
                """
                INSERT INTO empresa (nombre, rut, pais, industria, contacto_nombre, contacto_email, contacto_telefono,
                                     plan, estado, max_usuarios, max_plantas, licencia_inicio, licencia_fin, notas)
                VALUES (%(nombre)s, %(rut)s, %(pais)s, %(industria)s, %(contacto_nombre)s, %(contacto_email)s,
                        %(contacto_telefono)s, %(plan)s, %(estado)s, %(max_usuarios)s, %(max_plantas)s,
                        %(licencia_inicio)s, %(licencia_fin)s, %(notas)s)
                RETURNING empresa_id
                """,
                data,
            )
            empresa_id = int((await cur.fetchone())["empresa_id"])

            # Admin inicial: queda en la misma transacción, así nunca existe una
            # empresa creada "a medias" si el email del admin ya está en uso.
            if payload.admin:
                await cur.execute(
                    """
                    INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol)
                    VALUES (%(empresa_id)s, %(nombre)s, %(email)s, %(password_hash)s, 'admin')
                    """,
                    {
                        "empresa_id": empresa_id,
                        "nombre": payload.admin.nombre.strip(),
                        "email": payload.admin.email.strip().lower(),
                        "password_hash": hash_password(payload.admin.password),
                    },
                )
    except pg_errors.UniqueViolation as e:
        campo = "email del administrador" if "usuario" in str(e) else "RUT"
        raise HTTPException(status_code=409, detail=f"Ya existe un registro con ese {campo}.") from e
    except Exception as e:
        logger.exception("Error al crear empresa")
        raise HTTPException(status_code=500, detail="Error interno al crear la empresa.") from e
    return await _get_empresa(empresa_id)


@router.put("/api/empresas/{empresa_id}")
async def update_empresa(empresa_id: int, payload: EmpresaUpdateRequest):
    await _get_empresa(empresa_id)  # 404 si no existe
    # exclude_unset: solo se tocan los campos enviados (permite también limpiar un campo con null).
    changes = payload.model_dump(exclude_unset=True)
    if "nombre" in changes and not changes["nombre"]:
        raise HTTPException(status_code=422, detail="El nombre no puede estar vacío.")
    if "rut" in changes:
        changes["rut"] = (changes["rut"] or "").strip() or None
    if changes:
        # Los nombres de columna provienen del modelo Pydantic (lista cerrada), nunca del cliente.
        sets = ", ".join(f"{col} = %({col})s" for col in changes)
        try:
            async with transaction() as cur:
                await cur.execute(
                    f"UPDATE empresa SET {sets}, updated_at = NOW() WHERE empresa_id = %(_id)s",
                    {**changes, "_id": empresa_id},
                )
        except pg_errors.UniqueViolation as e:
            raise HTTPException(status_code=409, detail="Ya existe una empresa con ese RUT.") from e
        except Exception as e:
            logger.exception("Error al actualizar empresa")
            raise HTTPException(status_code=500, detail="Error interno al actualizar la empresa.") from e
        # Suspender/cancelar: se cierran las sesiones abiertas de sus usuarios.
        if changes.get("estado") in ("suspended", "cancelled"):
            async with transaction() as cur:
                await cur.execute(
                    "DELETE FROM sesion WHERE usuario_id IN (SELECT usuario_id FROM usuario WHERE empresa_id = %(id)s)",
                    {"id": empresa_id},
                )
    return await _get_empresa(empresa_id)


@router.delete("/api/empresas/{empresa_id}", status_code=204)
async def delete_empresa(empresa_id: int):
    """
    Elimina la empresa solo si no tiene datos asociados (usuarios, plantas, etc.).
    Para dar de baja una empresa con historial usar estado = 'cancelled'.
    """
    await _get_empresa(empresa_id)
    try:
        async with transaction() as cur:
            await cur.execute("DELETE FROM empresa WHERE empresa_id = %(id)s", {"id": empresa_id})
    except pg_errors.ForeignKeyViolation as e:
        raise HTTPException(
            status_code=409,
            detail="La empresa tiene usuarios, plantas u otros datos asociados. Cámbiala a estado 'cancelled'.",
        ) from e
    return None
