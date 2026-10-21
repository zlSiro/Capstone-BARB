"""
Vista de transacciones del gerente.

Igual que la del super_usuario (`routers/transacciones.py`) pero acotada a la empresa de la sesión:
el gerente solo ve lo que hicieron los usuarios de SU empresa. No acepta `empresa_id` (se ignora
cualquier valor del cliente) y nunca devuelve filas sin usuario identificado ni acciones del
super_usuario, que no pertenece a la empresa. Solo lectura; ruta `transacciones_empresa`.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from barb.core.db import fetch_all
from barb.core.permissions import ROL_SUPER, get_sesion_actual, require_route
from barb.routers.transacciones import Rango, _filtros, listar_transacciones

router = APIRouter(dependencies=[Depends(require_route("transacciones_empresa", solo_lectura=True))])


def _empresa_de(sesion: dict) -> int:
    # Un gerente siempre tiene empresa; esta guarda evita consultar "todas" si el dato faltara.
    if sesion["empresa_id"] is None:
        raise HTTPException(status_code=403, detail="Tu usuario no pertenece a ninguna empresa.")
    return sesion["empresa_id"]


@router.get("/api/empresa/transacciones")
async def list_transacciones_empresa(
    rol: str | None = Query(default=None),
    usuario_id: int | None = Query(default=None),
    rango: Rango | None = Query(default=None),
    desde: date | None = Query(default=None),
    hasta: date | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    sesion: dict = Depends(get_sesion_actual),
):
    # La empresa sale SIEMPRE de la sesión, nunca del request.
    where, params = _filtros(_empresa_de(sesion), rol, usuario_id, rango, desde, hasta)
    where += " AND t.perfil <> %(rol_super)s"
    params["rol_super"] = ROL_SUPER
    return await listar_transacciones(where, params, limit, offset)


@router.get("/api/empresa/transacciones/filtros")
async def opciones_filtros_empresa(sesion: dict = Depends(get_sesion_actual)):
    """Roles y usuarios de la empresa del gerente, para poblar los selectores en cascada."""
    usuarios = await fetch_all(
        "SELECT usuario_id, nombre, rol, empresa_id FROM usuario WHERE empresa_id = %(e)s AND rol <> %(s)s ORDER BY nombre",
        {"e": _empresa_de(sesion), "s": ROL_SUPER},
    )
    return {
        "roles": sorted({str(u["rol"]).lower() for u in usuarios}),
        "usuarios": [
            {
                "usuario_id": int(u["usuario_id"]),
                "nombre": u["nombre"],
                "rol": str(u["rol"]).lower(),
                "empresa_id": u["empresa_id"],
            }
            for u in usuarios
        ],
    }
