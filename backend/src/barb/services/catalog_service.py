"""Escrituras del mantenedor, sin HTTP.

El router (`routers/catalog.py`) y las tools de IA comparten estas funciones para que la
validación sea UNA sola: código repetido en la planta (409), máquina de otra empresa
(404), columnas de SLA ausentes (503), disciplina ajena (422). Las funciones lanzan
`DomainError` y cada capa lo traduce: el router a `HTTPException`, las tools de IA a un
mensaje de texto para el usuario.

El cuerpo de `crear_planta_completa` y `actualizar_maquina` es el de los endpoints
originales (HU-25, CGBIDA-464/466), con dos cambios mecánicos: el `empresa_id` llega por
parámetro en vez de `sesion`, y cada `HTTPException` se volvió `DomainError` con el mismo
status y el mismo mensaje.
"""

from __future__ import annotations

import logging

from psycopg import errors as pg_errors

from barb.core.db import transaction
from barb.schemas.plantas import PlantaCompletaCreate

logger = logging.getLogger("barb.catalog_service")


class DomainError(Exception):
    """Error de negocio con el status HTTP que le corresponde.

    El router lo traduce a `HTTPException(status_code, detail)`; las tools de IA lo
    traducen a un mensaje de texto. Lleva el status para que la traducción no pierda el
    código (404 de otra empresa, 409 de código repetido, 503 de columnas ausentes).
    """

    def __init__(self, mensaje: str, status: int = 422) -> None:
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.status = status


def _router():
    """Acceso al router dueño de los helpers del mantenedor.

    TODO(arquitectura): es una dependencia services -> routers invertida y existe porque
    el memo `_sla_costo_disponibles_cache` vive ahí y los tests del mantenedor lo fuerzan
    directamente (`test_maquinas_edicion`, `test_plantas_sla_costo` parchean y leen ese
    global). Cuando esos tests migren a este módulo, este delegado se elimina y los
    helpers bajan acá con `DomainError`.
    """
    from barb.routers import catalog  # noqa: PLC0415 — import tardío: evita el ciclo

    return catalog


async def _sla_costo_disponibles() -> bool:
    """Delega en el memo del router (única fuente de verdad de la detección)."""
    return await _router()._sla_costo_disponibles()


def _error_sla_sin_columnas() -> DomainError:
    """El 503 del router (mismo mensaje y SQL), traducido a `DomainError`."""
    http = _router()._error_sla_sin_columnas()
    return DomainError(http.detail, http.status_code)


async def _resolver_disciplina(cur, empresa_id: int, nombre: str, cache: dict[str, tuple[int, bool, str]]) -> int:
    """Delega en el helper del router (reutiliza o crea la disciplina por nombre)."""
    return await _router()._resolver_disciplina(cur, empresa_id, nombre, cache)


async def crear_planta_completa(empresa_id: int, payload: PlantaCompletaCreate) -> dict:
    """
    Alta transaccional de planta + disciplinas + máquinas (HU-25, CGBIDA-464).

    Si cualquiera de las filas falla —código de máquina repetido, nombre de planta ya
    usado— no queda nada a medias: la planta no existe sin sus máquinas. Las disciplinas
    se resuelven contra la EMPRESA (se reutilizan o se crean, nunca se duplican).
    """
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
        raise DomainError("Hay dos máquinas con el mismo código en la solicitud.", 409)

    cache_disciplinas: dict[str, tuple[int, bool, str]] = {}

    try:
        async with transaction() as cur:
            # Unicidad del nombre en Python: el esquema no tiene UNIQUE(empresa_id, nombre)
            # (la migración que la creaba se eliminó por decisión del equipo) y confiar en
            # una restricción que solo existe en algunas bases haría que el 409 dependiera
            # del entorno. Mismo criterio que el PATCH de planta.
            await cur.execute(
                """
                SELECT 1 FROM planta
                 WHERE empresa_id = %(empresa)s AND lower(nombre) = lower(%(nombre)s)
                 LIMIT 1
                """,
                {"empresa": empresa_id, "nombre": nombre_planta},
            )
            if await cur.fetchone():
                raise DomainError(f"Ya existe una planta llamada «{nombre_planta}» en tu empresa.", 409)

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

            maquinas: list[dict] = []
            extra = await _sla_costo_disponibles()
            for maquina in payload.maquinas:
                disciplina_id: int | None = None
                if maquina.disciplina and maquina.disciplina.strip():
                    disciplina_id = await _resolver_disciplina(cur, empresa_id, maquina.disciplina.strip(), cache_disciplinas)

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
                    {
                        "maquina_id": int((await cur.fetchone())["maquina_id"]),
                        "nombre": maquina.nombre.strip(),
                        "codigo": maquina.codigo.strip(),
                        "disciplina_id": disciplina_id,
                        "sla_horas": maquina.sla_horas,
                        "costo_inactividad_minuto": maquina.costo_inactividad_minuto,
                    }
                )
    except DomainError:
        raise
    except pg_errors.UniqueViolation as e:
        detalle = str(e)
        if "planta_empresa_id_nombre_key" in detalle:
            mensaje = f"Ya existe una planta llamada «{nombre_planta}» en tu empresa."
        elif "maquina_planta_id_codigo_key" in detalle:
            mensaje = "Ya existe una máquina con ese código en la planta."
        else:
            mensaje = "Ya existe un registro con esos datos."
        raise DomainError(mensaje, 409) from e
    except pg_errors.ForeignKeyViolation as e:
        raise DomainError("La empresa o la disciplina indicada ya no existe.", 409) from e
    except Exception as e:
        logger.exception("Error al crear la planta completa")
        raise DomainError("Error interno al crear la planta.", 500) from e

    return {
        "planta_id": planta_id,
        "nombre": nombre_planta,
        "ubicacion": ubicacion,
        "disciplinas": [
            {"disciplina_id": disc_id, "nombre": mostrado, "creada": creada}
            for disc_id, creada, mostrado in cache_disciplinas.values()
        ],
        "maquinas": maquinas,
    }


async def actualizar_maquina(empresa_id: int, maquina_id: int, cambios: dict) -> dict:
    """
    PATCH de una máquina. `cambios` lleva SOLO los campos a tocar (claves del
    `MaquinaUpdateRequest` ya sin `None`): nombre, codigo, disciplina_id, sla_horas,
    costo_inactividad_minuto.

    Multi-empresa: la máquina se resuelve a través de su planta, así que una máquina de
    otra empresa responde 404 (no 403: no se confirma si existe en otro lado). El código
    tiene `UNIQUE (planta_id, codigo)`: un choque con OTRA máquina de la misma planta es
    409, comprobado en Python para que el mensaje sea del dominio. El `FOR UPDATE` evita
    que dos ediciones simultáneas pasen juntas la comprobación.
    """
    nombre = cambios["nombre"].strip() if "nombre" in cambios else None
    codigo = cambios["codigo"].strip() if "codigo" in cambios else None
    if nombre is not None and not nombre:
        raise DomainError("El nombre de la máquina no puede quedar vacío.", 422)
    if codigo is not None and not codigo:
        raise DomainError("El código de la máquina no puede quedar vacío.", 422)

    extra = await _sla_costo_disponibles()
    if not extra and ("sla_horas" in cambios or "costo_inactividad_minuto" in cambios):
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
                raise DomainError("Máquina no encontrada.", 404)

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
                    raise DomainError(
                        f"Ya existe una máquina con el código «{codigo}» en esta planta.",
                        409,
                    )

            # La disciplina, si viene, tiene que ser de la misma empresa.
            if cambios.get("disciplina_id") is not None:
                await cur.execute(
                    "SELECT 1 FROM disciplina WHERE disciplina_id = %(d)s AND empresa_id = %(e)s",
                    {"d": cambios["disciplina_id"], "e": empresa_id},
                )
                if not await cur.fetchone():
                    raise DomainError("La disciplina indicada no existe en tu empresa.", 422)

            campos: list[str] = []
            params: dict[str, object] = {"id": maquina_id}
            if nombre is not None:
                campos.append("nombre = %(nombre)s")
                params["nombre"] = nombre
            if codigo is not None:
                campos.append("codigo = %(codigo)s")
                params["codigo"] = codigo
            if cambios.get("disciplina_id") is not None:
                campos.append("disciplina_id = %(disciplina_id)s")
                params["disciplina_id"] = cambios["disciplina_id"]
            if extra:
                if cambios.get("sla_horas") is not None:
                    campos.append("sla_horas = %(sla_horas)s")
                    params["sla_horas"] = cambios["sla_horas"]
                if cambios.get("costo_inactividad_minuto") is not None:
                    campos.append("costo_inactividad_minuto = %(costo)s")
                    params["costo"] = cambios["costo_inactividad_minuto"]

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
    except DomainError:
        raise
    except pg_errors.UniqueViolation as e:
        raise DomainError(f"Ya existe una máquina con el código «{codigo}» en esta planta.", 409) from e
    except Exception as e:
        logger.exception("Error al editar la máquina")
        raise DomainError("Error interno al editar la máquina.", 500) from e

    return {
        "maquina_id": int(fila["maquina_id"]),
        "planta_id": int(fila["planta_id"]),
        "nombre": fila["nombre"],
        "codigo": fila["codigo"],
        "disciplina_id": fila["disciplina_id"],
        "sla_horas": fila["sla_horas"],
        "costo_inactividad_minuto": fila["costo_inactividad_minuto"],
    }
