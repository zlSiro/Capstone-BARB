from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import get_sesion_actual, require_action
from barb.core.security import hash_password
from barb.schemas.users import UserCreateRequest, UserUpdateRequest
from barb.utils import serialize_user

logger = logging.getLogger("barb.users")

router = APIRouter()


@router.get("/api/usuarios", dependencies=[Depends(require_action("ver_usuarios"))])
async def list_users():
    try:
        rows = await fetch_all(
            """
            SELECT usuario_id, nombre, email, rol, activo, created_at
            FROM usuario
            ORDER BY usuario_id
            """
        )
        return [serialize_user(r) for r in rows]
    except Exception as e:
        logger.exception("Error al listar usuarios")
        raise HTTPException(status_code=500, detail=f"Error al listar usuarios: {str(e)}") from e


@router.post("/api/usuarios", status_code=201, dependencies=[Depends(require_action("gestionar_usuarios"))])
async def create_user(payload: UserCreateRequest, sesion: dict = Depends(get_sesion_actual)):
    try:
        async with transaction() as cur:
            await cur.execute(
                """
                INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol, activo)
                VALUES (%(empresa_id)s, %(nombre)s, %(email)s, %(password_hash)s, %(rol)s, %(activo)s)
                RETURNING usuario_id, nombre, email, rol, activo, created_at;
                """,
                {
                    #empresa_id": sesion["empresa_id"],
                    "nombre": payload.nombre,
                    "email": payload.email,
                    "password_hash": hash_password(payload.password),
                    "rol": payload.rol,
                    "activo": payload.activo,
                },
            )
            row = await cur.fetchone()
        return serialize_user(row)
    except Exception as e:
        logger.exception("Error al crear usuario")
        raise HTTPException(status_code=500, detail=f"Error al crear USUARIO: {str(e)}") from e


@router.put("/api/usuarios/{usuario_id}", dependencies=[Depends(require_action("gestionar_usuarios"))])
async def update_user(usuario_id: int, payload: UserUpdateRequest):
    current = await fetch_one(
        """
        SELECT usuario_id, nombre, email, password_hash, rol, activo, created_at
        FROM usuario
        WHERE usuario_id = %(usuario_id)s
        LIMIT 1
        """,
        {"usuario_id": usuario_id},
    )
    if not current:
        raise HTTPException(status_code=404, detail="USUARIO no encontrado para actualizar.")

    next_nombre = payload.nombre if payload.nombre is not None else current["nombre"]
    next_email = payload.email if payload.email is not None else current["email"]
    next_password_hash = (
        hash_password(payload.password) if payload.password is not None else current["password_hash"]
    )
    next_rol = payload.rol if payload.rol is not None else current["rol"]
    next_activo = payload.activo if payload.activo is not None else current["activo"]

    try:
        async with transaction() as cur:
            await cur.execute(
                """
                UPDATE usuario
                SET nombre = %(nombre)s, email = %(email)s, password_hash = %(password_hash)s,
                    rol = %(rol)s, activo = %(activo)s
                WHERE usuario_id = %(usuario_id)s
                RETURNING usuario_id, nombre, email, rol, activo, created_at;
                """,
                {
                    "nombre": next_nombre,
                    "email": next_email,
                    "password_hash": next_password_hash,
                    "rol": next_rol,
                    "activo": next_activo,
                    "usuario_id": usuario_id,
                },
            )
            row = await cur.fetchone()
        return serialize_user(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al actualizar usuario")
        raise HTTPException(status_code=500, detail=f"Error al actualizar USUARIO: {str(e)}") from e


@router.delete("/api/usuarios/{usuario_id}", status_code=204, dependencies=[Depends(require_action("gestionar_usuarios"))])
async def delete_user(usuario_id: int):
    try:
        async with transaction() as cur:
            await cur.execute("DELETE FROM usuario WHERE usuario_id = %(usuario_id)s;", {"usuario_id": usuario_id})
            deleted = cur.rowcount

        if deleted == 0:
            raise HTTPException(status_code=404, detail="USUARIO no encontrado para eliminar.")
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error al eliminar usuario")
        raise HTTPException(status_code=500, detail=f"Error al eliminar USUARIO: {str(e)}") from e
