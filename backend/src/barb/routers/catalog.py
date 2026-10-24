from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import errors as pg_errors

from barb.core.db import fetch_all, transaction
from barb.core.permissions import (
    empresa_obligatoria,
    get_sesion_actual,
    require_auth,
    require_route,
    resolver_empresa,
)
from barb.schemas.plantas import (
    DisciplinaResuelta,
    MaquinaCreada,
    PlantaCompletaCreate,
    PlantaCompletaResponse,
)

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
        return []


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
        return []


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
        return []


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


# =============================================================================
# HU-25 (CGBIDA-461), subtarea CGBIDA-464: alta masiva de una planta con sus
# disciplinas y sus máquinas.
# =============================================================================


async def _resolver_disciplina(
    cur, empresa_id: int, nombre: str, cache: dict[str, tuple[int, bool, str]]
) -> int:
    """
    Devuelve el id de la disciplina, creándola si la empresa no la tiene.

    `cache` evita repetir la consulta cuando varias máquinas comparten disciplina y, sobre
    todo, evita insertarla dos veces si el nombre se repite en el payload. Guarda también el
    nombre tal como se escribió (tercer elemento): la clave del caché va en minúsculas para
    comparar, pero el nombre que se devuelve al cliente conserva su grafía original.
    """
    clave = nombre.lower()
    if clave in cache:
        return cache[clave][0]

    # La comparación es por lower(): «mecánica» y «Mecánica» son la misma disciplina para
    # quien la escribe, aunque el UNIQUE de la tabla distinga mayúsculas.
    await cur.execute(
        """
        SELECT disciplina_id, nombre FROM disciplina
        WHERE empresa_id = %(empresa_id)s AND lower(nombre) = lower(%(nombre)s)
        ORDER BY disciplina_id
        LIMIT 1
        """,
        {"empresa_id": empresa_id, "nombre": nombre},
    )
    fila = await cur.fetchone()
    if fila:
        cache[clave] = (int(fila["disciplina_id"]), False, str(fila["nombre"]))
        return cache[clave][0]

    await cur.execute(
        """
        INSERT INTO disciplina (empresa_id, nombre)
        VALUES (%(empresa_id)s, %(nombre)s)
        RETURNING disciplina_id
        """,
        {"empresa_id": empresa_id, "nombre": nombre},
    )
    creada = int((await cur.fetchone())["disciplina_id"])
    cache[clave] = (creada, True, nombre)
    return creada


@router.post(
    "/api/plantas/completa",
    status_code=201,
    response_model=PlantaCompletaResponse,
    dependencies=[Depends(require_route("plantas"))],
)
async def create_planta_completa(
    payload: PlantaCompletaCreate,
    sesion: dict = Depends(get_sesion_actual),
) -> PlantaCompletaResponse:
    """
    Crea una planta, resuelve sus disciplinas y da de alta sus máquinas en UNA transacción.

    HU-25 (CGBIDA-461), subtarea CGBIDA-464. El contrato vive en CGBIDA-462.

    Si cualquiera de las filas falla —código de máquina repetido, nombre de planta ya usado—
    no queda nada a medias: la planta no existe sin sus máquinas. El actor de la sesión queda
    en `app.usuario_id`, así que los triggers de auditoría registran cada fila insertada.

    Las disciplinas se resuelven contra la EMPRESA, no contra la planta: `disciplina` cuelga
    de `empresa` y se comparte entre plantas. Se reutiliza la existente (comparando por
    `lower()`) o se crea; nunca se duplica.
    """
    empresa_id = empresa_obligatoria(sesion)

    nombre_planta = payload.nombre.strip()
    ubicacion = (payload.ubicacion or "").strip() or None

    # Nombres de disciplina sin vacíos ni repetidos (comparados sin distinguir mayúsculas).
    disciplinas: list[str] = []
    vistos: set[str] = set()
    for bruto in payload.disciplinas:
        limpio = (bruto or "").strip()
        if not limpio or limpio.lower() in vistos:
            continue
        vistos.add(limpio.lower())
        disciplinas.append(limpio)

    # Códigos de máquina repetidos en el propio payload: se detectan antes de tocar la base.
    codigos = [(m.codigo or "").strip().lower() for m in payload.maquinas]
    if len(codigos) != len(set(codigos)):
        raise HTTPException(
            status_code=409,
            detail="Hay dos máquinas con el mismo código en la solicitud.",
        )

    cache_disciplinas: dict[str, tuple[int, bool, str]] = {}

    try:
        async with transaction() as cur:
            await cur.execute(
                """
                INSERT INTO planta (empresa_id, nombre, ubicacion)
                VALUES (%(empresa_id)s, %(nombre)s, %(ubicacion)s)
                RETURNING planta_id
                """,
                {"empresa_id": empresa_id, "nombre": nombre_planta, "ubicacion": ubicacion},
            )
            planta_id = int((await cur.fetchone())["planta_id"])

            # Disciplinas declaradas: se crean o se reutilizan.
            for nombre in disciplinas:
                await _resolver_disciplina(cur, empresa_id, nombre, cache_disciplinas)

            maquinas: list[MaquinaCreada] = []
            for maquina in payload.maquinas:
                disciplina_id: int | None = None
                if maquina.disciplina and maquina.disciplina.strip():
                    disciplina_id = await _resolver_disciplina(
                        cur, empresa_id, maquina.disciplina.strip(), cache_disciplinas
                    )

                await cur.execute(
                    """
                    INSERT INTO maquina (planta_id, disciplina_id, nombre, codigo)
                    VALUES (%(planta_id)s, %(disciplina_id)s, %(nombre)s, %(codigo)s)
                    RETURNING maquina_id
                    """,
                    {
                        "planta_id": planta_id,
                        "disciplina_id": disciplina_id,
                        "nombre": maquina.nombre.strip(),
                        "codigo": maquina.codigo.strip(),
                    },
                )
                maquinas.append(
                    MaquinaCreada(
                        maquina_id=int((await cur.fetchone())["maquina_id"]),
                        nombre=maquina.nombre.strip(),
                        codigo=maquina.codigo.strip(),
                        disciplina_id=disciplina_id,
                    )
                )
    except pg_errors.UniqueViolation as e:
        detalle = str(e)
        if "planta_empresa_id_nombre_key" in detalle:
            mensaje = f"Ya existe una planta llamada «{nombre_planta}» en tu empresa."
        elif "maquina_planta_id_codigo_key" in detalle:
            mensaje = "Ya existe una máquina con ese código en la planta."
        else:
            mensaje = "Ya existe un registro con esos datos."
        raise HTTPException(status_code=409, detail=mensaje) from e
    except pg_errors.ForeignKeyViolation as e:
        raise HTTPException(
            status_code=409,
            detail="La empresa o la disciplina indicada ya no existe.",
        ) from e
    except Exception as e:
        logger.exception("Error al crear la planta completa")
        raise HTTPException(status_code=500, detail="Error interno al crear la planta.") from e

    return PlantaCompletaResponse(
        planta_id=planta_id,
        nombre=nombre_planta,
        ubicacion=ubicacion,
        disciplinas=[
            DisciplinaResuelta(disciplina_id=disc_id, nombre=mostrado, creada=creada)
            for disc_id, creada, mostrado in cache_disciplinas.values()
        ],
        maquinas=maquinas,
    )


