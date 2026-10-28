from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import errors as pg_errors

from barb.core.db import fetch_all, fetch_one, transaction
from barb.core.permissions import (
    empresa_obligatoria,
    get_sesion_actual,
    require_auth,
    require_route,
    resolver_empresa,
)
from barb.schemas.plantas import (
    DisciplinaResuelta,
    MaquinaActualizada,
    MaquinaCreada,
    MaquinaNuevaRequest,
    MaquinaUpdateRequest,
    PlantaActualizada,
    PlantaCompletaCreate,
    PlantaCompletaResponse,
    PlantaUpdateRequest,
)

logger = logging.getLogger("barb.catalog")

router = APIRouter()

# SLA y costo de inactividad por máquina: el código queda listo, pero las columnas tienen
# que existir en la base. Como AGENTS.md prohíbe migrar, el router se adapta en caliente:
# si las columnas están, se leen y escriben; si no, la API sigue funcionando (devuelve None)
# en vez de romper el mantenedor entero con un UndefinedColumn.
_SQL_PARA_SLA_COSTO = (
    "ALTER TABLE maquina "
    "ADD COLUMN IF NOT EXISTS sla_horas NUMERIC(6,2), "
    "ADD COLUMN IF NOT EXISTS costo_inactividad_minuto NUMERIC(12,2);"
)

_sla_costo_disponibles_cache: bool | None = None


async def _sla_costo_disponibles() -> bool:
    """
    ¿La tabla `maquina` tiene ya `sla_horas` y `costo_inactividad_minuto`?

    Se memoriza porque lo consulta el listado de máquinas, que corre en cada carga de la
    pantalla. Si se corre el SQL con el backend levantado, hay que reiniciarlo para que el
    cambio se tome (o esperar al próximo arranque).
    """
    global _sla_costo_disponibles_cache
    if _sla_costo_disponibles_cache is None:
        fila = await fetch_one(
            """
            SELECT COUNT(*) AS n
              FROM information_schema.columns
             WHERE table_name = 'maquina'
               AND column_name IN ('sla_horas', 'costo_inactividad_minuto')
            """
        )
        _sla_costo_disponibles_cache = bool(fila and int(fila["n"]) == 2)
    return _sla_costo_disponibles_cache


def _error_sla_sin_columnas() -> HTTPException:
    """Se enviaron valores de SLA/costo pero la base todavía no tiene las columnas."""
    return HTTPException(
        status_code=503,
        detail=(
            "La base de datos todavía no tiene las columnas sla_horas y "
            "costo_inactividad_minuto en la tabla 'maquina'. Hay que correr este SQL "
            f"(la aplicación no migra): {_SQL_PARA_SLA_COSTO}"
        ),
    )


@router.get("/api/machines", dependencies=[Depends(require_auth)])
async def get_machines(empresa_id: int | None = Query(default=None), sesion: dict = Depends(get_sesion_actual)):
    # Multi-empresa: la máquina pertenece a la empresa de su planta.
    try:
        extra = await _sla_costo_disponibles()
        columnas_extra = (
            ", m.sla_horas, m.costo_inactividad_minuto"
            if extra
            else ", NULL::numeric AS sla_horas, NULL::numeric AS costo_inactividad_minuto"
        )
        rows = await fetch_all(
            f"""
            SELECT m.maquina_id AS id, m.nombre, m.codigo, m.disciplina_id, m.planta_id{columnas_extra}
            FROM maquina m
            JOIN planta p ON p.planta_id = m.planta_id
            WHERE (%(empresa_id)s::int IS NULL OR p.empresa_id = %(empresa_id)s)
            ORDER BY m.nombre
            """,
            {"empresa_id": resolver_empresa(sesion, empresa_id)},
        )
        return [
            {
                "id": int(r["id"]),
                "name": r["nombre"],
                # El código hace falta para precargar la edición de la máquina.
                "codigo": r["codigo"],
                "discipline_id": r["disciplina_id"],
                "plant_id": r["planta_id"],
                "sla_horas": r["sla_horas"],
                "costo_inactividad_minuto": r["costo_inactividad_minuto"],
            }
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
            extra = await _sla_costo_disponibles()
            for maquina in payload.maquinas:
                disciplina_id: int | None = None
                if maquina.disciplina and maquina.disciplina.strip():
                    disciplina_id = await _resolver_disciplina(
                        cur, empresa_id, maquina.disciplina.strip(), cache_disciplinas
                    )

                if extra:
                    await cur.execute(
                        """
                        INSERT INTO maquina (
                            planta_id, disciplina_id, nombre, codigo,
                            sla_horas, costo_inactividad_minuto
                        )
                        VALUES (
                            %(planta_id)s, %(disciplina_id)s, %(nombre)s, %(codigo)s,
                            %(sla_horas)s, %(costo_inactividad_minuto)s
                        )
                        RETURNING maquina_id
                        """,
                        {
                            "planta_id": planta_id,
                            "disciplina_id": disciplina_id,
                            "nombre": maquina.nombre.strip(),
                            "codigo": maquina.codigo.strip(),
                            "sla_horas": maquina.sla_horas,
                            "costo_inactividad_minuto": maquina.costo_inactividad_minuto,
                        },
                    )
                else:
                    if maquina.sla_horas is not None or maquina.costo_inactividad_minuto is not None:
                        # No se ignora en silencio: el usuario cargó un dato que no se va a
                        # guardar. Mejor decirlo que dejarlo creer que quedó.
                        raise _error_sla_sin_columnas()
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
                        sla_horas=maquina.sla_horas,
                        costo_inactividad_minuto=maquina.costo_inactividad_minuto,
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


# =============================================================================
# Edición de la planta y alta de una máquina suelta (HU-25, CGBIDA-466)
# =============================================================================


async def _planta_de_la_empresa(cur, planta_id: int, empresa_id: int) -> dict:
    """
    Devuelve la planta si pertenece a la empresa de la sesión; si no, 404.

    Se usa `FOR UPDATE` en las escrituras: dos ediciones simultáneas del mismo nombre no
    pueden pasar las dos la comprobación de unicidad.
    """
    await cur.execute(
        """
        SELECT planta_id, empresa_id, nombre, ubicacion
        FROM planta
        WHERE planta_id = %(id)s AND empresa_id = %(empresa)s
        FOR UPDATE
        """,
        {"id": planta_id, "empresa": empresa_id},
    )
    fila = await cur.fetchone()
    if not fila:
        # 404 y no 403: no se confirma si la planta existe en otra empresa.
        raise HTTPException(status_code=404, detail="Planta no encontrada.")
    return fila


@router.patch(
    "/api/plantas/{planta_id}",
    response_model=PlantaActualizada,
    dependencies=[Depends(require_route("plantas"))],
)
async def update_planta(
    planta_id: int,
    payload: PlantaUpdateRequest,
    sesion: dict = Depends(get_sesion_actual),
) -> PlantaActualizada:
    """
    Edita el nombre y/o la ubicación de una planta.

    La unicidad del nombre se comprueba **en Python**: el esquema del repositorio no tiene
    `UNIQUE(empresa_id, nombre)` en `planta` (la migración que la creaba se eliminó por
    decisión del equipo) y `AGENTS.md` prohíbe agregarla. Confiar en una restricción que
    solo existe en algunas bases haría que el 409 dependiera del entorno.
    """
    empresa_id = empresa_obligatoria(sesion)

    cambios: dict[str, object] = {}
    if payload.nombre is not None:
        nombre = payload.nombre.strip()
        if len(nombre) < 2:
            raise HTTPException(status_code=422, detail="El nombre debe tener al menos 2 caracteres.")
        cambios["nombre"] = nombre
    if payload.ubicacion is not None:
        ubicacion = payload.ubicacion.strip()
        cambios["ubicacion"] = ubicacion or None

    try:
        async with transaction() as cur:
            actual = await _planta_de_la_empresa(cur, planta_id, empresa_id)

            if "nombre" in cambios and cambios["nombre"] != actual["nombre"]:
                await cur.execute(
                    """
                    SELECT 1 FROM planta
                    WHERE empresa_id = %(empresa)s
                      AND lower(nombre) = lower(%(nombre)s)
                      AND planta_id <> %(id)s
                    LIMIT 1
                    """,
                    {"empresa": empresa_id, "nombre": cambios["nombre"], "id": planta_id},
                )
                if await cur.fetchone():
                    raise HTTPException(
                        status_code=409,
                        detail=f"Ya existe una planta llamada «{cambios['nombre']}» en tu empresa.",
                    )

            if not cambios:
                # Nada que actualizar: se devuelve el estado actual, sin escribir.
                return PlantaActualizada(
                    planta_id=int(actual["planta_id"]),
                    nombre=str(actual["nombre"]),
                    ubicacion=actual["ubicacion"],
                )

            sets = ", ".join(f"{col} = %({col})s" for col in cambios)
            await cur.execute(
                f"UPDATE planta SET {sets} WHERE planta_id = %(_id)s "
                "RETURNING planta_id, nombre, ubicacion",
                {**cambios, "_id": planta_id},
            )
            fila = await cur.fetchone()
    except pg_errors.ForeignKeyViolation as e:
        raise HTTPException(status_code=409, detail="La empresa de la planta ya no existe.") from e
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.exception("Error al actualizar la planta")
        raise HTTPException(status_code=500, detail="Error interno al actualizar la planta.") from e

    return PlantaActualizada(
        planta_id=int(fila["planta_id"]),
        nombre=str(fila["nombre"]),
        ubicacion=fila["ubicacion"],
    )


@router.post(
    "/api/plantas/{planta_id}/maquinas",
    status_code=201,
    response_model=MaquinaCreada,
    dependencies=[Depends(require_route("plantas"))],
)
async def add_maquina(
    planta_id: int,
    payload: MaquinaNuevaRequest,
    sesion: dict = Depends(get_sesion_actual),
) -> MaquinaCreada:
    """
    Agrega una máquina a una planta existente.

    Resuelve la disciplina igual que el alta masiva (por nombre, contra la empresa: se
    reutiliza o se crea). El código de máquina sí tiene `UNIQUE(planta_id, codigo)` en el
    esquema base, así que ante un duplicado se devuelve 409 con el mensaje del dominio.
    """
    empresa_id = empresa_obligatoria(sesion)
    nombre = payload.nombre.strip()
    codigo = payload.codigo.strip()
    disciplina = (payload.disciplina or "").strip()

    try:
        extra = await _sla_costo_disponibles()
        if not extra and (
            payload.sla_horas is not None or payload.costo_inactividad_minuto is not None
        ):
            raise _error_sla_sin_columnas()

        async with transaction() as cur:
            await _planta_de_la_empresa(cur, planta_id, empresa_id)

            await cur.execute(
                "SELECT 1 FROM maquina WHERE planta_id = %(p)s AND lower(codigo) = lower(%(c)s) LIMIT 1",
                {"p": planta_id, "c": codigo},
            )
            if await cur.fetchone():
                raise HTTPException(
                    status_code=409,
                    detail=f"Ya existe una máquina con el código «{codigo}» en esta planta.",
                )

            disciplina_id: int | None = None
            if disciplina:
                disciplina_id = await _resolver_disciplina(cur, empresa_id, disciplina, {})

            if extra:
                await cur.execute(
                    """
                    INSERT INTO maquina (
                        planta_id, disciplina_id, nombre, codigo,
                        sla_horas, costo_inactividad_minuto
                    )
                    VALUES (
                        %(planta)s, %(disc)s, %(nombre)s, %(codigo)s,
                        %(sla_horas)s, %(costo_inactividad_minuto)s
                    )
                    RETURNING maquina_id
                    """,
                    {
                        "planta": planta_id,
                        "disc": disciplina_id,
                        "nombre": nombre,
                        "codigo": codigo,
                        "sla_horas": payload.sla_horas,
                        "costo_inactividad_minuto": payload.costo_inactividad_minuto,
                    },
                )
            else:
                await cur.execute(
                    """
                    INSERT INTO maquina (planta_id, disciplina_id, nombre, codigo)
                    VALUES (%(planta)s, %(disc)s, %(nombre)s, %(codigo)s)
                    RETURNING maquina_id
                    """,
                    {
                        "planta": planta_id,
                        "disc": disciplina_id,
                        "nombre": nombre,
                        "codigo": codigo,
                    },
                )
            maquina_id = int((await cur.fetchone())["maquina_id"])
    except pg_errors.UniqueViolation as e:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe una máquina con el código «{codigo}» en esta planta.",
        ) from e
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.exception("Error al agregar la máquina")
        raise HTTPException(status_code=500, detail="Error interno al agregar la máquina.") from e

    return MaquinaCreada(
        maquina_id=maquina_id,
        nombre=nombre,
        codigo=codigo,
        disciplina_id=disciplina_id,
        sla_horas=payload.sla_horas,
        costo_inactividad_minuto=payload.costo_inactividad_minuto,
    )





@router.patch(
    "/api/maquinas/{maquina_id}",
    response_model=MaquinaActualizada,
    dependencies=[Depends(require_route("plantas"))],
)
async def update_maquina(
    maquina_id: int,
    payload: MaquinaUpdateRequest,
    sesion: dict = Depends(get_sesion_actual),
) -> MaquinaActualizada:
    """
    Edita una máquina existente: nombre, código, disciplina, SLA y costo de inactividad.

    Multi-empresa: la máquina se resuelve a través de su planta, así que una máquina de otra
    empresa responde 404 (no 403: no se confirma si existe en otro lado).

    El código tiene `UNIQUE (planta_id, codigo)`, así que un choque con OTRA máquina de la
    misma planta devuelve 409. Se comprueba en Python comparando sin distinguir mayúsculas,
    igual que el alta, para que el mensaje sea del dominio.

    `sla_horas` y `costo_inactividad_minuto` pueden no existir todavía en la base: si vienen
    valores y faltan las columnas, se responde 503 con el SQL a correr en vez de ignorarlos.
    Los campos en `None` no se tocan (patch parcial).
    """
    empresa_id = empresa_obligatoria(sesion)

    nombre = payload.nombre.strip() if payload.nombre is not None else None
    codigo = payload.codigo.strip() if payload.codigo is not None else None
    if nombre is not None and not nombre:
        raise HTTPException(status_code=422, detail="El nombre de la máquina no puede quedar vacío.")
    if codigo is not None and not codigo:
        raise HTTPException(status_code=422, detail="El código de la máquina no puede quedar vacío.")

    extra = await _sla_costo_disponibles()
    if not extra and (
        payload.sla_horas is not None or payload.costo_inactividad_minuto is not None
    ):
        raise _error_sla_sin_columnas()

    try:
        async with transaction() as cur:
            await cur.execute(
                """
                SELECT m.maquina_id, m.planta_id, m.nombre, m.codigo, m.disciplina_id
                  FROM maquina m
                  JOIN planta p ON p.planta_id = m.planta_id
                 WHERE m.maquina_id = %(id)s AND p.empresa_id = %(empresa)s
                 FOR UPDATE OF m
                """,
                {"id": maquina_id, "empresa": empresa_id},
            )
            actual = await cur.fetchone()
            if not actual:
                raise HTTPException(status_code=404, detail="Máquina no encontrada.")

            planta_id = int(actual["planta_id"])

            # 409 si el código choca con OTRA máquina de la misma planta.
            if codigo is not None:
                await cur.execute(
                    """
                    SELECT 1 FROM maquina
                     WHERE planta_id = %(p)s AND lower(codigo) = lower(%(c)s)
                       AND maquina_id <> %(id)s
                     LIMIT 1
                    """,
                    {"p": planta_id, "c": codigo, "id": maquina_id},
                )
                if await cur.fetchone():
                    raise HTTPException(
                        status_code=409,
                        detail=f"Ya existe una máquina con el código «{codigo}» en esta planta.",
                    )

            # La disciplina, si viene, tiene que ser de la misma empresa.
            if payload.disciplina_id is not None:
                await cur.execute(
                    "SELECT 1 FROM disciplina WHERE disciplina_id = %(d)s AND empresa_id = %(e)s",
                    {"d": payload.disciplina_id, "e": empresa_id},
                )
                if not await cur.fetchone():
                    raise HTTPException(
                        status_code=422, detail="La disciplina indicada no existe en tu empresa."
                    )

            campos: list[str] = []
            params: dict[str, object] = {"id": maquina_id}
            if nombre is not None:
                campos.append("nombre = %(nombre)s")
                params["nombre"] = nombre
            if codigo is not None:
                campos.append("codigo = %(codigo)s")
                params["codigo"] = codigo
            if payload.disciplina_id is not None:
                campos.append("disciplina_id = %(disciplina_id)s")
                params["disciplina_id"] = payload.disciplina_id
            if extra:
                if payload.sla_horas is not None:
                    campos.append("sla_horas = %(sla_horas)s")
                    params["sla_horas"] = payload.sla_horas
                if payload.costo_inactividad_minuto is not None:
                    campos.append("costo_inactividad_minuto = %(costo_inactividad_minuto)s")
                    params["costo_inactividad_minuto"] = payload.costo_inactividad_minuto

            if campos:
                await cur.execute(
                    f"UPDATE maquina SET {', '.join(campos)} WHERE maquina_id = %(id)s",
                    params,
                )

            columnas_extra = (
                ", sla_horas, costo_inactividad_minuto"
                if extra
                else ", NULL::numeric AS sla_horas, NULL::numeric AS costo_inactividad_minuto"
            )
            await cur.execute(
                f"SELECT maquina_id, planta_id, nombre, codigo, disciplina_id{columnas_extra}"
                " FROM maquina WHERE maquina_id = %(id)s",
                {"id": maquina_id},
            )
            fila = await cur.fetchone()
    except HTTPException:
        raise
    except pg_errors.UniqueViolation as e:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe una máquina con el código «{codigo}» en esta planta.",
        ) from e
    except Exception as e:
        logger.exception("Error al editar la máquina")
        raise HTTPException(status_code=500, detail="Error interno al editar la máquina.") from e

    return MaquinaActualizada(
        maquina_id=int(fila["maquina_id"]),
        planta_id=int(fila["planta_id"]),
        nombre=fila["nombre"],
        codigo=fila["codigo"],
        disciplina_id=fila["disciplina_id"],
        sla_horas=fila["sla_horas"],
        costo_inactividad_minuto=fila["costo_inactividad_minuto"],
    )