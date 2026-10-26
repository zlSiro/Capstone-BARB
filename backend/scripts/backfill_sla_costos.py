"""Poblar SLA y costo de inactividad por máquina, y recalcular vencimientos de OTs.

Dos pasos, ambos de DATOS (no de esquema):

1. `maquina.sla_horas` y `maquina.costo_inactividad_minuto` para todas las máquinas, con
   una clasificación por criticidad basada en el nombre/código. Antes de este script todas
   las máquinas tenían NULL y los KPIs caían al valor global de la empresa.
2. `orden_trabajo.fecha_vencimiento` para las OTs históricas (las que se crearon antes de
   que el alta calculara el plazo). Se usa la misma fórmula que la aplicación:

       fecha_vencimiento = fecha_creacion + sla_horas * factor(prioridad)

   con los factores urgent 0.5, high 0.75, medium 1.0, low 1.5.

Se ejecuta con `--dry-run` para ver el plan sin tocar nada, y con `--apply` para aplicarlo.
El dry-run es la opción por defecto: un backfill destructivo no debería correr por descuido.

    python scripts/backfill_sla_costos.py              # muestra el plan
    python scripts/backfill_sla_costos.py --apply      # aplica

Idempotente: solo escribe SLA/costo donde hay NULL o donde el valor calculado difiere, y
solo calcula vencimientos que estén en NULL. Correrlo dos veces no cambia nada.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from barb.core.config import settings  # noqa: E402
from barb.core.db import close_pool, open_pool, pool  # noqa: E402
from barb.routers.work_orders import SLA_POR_PRIORIDAD  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("backfill_sla")

# ---------------------------------------------------------------------------
# Clasificación de criticidad
# ---------------------------------------------------------------------------
# Se usa el nombre y el código (no la disciplina): "Mecánica" agrupa un compresor y una
# bomba, que no valen lo mismo parados. Los términos son los que distinguen un equipo que
# detiene la línea de uno que puede esperar al próximo turno.
TERMINOS_CRITICOS = (
    "compressor",
    "compresor",
    "plc",
    "chiller",
    "chancador",
    "molino",
    "prensa",
    "press",
    "subestacion",
    "correa",
    "overland",
    "triturad",
    "caldera",
)

# Rangos pedidos: críticas SLA 8-12 h y costo 2000-5000; no críticas SLA 24-48 h y costo
# 500-1000. Dentro de cada rango el valor varía de forma determinista con el id, para que
# el tablero no muestre 22 autos idénticos y el resultado sea reproducible.
SLA_CRITICO_BASE = 8
SLA_CRITICO_PASO = 1
COSTO_CRITICO_BASE = 2000
COSTO_CRITICO_PASO = 1000

SLA_NORMAL_BASE = 24
SLA_NORMAL_PASO = 6
COSTO_NORMAL_BASE = 500
COSTO_NORMAL_PASO = 250


def _es_critica(nombre: str, codigo: str) -> bool:
    texto = f"{nombre} {codigo}".lower()
    # Sin acentos: "subestación" tiene que matchear "subestacion".
    normalizado = (
        texto.replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
    )
    return any(termino in normalizado for termino in TERMINOS_CRITICOS)


def _valores(maquina_id: int, nombre: str, codigo: str) -> tuple[float, float]:
    """(sla_horas, costo_inactividad_minuto) deterministas para una máquina."""
    if _es_critica(nombre, codigo):
        sla = SLA_CRITICO_BASE + (maquina_id % 5) * SLA_CRITICO_PASO      # 8..12
        costo = COSTO_CRITICO_BASE + (maquina_id % 4) * COSTO_CRITICO_PASO  # 2000..5000
    else:
        sla = SLA_NORMAL_BASE + (maquina_id % 5) * SLA_NORMAL_PASO        # 24..48
        costo = COSTO_NORMAL_BASE + (maquina_id % 3) * COSTO_NORMAL_PASO  # 500..1000
    return float(sla), float(costo)


# ---------------------------------------------------------------------------
# Pasos
# ---------------------------------------------------------------------------


async def _maquinas() -> list[dict]:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT maquina_id, nombre, codigo, sla_horas, costo_inactividad_minuto "
                "FROM maquina ORDER BY maquina_id"
            )
            return await cur.fetchall()


async def poblar_maquinas(aplicar: bool) -> int:
    """Asigna SLA y costo a cada máquina. Devuelve cuántas filas cambiarían/cambiaron."""
    filas = await _maquinas()
    plan: list[tuple[int, str, float, float, bool]] = []

    for fila in filas:
        sla, costo = _valores(int(fila["maquina_id"]), fila["nombre"], fila["codigo"])
        critica = _es_critica(fila["nombre"], fila["codigo"])
        ya_igual = (
            fila["sla_horas"] is not None
            and fila["costo_inactividad_minuto"] is not None
            and abs(float(fila["sla_horas"]) - sla) < 0.01
            and abs(float(fila["costo_inactividad_minuto"]) - costo) < 0.01
        )
        # `conservada` = ya tiene ambos valores (cargados a mano desde la UI): no se pisa.
        plan.append(
            (
                int(fila["maquina_id"]),
                fila["nombre"],
                sla,
                costo,
                critica,
                fila["sla_horas"] is not None and fila["costo_inactividad_minuto"] is not None,
            )
        )

    print(f"\n  Maquinas: {len(plan)}")
    print(f"  {'id':>4}  {'critica':<7} {'SLA h':>6} {'costo/min':>9}  nombre")
    for maquina_id, nombre, sla, costo, critica, conservada in plan:
        estado = "conservada" if conservada else ("critica" if critica else "normal")
        print(
            f"  {maquina_id:>4}  {estado:<10} {sla:>6.0f} {costo:>9.0f}  {nombre[:34]}"
        )

    if not aplicar:
        print("\n  [dry-run] no se escribio nada. Usa --apply para aplicarlo.")
        return len(plan)

    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                for maquina_id, _nombre, sla, costo, _c, _conservada in plan:
                    await cur.execute(
                        """
                        UPDATE maquina
                           SET sla_horas = COALESCE(sla_horas, %(sla)s),
                               costo_inactividad_minuto = COALESCE(costo_inactividad_minuto, %(costo)s)
                         WHERE maquina_id = %(id)s
                           AND (sla_horas IS NULL OR costo_inactividad_minuto IS NULL)
                        """,
                        {"id": maquina_id, "sla": sla, "costo": costo},
                    )
    escritas = sum(1 for p in plan if not p[5])
    print(f"\n  [OK] maquinas actualizadas: {escritas} (conservadas: {len(plan) - escritas})")
    return escritas


async def recalcular_vencimientos(aplicar: bool) -> tuple[int, int]:
    """
    Calcula `fecha_vencimiento` de las OTs que no la tienen.

    Devuelve (candidatas, actualizadas). Solo mira OTs no canceladas y sin vencimiento: las
    canceladas no se van a atender, y las que ya tienen fecha la conservan (pudo haberse
    fijado a mano).
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT COUNT(*) AS n
                  FROM orden_trabajo ot
                  JOIN maquina m ON m.maquina_id = ot.maquina_id
                 WHERE ot.fecha_vencimiento IS NULL
                   AND ot.estado <> 'cancelled'
                """
            )
            candidatas = int((await cur.fetchone())["n"])

    print(f"\n  OTs sin vencimiento (no canceladas, con SLA de maquina): {candidatas}")

    if not aplicar:
        print("  [dry-run] no se escribio nada.")
        return candidatas, 0

    factores = " ".join(
        f"WHEN '{prioridad}' THEN {factor}" for prioridad, factor in SLA_POR_PRIORIDAD.items()
    )
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await cur.execute(
                    f"""
                    UPDATE orden_trabajo ot
                       SET fecha_vencimiento = ot.fecha_creacion + make_interval(
                               mins => ROUND(
                                   m.sla_horas * 60 * (CASE ot.priority::text {factores} ELSE 1.0 END)
                               )::int
                           )
                      FROM maquina m
                     WHERE m.maquina_id = ot.maquina_id
                       AND ot.fecha_vencimiento IS NULL
                       AND ot.estado <> 'cancelled'
                       AND m.sla_horas IS NOT NULL
                    """
                )
                actualizadas = cur.rowcount or 0
    print(f"  [OK] OTs actualizadas: {actualizadas}")
    return candidatas, actualizadas


async def muestra() -> None:
    """Muestra las máquinas y cinco OTs recalculadas, para verificar a ojo."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT m.maquina_id, m.nombre, m.sla_horas, m.costo_inactividad_minuto
                  FROM maquina m ORDER BY m.sla_horas NULLS LAST, m.maquina_id LIMIT 6
                """
            )
            print("\n  Muestra de maquinas (las de menor SLA):")
            for f in await cur.fetchall():
                print(
                    f"    {f['nombre'][:32]:<32} SLA={f['sla_horas']} h  "
                    f"costo={f['costo_inactividad_minuto']}/min"
                )

            await cur.execute(
                """
                SELECT ot.numero_ot, ot.priority, ot.fecha_creacion, ot.fecha_vencimiento,
                       m.nombre AS maquina, m.sla_horas,
                       EXTRACT(EPOCH FROM (ot.fecha_vencimiento - ot.fecha_creacion)) / 3600 AS horas
                  FROM orden_trabajo ot
                  JOIN maquina m ON m.maquina_id = ot.maquina_id
                 WHERE ot.fecha_vencimiento IS NOT NULL
                 ORDER BY ot.ot_id DESC LIMIT 5
                """
            )
            print("\n  Muestra de OTs calculadas:")
            print("    numero_ot      prioridad  maquina            SLA   plazo(h)  vence")
            for f in await cur.fetchall():
                print(
                    f"    {f['numero_ot']:<14} {f['priority']:<10} {f['maquina'][:18]:<18} "
                    f"{f['sla_horas']:>4.0f}  {float(f['horas']):>7.2f}  "
                    f"{f['fecha_vencimiento']:%Y-%m-%d %H:%M}"
                )


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="aplica los cambios (por defecto solo muestra el plan)")
    args = parser.parse_args()

    print(f"  Base: {settings.database_url.split('@')[-1]}")
    print(f"  Modo: {'APLICAR' if args.apply else 'dry-run'}")

    await open_pool()
    try:
        await poblar_maquinas(args.apply)
        candidatas, actualizadas = await recalcular_vencimientos(args.apply)
        if args.apply:
            await muestra()
        else:
            print(f"\n  Se calcularian {candidatas} vencimientos al aplicar.")
    finally:
        await close_pool()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
