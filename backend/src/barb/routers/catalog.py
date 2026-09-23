from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from barb.core.db import fetch_all
from barb.core.permissions import require_auth

logger = logging.getLogger("barb.catalog")

router = APIRouter()


@router.get("/api/machines", dependencies=[Depends(require_auth)])
async def get_machines():
    try:
        rows = await fetch_all(
            """
            SELECT maquina_id AS id, nombre, disciplina_id, planta_id
            FROM maquina
            ORDER BY nombre
            """
        )
        return [
            {"id": int(r["id"]), "name": r["nombre"], "discipline_id": r["disciplina_id"], "plant_id": r["planta_id"]}
            for r in rows
        ]
    except Exception:
        logger.exception("Error al listar máquinas")
        return [{"id": 1, "name": "Planta Principal", "discipline_id": 1, "plant_id": 1}]


@router.get("/api/disciplines", dependencies=[Depends(require_auth)])
async def get_disciplines():
    try:
        rows = await fetch_all(
            """
            SELECT disciplina_id AS id, nombre
            FROM disciplina
            ORDER BY nombre
            """
        )
        return [{"id": int(r["id"]), "name": r["nombre"]} for r in rows]
    except Exception:
        logger.exception("Error al listar disciplinas")
        return [{"id": 1, "name": "General"}]


@router.get("/api/plants", dependencies=[Depends(require_auth)])
@router.get("/api/plantas", dependencies=[Depends(require_auth)])
async def get_plants():
    try:
        rows = await fetch_all(
            """
            SELECT planta_id AS id, nombre, ubicacion
            FROM planta
            ORDER BY planta_id
            """
        )
        return [{"id": int(r["id"]), "name": r["nombre"], "ubicacion": r["ubicacion"]} for r in rows]
    except Exception:
        logger.exception("Error al listar plantas")
        return [{"id": 1, "name": "Planta Central San Bernardo", "ubicacion": "San Bernardo, Región Metropolitana, Chile"}]


@router.get("/api/technicians", dependencies=[Depends(require_auth)])
async def get_technicians():
    try:
        rows = await fetch_all(
            """
            SELECT usuario_id AS id, nombre, email, rol
            FROM usuario
            WHERE lower(rol) = 'tecnico' AND COALESCE(activo, true) = true
            ORDER BY nombre
            """
        )
        return [{"id": int(r["id"]), "name": r["nombre"], "email": r["email"], "role": r["rol"]} for r in rows]
    except Exception:
        logger.exception("Error al listar técnicos")
        return []
