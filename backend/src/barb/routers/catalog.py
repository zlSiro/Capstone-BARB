from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from barb.core.db import fetch_all
from barb.core.permissions import get_sesion_actual, require_auth, resolver_empresa

logger = logging.getLogger("barb.catalog")

router = APIRouter()


@router.get("/api/machines", dependencies=[Depends(require_auth)])
async def get_machines(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    # Multi-empresa: la máquina pertenece a la empresa de su planta.
    try:
        rows = await fetch_all(
            """
            SELECT m.maquina_id AS id, m.nombre, m.disciplina_id, m.planta_id
            FROM maquina m
            JOIN planta p ON p.planta_id = m.planta_id
            WHERE (%(empresa_id)s::int IS NULL OR p.empresa_id = %(empresa_id)s)
            ORDER BY m.nombre
            """,
            {"empresa_id": resolver_empresa(sesion, empresa_id)},
        )
        return [
            {"id": int(r["id"]), "name": r["nombre"], "discipline_id": r["disciplina_id"], "plant_id": r["planta_id"]}
            for r in rows
        ]
    except Exception:
        logger.exception("Error al listar máquinas")
        return [{"id": 1, "name": "Planta Principal", "discipline_id": 1, "plant_id": 1}]


@router.get("/api/disciplines", dependencies=[Depends(require_auth)])
async def get_disciplines(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    try:
        rows = await fetch_all(
            """
            SELECT disciplina_id AS id, nombre
            FROM disciplina
            WHERE (%(empresa_id)s::int IS NULL OR empresa_id = %(empresa_id)s)
            ORDER BY nombre
            """,
            {"empresa_id": resolver_empresa(sesion, empresa_id)},
        )
        return [{"id": int(r["id"]), "name": r["nombre"]} for r in rows]
    except Exception:
        logger.exception("Error al listar disciplinas")
        return [{"id": 1, "name": "General"}]


@router.get("/api/plants", dependencies=[Depends(require_auth)])
@router.get("/api/plantas", dependencies=[Depends(require_auth)])
async def get_plants(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    try:
        rows = await fetch_all(
            """
            SELECT planta_id AS id, nombre, ubicacion
            FROM planta
            WHERE (%(empresa_id)s::int IS NULL OR empresa_id = %(empresa_id)s)
            ORDER BY planta_id
            """,
            {"empresa_id": resolver_empresa(sesion, empresa_id)},
        )
        return [{"id": int(r["id"]), "name": r["nombre"], "ubicacion": r["ubicacion"]} for r in rows]
    except Exception:
        logger.exception("Error al listar plantas")
        return [{"id": 1, "name": "Planta Central San Bernardo", "ubicacion": "San Bernardo, Región Metropolitana, Chile"}]


@router.get("/api/technicians", dependencies=[Depends(require_auth)])
async def get_technicians(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    try:
        rows = await fetch_all(
            """
            SELECT usuario_id AS id, nombre, email, rol
            FROM usuario
            WHERE lower(rol) = 'tecnico' AND COALESCE(activo, true) = true
              AND (%(empresa_id)s::int IS NULL OR empresa_id = %(empresa_id)s)
            ORDER BY nombre
            """,
            {"empresa_id": resolver_empresa(sesion, empresa_id)},
        )
        return [{"id": int(r["id"]), "name": r["nombre"], "email": r["email"], "role": r["rol"]} for r in rows]
    except Exception:
        logger.exception("Error al listar técnicos")
        return []
