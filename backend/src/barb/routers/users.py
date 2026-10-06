"""
Mantenedor de usuarios (perfiles de los miembros de cada empresa).

Reglas multi-empresa (migración 0004):
- El admin de una empresa solo ve y administra usuarios de SU empresa.
- El super_usuario ve todas las empresas (o filtra con ?empresa_id=) y es el
  único que puede crear/editar otros super_usuario o asignar la empresa.
- Se respeta el límite de licencia `empresa.max_usuarios`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import errors as pg_errors

from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import (
    ROL_SUPER,
    ROLES,
    empresa_obligatoria,
    get_sesion_actual,
    require_action,
    resolver_empresa,
)
from barb.core.security import hash_password
from barb.schemas.users import UserCreateRequest, UserUpdateRequest
from barb.utils import serialize_user

logger = logging.getLogger("barb.users")

router = APIRouter()

_USER_SELECT = """
    SELECT u.usuario_id, u.nombre, u.email, u.rol, u.activo, u.created_at, u.ultimo_login,
           u.empresa_id, e.nombre AS empresa_nombre
    FROM usuario u
    LEFT JOIN empresa e ON e.empresa_id = u.empresa_id
"""


def _validar_rol(rol: str, sesion: dict) -> str:
    rol = (rol or "").strip().lower()
    if rol not in ROLES:
        raise HTTPException(status_code=422, detail=f"Rol inválido '{rol}'. Permitidos: {', '.join(ROLES)}.")
    # Escalamiento de privilegios: solo un super_usuario puede crear otro super_usuario.
    if rol == ROL_SUPER and sesion["rol"] != ROL_SUPER:
        raise HTTPException(status_code=403, detail="Solo un super_usuario puede asignar el rol super_usuario.")
    return rol


async def _usuario_visible(usuario_id: int, sesion: dict) -> dict:
    """Carga el usuario objetivo y verifica que el solicitante pueda administrarlo."""
    row = await fetch_one(
        "SELECT usuario_id, nombre, email, password_hash, rol, activo, empresa_id FROM usuario WHERE usuario_id = %(id)s",
        {"id": usuario_id},
    )
    # 404 (y no 403) para no revelar la existencia de usuarios de otras empresas.
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    if sesion["rol"] != ROL_SUPER:
        if row["empresa_id"] != sesion["empresa_id"] or str(row["rol"]).lower() == ROL_SUPER:
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return row


@router.get("/api/usuarios", dependencies=[Depends(require_action("ver_usuarios"))])
async def list_users(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    scope = resolver_empresa(sesion, empresa_id)
    rows = await fetch_all(
        f"""
        {_USER_SELECT}
        WHERE (%(empresa_id)s::int IS NULL OR u.empresa_id = %(empresa_id)s)
          AND (%(es_super)s OR u.rol <> 'super_usuario')
        ORDER BY e.nombre NULLS FIRST, u.usuario_id
        """,
        {"empresa_id": scope, "es_super": sesion["rol"] == ROL_SUPER},
    )
    return [serialize_user(r) for r in rows]


@router.post("/api/usuarios", status_code=201, dependencies=[Depends(require_action("gestionar_usuarios"))])
async def create_user(payload: UserCreateRequest, sesion: dict = Depends(get_sesion_actual)):
    rol = _validar_rol(payload.rol, sesion)
    email = payload.email.strip().lower()

    # El super_usuario no pertenece a ninguna empresa; el resto, siempre a una.
    if rol == ROL_SUPER:
        empresa_id = None
    else:
        empresa_id = empresa_obligatoria(sesion, payload.empresa_id)

    try:
        async with transaction() as cur:
            if empresa_id is not None:
                # Límite de licencia (empresa.max_usuarios) sobre usuarios activos.
                # FOR UPDATE evita que dos altas simultáneas excedan el cupo.
                await cur.execute(
                    "SELECT max_usuarios, estado FROM empresa WHERE empresa_id = %(id)s FOR UPDATE",
                    {"id": empresa_id},
                )
                empresa = await cur.fetchone()
                if not empresa:
                    raise HTTPException(status_code=404, detail="La empresa indicada no existe.")
                await cur.execute(
                    "SELECT COUNT(*) AS total FROM usuario WHERE empresa_id = %(id)s AND activo",
                    {"id": empresa_id},
                )
                if int((await cur.fetchone())["total"]) >= int(empresa["max_usuarios"]):
                    raise HTTPException(
                        status_code=409,
                        detail=f"La empresa alcanzó el máximo de usuarios de su licencia ({empresa['max_usuarios']}).",
                    )

            await cur.execute(
                """
                INSERT INTO usuario (empresa_id, nombre, email, password_hash, rol, activo)
                VALUES (%(empresa_id)s, %(nombre)s, %(email)s, %(password_hash)s, %(rol)s, %(activo)s)
                RETURNING usuario_id
                """,
                {
                    "empresa_id": empresa_id,
                    "nombre": payload.nombre.strip(),
                    "email": email,
                    "password_hash": hash_password(payload.password),
                    "rol": rol,
                    "activo": payload.activo,
                },
            )
            nuevo_id = int((await cur.fetchone())["usuario_id"])
    except HTTPException:
        raise
    except pg_errors.UniqueViolation as e:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese email.") from e
    except Exception as e:
        logger.exception("Error al crear usuario")
        raise HTTPException(status_code=500, detail="Error interno al crear el usuario.") from e

    row = await fetch_one(f"{_USER_SELECT} WHERE u.usuario_id = %(id)s", {"id": nuevo_id})
    return serialize_user(row)


@router.put("/api/usuarios/{usuario_id}", dependencies=[Depends(require_action("gestionar_usuarios"))])
async def update_user(usuario_id: int, payload: UserUpdateRequest, sesion: dict = Depends(get_sesion_actual)):
    current = await _usuario_visible(usuario_id, sesion)
    es_self = usuario_id == sesion["usuario_id"]

    next_rol = _validar_rol(payload.rol, sesion) if payload.rol is not None else str(current["rol"]).lower()
    next_activo = payload.activo if payload.activo is not None else current["activo"]

    # Evita que un administrador se quite a sí mismo el acceso (quedaría sin nadie que gestione la empresa).
    if es_self and (next_activo is False or next_rol != str(current["rol"]).lower()):
        raise HTTPException(status_code=409, detail="No puedes desactivarte ni cambiar tu propio rol.")
    # Un super_usuario debe seguir sin empresa y un usuario de empresa no puede pasar a super.
    if (next_rol == ROL_SUPER) != (str(current["rol"]).lower() == ROL_SUPER):
        raise HTTPException(status_code=422, detail="No se puede convertir un usuario en/desde super_usuario; crea uno nuevo.")

    next_email = payload.email.strip().lower() if payload.email is not None else current["email"]
    next_nombre = payload.nombre.strip() if payload.nombre is not None else current["nombre"]
    next_password_hash = hash_password(payload.password) if payload.password is not None else current["password_hash"]

    try:
        async with transaction() as cur:
            await cur.execute(
                """
                UPDATE usuario
                SET nombre = %(nombre)s, email = %(email)s, password_hash = %(password_hash)s,
                    rol = %(rol)s, activo = %(activo)s
                WHERE usuario_id = %(usuario_id)s
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
            # Al desactivar o cambiar la contraseña se cierran las sesiones abiertas del usuario.
            if payload.password is not None or next_activo is False:
                await cur.execute("DELETE FROM sesion WHERE usuario_id = %(id)s", {"id": usuario_id})
    except pg_errors.UniqueViolation as e:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese email.") from e
    except Exception as e:
        logger.exception("Error al actualizar usuario")
        raise HTTPException(status_code=500, detail="Error interno al actualizar el usuario.") from e

    row = await fetch_one(f"{_USER_SELECT} WHERE u.usuario_id = %(id)s", {"id": usuario_id})
    return serialize_user(row)


@router.delete("/api/usuarios/{usuario_id}", status_code=204, dependencies=[Depends(require_action("gestionar_usuarios"))])
async def delete_user(usuario_id: int, sesion: dict = Depends(get_sesion_actual)):
    await _usuario_visible(usuario_id, sesion)
    if usuario_id == sesion["usuario_id"]:
        raise HTTPException(status_code=409, detail="No puedes eliminar tu propio usuario.")

    try:
        async with transaction() as cur:
            await cur.execute("DELETE FROM usuario WHERE usuario_id = %(id)s", {"id": usuario_id})
    except pg_errors.ForeignKeyViolation as e:
        # El usuario figura en OTs/reportes: se conserva el historial y se sugiere desactivarlo.
        raise HTTPException(
            status_code=409,
            detail="El usuario tiene órdenes de trabajo o reportes asociados. Desactívalo en lugar de eliminarlo.",
        ) from e
    except Exception as e:
        logger.exception("Error al eliminar usuario")
        raise HTTPException(status_code=500, detail="Error interno al eliminar el usuario.") from e
    return None
