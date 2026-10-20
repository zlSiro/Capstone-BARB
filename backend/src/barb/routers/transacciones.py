"""
Vista de transacciones del super_usuario.

Lista lo que quedó registrado en `transacciones` (triggers de la migración 0009): cada
INSERT/UPDATE/DELETE hecho por un usuario autenticado. Solo lectura y exclusiva del
`super_usuario` (ruta `transacciones`). Nunca devuelve filas sin usuario identificado.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from barb.core.db import fetch_all, fetch_one
from barb.core.permissions import ROLES, require_route
from barb.utils import iso_z

router = APIRouter(dependencies=[Depends(require_route("transacciones", solo_lectura=True))])

# Rangos relativos a "ahora"; `custom` usa desde/hasta (ambos inclusivos, por día).
_INTERVALOS = {"24h": "24 hours", "7d": "7 days", "30d": "30 days", "1y": "1 year"}
Rango = Literal["24h", "7d", "30d", "1y", "custom"]


def _filtros(
    empresa_id: int | None, rol: str | None, usuario_id: int | None, rango: Rango | None, desde: date | None, hasta: date | None
) -> tuple[str, dict]:
    # t.usuario_id NOT NULL: solo transacciones con un usuario identificado.
    where = ["t.usuario_id IS NOT NULL"]
    params: dict = {}

    if empresa_id is not None:
        where.append("t.empresa_id = %(empresa_id)s")
        params["empresa_id"] = empresa_id
    if rol:
        rol = rol.strip().lower()
        if rol not in ROLES:
            raise HTTPException(status_code=422, detail=f"Rol inválido '{rol}'. Permitidos: {', '.join(ROLES)}.")
        where.append("t.perfil = %(rol)s")
        params["rol"] = rol
    if usuario_id is not None:
        where.append("t.usuario_id = %(usuario_id)s")
        params["usuario_id"] = usuario_id

    if rango == "custom":
        if desde is None or hasta is None:
            raise HTTPException(status_code=422, detail="El rango personalizado requiere 'desde' y 'hasta'.")
        if desde > hasta:
            raise HTTPException(status_code=422, detail="'desde' no puede ser posterior a 'hasta'.")
        where.append("t.fecha >= %(desde)s::date AND t.fecha < (%(hasta)s::date + 1)")
        params.update(desde=desde, hasta=hasta)
    elif rango:
        # El intervalo sale de un diccionario fijo, nunca del input del cliente.
        where.append(f"t.fecha >= NOW() - INTERVAL '{_INTERVALOS[rango]}'")

    return " AND ".join(where), params


@router.get("/api/transacciones")
async def list_transacciones(
    empresa_id: int | None = Query(default=None),
    rol: str | None = Query(default=None),
    usuario_id: int | None = Query(default=None),
    rango: Rango | None = Query(default=None),
    desde: date | None = Query(default=None),
    hasta: date | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    where, params = _filtros(empresa_id, rol, usuario_id, rango, desde, hasta)

    total = await fetch_one(f"SELECT COUNT(*) AS n FROM transacciones t WHERE {where}", params)
    rows = await fetch_all(
        f"""
        SELECT t.transaccion_id, t.fecha, t.usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email,
               t.empresa_id, e.nombre AS empresa_nombre, t.perfil, t.accion, t.detalle
        FROM transacciones t
        JOIN usuario u ON u.usuario_id = t.usuario_id
        LEFT JOIN empresa e ON e.empresa_id = t.empresa_id
        WHERE {where}
        ORDER BY t.fecha DESC, t.transaccion_id DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        {**params, "limit": limit, "offset": offset},
    )

    items = []
    for r in rows:
        detalle = r["detalle"] or {}
        items.append(
            {
                "transaccion_id": int(r["transaccion_id"]),
                "fecha": iso_z(r["fecha"]),
                "usuario_id": int(r["usuario_id"]),
                "usuario_nombre": r["usuario_nombre"],
                "usuario_email": r["usuario_email"],
                "empresa_id": r["empresa_id"],
                "empresa_nombre": r["empresa_nombre"],
                "perfil": r["perfil"],
                "accion": r["accion"],
                "operacion": detalle.get("operacion"),
                "tabla": detalle.get("tabla"),
                "registro_id": detalle.get("registro_id"),
                "detalle": detalle,
            }
        )
    return {"items": items, "total": int(total["n"]), "limit": limit, "offset": offset}


@router.get("/api/transacciones/filtros")
async def opciones_filtros():
    """Opciones de los filtros de la vista: empresas, roles y usuarios con sus empresas (para filtrar en cascada)."""
    empresas = await fetch_all("SELECT empresa_id, nombre FROM empresa ORDER BY nombre")
    usuarios = await fetch_all("SELECT usuario_id, nombre, rol, empresa_id FROM usuario ORDER BY nombre")
    return {
        "empresas": [{"empresa_id": int(e["empresa_id"]), "nombre": e["nombre"]} for e in empresas],
        "roles": list(ROLES),
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
