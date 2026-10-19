"""Historial sintético de órdenes de trabajo para la demo (CGBIDA-408, HU B / CGBIDA-51).

Genera 24 meses de OTs coherentes por empresa, para que los indicadores del dashboard
tengan base suficiente. Sin dependencias externas: solo `random` de la librería estándar.

**Cómo se borra** (un solo comando, sin ambigüedad):

    DELETE FROM orden_trabajo WHERE numero_ot LIKE 'SYN-%';

**Idempotencia:** la función comprueba el prefijo `SYN-` ANTES de insertar. Correr el seed
dos veces no duplica filas.

**Reproducibilidad:** la semilla del `random` es fija (`SEED`), así que dos ejecuciones
generan exactamente las mismas filas. Sin eso, los tests que contrastan contra la base
cambiarían en cada corrida.

Se puede ejecutar solo:

    uv run python scripts/seed_history.py --force
"""

from __future__ import annotations

import logging
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from barb.core.db import close_pool, open_pool, pool  # noqa: E402

logger = logging.getLogger("barb.seed.history")

PREFIJO = "SYN-HIST-"
SEED = 20261013
MESES = 24

# Ritmo base de OTs por mes y empresa, ANTES de estacionalidad y tendencia.
# La empresa 4 no aparece: no tiene máquinas, así que no puede tener OTs.
RITMO_BASE = {1: 6.0, 2: 2.6, 3: 1.1}

# Estacionalidad mensual: más fallas en invierno (jun-ago) y en enero (parada de planta),
# menos en abril y noviembre. Es lo que justifica generar 24 meses en vez de 12.
FACTOR_MES = {
    1: 1.25, 2: 1.00, 3: 0.95, 4: 0.75, 5: 1.00, 6: 1.40,
    7: 1.40, 8: 1.40, 9: 1.05, 10: 1.00, 11: 0.75, 12: 0.95,
}
# Tendencia: el mantenimiento mejora con el tiempo, para que la tendencia del dashboard
# no salga plana.
TENDENCIA_POR_MES = -0.015
RUIDO = 0.20

TIPOS = ["corrective", "preventive", "predictive", "inspection"]
PESOS_TIPO = [45, 20, 20, 15]
ESTADOS = ["completed", "pending", "assigned", "in_progress", "cancelled", "overdue"]
PESOS_ESTADO = [70, 10, 8, 6, 4, 2]

PRIORIDAD_POR_TIPO = {
    "corrective": (["urgent", "high", "high", "medium"], None),
    "preventive": (["medium", "medium", "low"], None),
    "predictive": (["medium", "high", "low"], None),
    "inspection": (["low", "low", "medium"], None),
}

# Reglas de coherencia por tipo (CGBIDA-408).
# (min, max) de tiempo de reparación y costo en CLP.
REGLAS_TIPO = {
    "corrective": {"costo": (200_000, 3_000_000)},
    "preventive": {"tiempo": (20, 90), "costo": (100_000, 800_000)},
    "predictive": {"tiempo": (20, 90), "costo": (80_000, 900_000)},
    "inspection": {"tiempo": (0, 30), "costo": (30_000, 250_000)},
}

# Bandas de duración para una correctiva COMPLETADA (CGBIDA-408, rediseño).
#
# La distribución anterior (100-500 min para todas) producía dos efectos indeseados en
# la demo: el promedio (~542 min) superaba el supuesto del modelo de negocio (180 min),
# así que el AHORRO PROYECTADO salía negativo; y como el SLA son 1440 min, NINGUNA
# orden lo superaba y el Cumplimiento de SLA salía siempre 100%.
#
# El techo de la banda larga es 1600 y no 2500: cada orden larga aporta ~1500 min al
# promedio, así que un techo alto lo arrastra por encima de los 180 del modelo y el
# ahorro vuelve a ser negativo. Con 1600 sigue superando el SLA (variedad en el KPI)
# pero aporta la mitad. El peso es bajo (2%) porque el ajuste determinístico de más
# abajo garantiza el mínimo en la empresa de la demo.
#
# (peso, min, max)
BANDAS_CORRECTIVA = [
    (88, 30, 90),       # rápidas: lo normal en correctivo
    (10, 90, 350),      # medianas: reparaciones más complejas
    (2, 1460, 1600),    # largas: superan el SLA de 24 h (1440)
]

# Inactividad como múltiplo del tiempo de reparación. Las largas tienen más inactividad.
DOWNTIME_RATIO_POR_TIPO = {
    "corrective": (0.6, 1.0),
    "preventive": (0.3, 1.0),
    "predictive": (0.0, 0.4),
    "inspection": (0.0, 0.0),
}
# Costo por minuto de reparación, para que el costo sea proporcional al tiempo.
COSTO_POR_MINUTO = (2_500, 12_000)
# Tope de la componente variable del costo, para no dispararse en las reparaciones largas.
COSTO_VARIABLE_MAX = 4_000_000

# SLA del sistema, en minutos. Debe coincidir con `settings.sla_target_minutes`.
SLA_MINUTOS = 24 * 60

# --- Ajuste determinístico de demo (CGBIDA-408) -----------------------------
# Solo para la empresa 1, que es la que se muestra en la demo. Las otras empresas se
# rigen por el sorteo natural: si alguna queda sin largas, está bien.
EMPRESA_DEMO = 1
# Rango objetivo de órdenes que superan el SLA en la empresa 1. Ni menos de 2 (el KPI
# de Cumplimiento de SLA quedaría en 100%) ni más de 3 (el promedio correctivo pasaría
# de 180 min y el ahorro proyectado volvería a ser negativo).
LARGAS_MINIMAS_DEMO = 2
LARGAS_MAXIMAS_DEMO = 3
# Duraciones forzadas al PROMOVER una orden a la banda larga (dentro de 1460-1600).
DURACIONES_PROMOVIDAS = (1500, 1550)
# Duraciones forzadas al DEVOLVER una orden larga a la banda media (dentro de 90-350).
DURACIONES_REVERTIDAS = (250, 300)


def _downtime_de(tipo: str, t_min: int, rng: random.Random) -> int:
    lo, hi = DOWNTIME_RATIO_POR_TIPO[tipo]
    return int(t_min * rng.uniform(lo, hi))


def _costo_de(tipo: str, t_min: int, rng: random.Random) -> float:
    """Costo proporcional al tiempo: a más horas, más repuestos y mano de obra."""
    variable = min(t_min * rng.uniform(*COSTO_POR_MINUTO), COSTO_VARIABLE_MAX)
    return round(rng.uniform(*REGLAS_TIPO[tipo]["costo"]) * 0.2 + variable, 2)

# Estados que no han empezado: sin tiempo de reparación y sin costo.
SIN_EMPEZAR = {"pending", "assigned"}

DESCRIPCION = "Historial sintético generado para la demo del dashboard."


def _meses_hacia_atras(hoy: datetime, meses: int) -> list[tuple[int, int]]:
    """Lista de (año, mes) de los últimos `meses`, del más antiguo al más reciente."""
    salida: list[tuple[int, int]] = []
    a, m = hoy.year, hoy.month
    for _ in range(meses):
        salida.append((a, m))
        m -= 1
        if m == 0:
            a, m = a - 1, 12
    return list(reversed(salida))


def _ots_del_mes(base: float, mes: int, indice: int, total_meses: int, rng: random.Random) -> int:
    """Cuántas OTs genera un mes, con estacionalidad, tendencia y ruido."""
    factor = FACTOR_MES[mes] * (1 + TENDENCIA_POR_MES * indice)
    # Sin `max(1, ...)`: un mes puede quedar en 0, y está bien.
    return max(0, round(base * factor * rng.uniform(1 - RUIDO, 1 + RUIDO)))


# =============================================================================
# Ventana reciente (CGBIDA-439)
# =============================================================================
# El historial de 24 meses reparte ~6 OTs por mes para la empresa de la demo, o sea
# 0,2 por día. El gráfico de backlog dibuja los últimos 14 días, así que salía con un
# solo punto: con esa densidad, 13 de los 14 días están vacíos por construcción.
#
# Esta ventana genera actividad diaria sobre los últimos 14 días, que es justo el tramo
# que se mira en el dashboard. El resto del historial no se toca.

VENTANA_DIAS = 14
# OTs creadas ANTES de la ventana que se cierran dentro de ella. Sin este colchón, el
# primer día de la ventana no tendría nada que cerrar y el gráfico arrancaría en cero.
VENTANA_COLCHON_DIAS = 5
VENTANA_MIN_DIA = 5
VENTANA_MAX_DIA = 10
# El ritmo mensual de cada empresa, llevado a OTs por día. La empresa de la demo queda
# en 7,5 por día, que es el centro del rango [5, 10] que pide el gráfico.
FACTOR_VENTANA = 1.25

# Estados posibles de una OT que queda abierta al final de la ventana: trabajo en curso
# de verdad, no "completed" con fecha de cierre nula.
ESTADOS_ABIERTAS = ["pending", "assigned", "in_progress", "overdue"]
PESOS_ABIERTAS = [35, 20, 30, 15]


def _ritmo_ventana(empresa_id: int) -> float:
    """OTs por día en la ventana reciente, derivado del ritmo mensual de la empresa."""
    return RITMO_BASE.get(empresa_id, 0) * FACTOR_VENTANA


def _cantidad_del_dia(ritmo: float, rng: random.Random) -> int:
    """Cuántas OTs crear (o cerrar) un día, escalado al ritmo de la empresa."""
    crudo = rng.randint(VENTANA_MIN_DIA, VENTANA_MAX_DIA)
    # 7,5 es el ritmo de la empresa de la demo: para ella la escala es 1 y el rango
    # queda tal cual [5, 10]. Las otras empresas conservan su proporción.
    return max(1, round(crudo * ritmo / 7.5))


def _ventana_tiempo(tipo: str, rng: random.Random) -> tuple[int, int]:
    """Banda de duración de una OT, con los mismos pesos que el historial."""
    if tipo == "corrective":
        pesos = [b[0] for b in BANDAS_CORRECTIVA]
        _, lo, hi = rng.choices(BANDAS_CORRECTIVA, weights=pesos, k=1)[0]
        return lo, hi
    regla = REGLAS_TIPO[tipo]
    return regla["tiempo"][0], regla["tiempo"][1]


def _ot_abierta(
    datos: dict,
    empresa_id: int,
    creacion: datetime,
    rng: random.Random,
    numero: int,
    turno: dict[int, int],
) -> dict:
    """Crea una OT sin cerrar, repartiendo las máquinas por turno.

    El reparto round-robin es deliberado: con `rng.choice` algunas máquinas quedaban
    casi sin OTs y el ranking mostraba siempre las mismas cuatro o cinco.
    """
    tipo = rng.choices(TIPOS, weights=PESOS_TIPO, k=1)[0]
    maquinas = datos["maquinas"]
    indice = turno.get(empresa_id, 0)
    turno[empresa_id] = indice + 1
    return {
        "numero_ot": f"{PREFIJO}{numero:04d}",
        "maquina_id": maquinas[indice % len(maquinas)],
        "tecnico_id": rng.choice(datos["tecnicos"]),
        "creado_por": datos["creador"],
        "tipo": tipo,
        "priority": rng.choice(PRIORIDAD_POR_TIPO[tipo][0]),
        # Provisional: si no se cierra, al final se le asigna un estado de trabajo abierto.
        "estado": "pending",
        "descripcion_problema": DESCRIPCION,
        "fecha_creacion": creacion,
        "fecha_inicio": None,
        "fecha_cierre": None,
        "fecha_vencimiento": None,
        "tiempo_reparacion_min": None,
        "downtime_minutes": None,
        "costo_estimado": round(rng.uniform(50_000, 500_000), 2),
        "costo_real": None,
        "empresa_id": empresa_id,
    }


def _cerrar(fila: dict, dia: datetime, rng: random.Random) -> None:
    """Cierra la OT en `dia` (o lo antes posible después de su inicio).

    El cierre es `max(día objetivo, inicio + duración)`: una OT creada a las 20:00 no
    puede cerrarse a las 13:00 del mismo día. Cuando la duración empuja el cierre al día
    siguiente, se acepta: es lo que pasa en la realidad y el gráfico lo refleja.
    """
    inicio = fila["fecha_creacion"] + timedelta(hours=rng.randint(1, 12))
    lo, hi = _ventana_tiempo(fila["tipo"], rng)
    t_min = rng.randint(lo, hi)
    objetivo = dia.replace(hour=rng.randint(13, 20), minute=rng.choice([0, 15, 30, 45]))
    fila.update({
        "estado": "completed",
        "fecha_inicio": inicio,
        "fecha_cierre": max(objetivo, inicio + timedelta(minutes=t_min)),
        "tiempo_reparacion_min": t_min,
        "downtime_minutes": _downtime_de(fila["tipo"], t_min, rng),
        "costo_real": _costo_de(fila["tipo"], t_min, rng),
    })


def _generar_ventana_reciente(
    empresas: dict[int, dict],
    hoy: datetime,
    rng: random.Random,
    contador_inicial: int,
) -> tuple[list[dict], int]:
    """Genera el tramo denso de los últimos `VENTANA_DIAS` días.

    Garantiza, para la empresa de la demo, entre 5 y 10 OTs creadas y entre 5 y 10
    cerradas cada día. Las que sobresalen del colchón quedan abiertas: es el trabajo en
    curso real, y además alimenta el banner de estancadas y el indicador de salud.

    Función pura, como `generar_ots`: no toca la base.
    """
    # Se normaliza a medianoche para que dos llamadas el mismo día den lo mismo.
    base = hoy.replace(hour=0, minute=0, second=0, microsecond=0)
    filas: list[dict] = []
    contador = contador_inicial
    turno: dict[int, int] = {}

    for empresa_id, datos in sorted(empresas.items()):
        ritmo = _ritmo_ventana(empresa_id)
        if ritmo <= 0 or not datos["maquinas"] or not datos["tecnicos"]:
            continue

        # Colchón: OTs nacidas antes de la ventana que se cerrarán dentro de ella.
        abiertas: list[dict] = []
        # Todas las de la empresa, cerradas o no: `abiertas` es solo la cola de pendientes.
        todas: list[dict] = []
        for atras in range(VENTANA_DIAS + VENTANA_COLCHON_DIAS, VENTANA_DIAS, -1):
            dia = base - timedelta(days=atras)
            for _ in range(_cantidad_del_dia(ritmo, rng)):
                contador += 1
                creacion = dia.replace(hour=rng.randint(6, 12), minute=rng.choice([0, 15, 30, 45]))
                fila = _ot_abierta(datos, empresa_id, creacion, rng, contador, turno)
                abiertas.append(fila)
                todas.append(fila)

        # La ventana, del día más viejo al más nuevo.
        for atras in range(VENTANA_DIAS - 1, -1, -1):
            dia = base - timedelta(days=atras)

            for _ in range(_cantidad_del_dia(ritmo, rng)):
                contador += 1
                creacion = dia.replace(hour=rng.randint(6, 20), minute=rng.choice([0, 15, 30, 45]))
                fila = _ot_abierta(datos, empresa_id, creacion, rng, contador, turno)
                abiertas.append(fila)
                todas.append(fila)

            # Se cierra lo más viejo primero (FIFO): es el orden real de una cola.
            a_cerrar = min(len(abiertas), _cantidad_del_dia(ritmo, rng))
            for _ in range(a_cerrar):
                _cerrar(abiertas.pop(0), dia, rng)

        # Lo que sobra sigue abierto.
        for fila in abiertas:
            estado = rng.choices(ESTADOS_ABIERTAS, weights=PESOS_ABIERTAS, k=1)[0]
            fila["estado"] = estado
            if estado == "overdue":
                # Atrasada de verdad y sin ambigüedad de zona horaria: la base guarda UTC
                # y el informe de atrasadas cuenta días en `America/Santiago`, así que hay
                # una banda de ±1 día que puede caer en "hoy" para una de las dos. Dos días
                # de piso dejan la diferencia fuera de esa banda.
                fila["fecha_vencimiento"] = base - timedelta(
                    days=rng.randint(2, 25), hours=rng.randint(0, 12)
                )
            else:
                # Suficientemente en el futuro como para no aparecer como atrasada en
                # ninguna de las dos zonas.
                fila["fecha_vencimiento"] = base + timedelta(
                    days=rng.randint(2, 15), hours=rng.randint(0, 12)
                )
            if estado == "in_progress":
                lo, hi = _ventana_tiempo(fila["tipo"], rng)
                t_min = rng.randint(lo, hi)
                fila["fecha_inicio"] = fila["fecha_creacion"] + timedelta(hours=rng.randint(1, 24))
                fila["tiempo_reparacion_min"] = t_min
                fila["downtime_minutes"] = _downtime_de(fila["tipo"], t_min, rng)

        filas.extend(todas)

    return filas, contador


def generar_ots(
    empresas: dict[int, dict],
    hoy: datetime | None = None,
) -> list[dict]:
    """Genera la lista de filas sintéticas. Función pura: no toca la base.

    `empresas` es {empresa_id: {"maquinas": [ids], "tecnicos": [ids], "creador": id}}.
    """
    rng = random.Random(SEED)
    # UTC sin zona, igual que `CURRENT_DATE` en la base. Con `datetime.now()` local, en
    # Chile el "hoy" del seed va tres horas atrás del de la base: pasada las 21:00 el
    # gráfico de backlog dibuja un día más de los que el seed generó, y ese punto sale
    # vacío. Se vio justo al densificar la ventana (CGBIDA-439).
    hoy = hoy or datetime.now(timezone.utc).replace(tzinfo=None)
    meses = _meses_hacia_atras(hoy, MESES)
    filas: list[dict] = []
    contador = 0

    for empresa_id, datos in sorted(empresas.items()):
        if not datos["maquinas"] or not datos["tecnicos"]:
            continue
        base = RITMO_BASE.get(empresa_id, 0)
        if base <= 0:
            continue

        for indice, (anio, mes) in enumerate(meses):
            cantidad = _ots_del_mes(base, mes, indice, len(meses), rng)
            for _ in range(cantidad):
                contador += 1
                tipo = rng.choices(TIPOS, weights=PESOS_TIPO, k=1)[0]
                estado = rng.choices(ESTADOS, weights=PESOS_ESTADO, k=1)[0]
                regla = REGLAS_TIPO[tipo]

                # Día y hora dentro del mes.
                dia = rng.randint(1, 28)
                creacion = datetime(anio, mes, dia, rng.randint(6, 20), rng.choice([0, 15, 30, 45]))

                t_min: int | None = None
                downtime: int | None = 0
                costo: float | None = None
                fecha_cierre = None
                fecha_vencimiento = None
                fecha_inicio = None

                if estado in SIN_EMPEZAR:
                    # No ha empezado: sin tiempo, sin costo, sin cierre.
                    downtime = None
                    if estado in ("pending", "overdue"):
                        fecha_vencimiento = creacion + timedelta(hours=rng.randint(24, 240))
                elif estado == "cancelled":
                    # El trabajo no se hizo: sin costo (coherente con CGBIDA-407).
                    costo = 0
                else:  # in_progress, completed, overdue
                    if tipo == "corrective":
                        # Duración por bandas: la mayoría rápidas, unas pocas que
                        # superan el SLA de 24 h.
                        pesos = [b[0] for b in BANDAS_CORRECTIVA]
                        _, lo, hi = rng.choices(BANDAS_CORRECTIVA, weights=pesos, k=1)[0]
                    else:
                        lo, hi = regla["tiempo"]
                    t_min = rng.randint(lo, hi)
                    downtime = _downtime_de(tipo, t_min, rng)
                    fecha_inicio = creacion + timedelta(hours=rng.randint(1, 24))
                    if estado == "completed":
                        costo = _costo_de(tipo, t_min, rng)
                        fecha_cierre = fecha_inicio + timedelta(minutes=t_min + rng.randint(0, 120))
                    else:
                        fecha_vencimiento = creacion + timedelta(hours=rng.randint(24, 240))

                filas.append({
                    "numero_ot": f"{PREFIJO}{contador:04d}",
                    "maquina_id": rng.choice(datos["maquinas"]),
                    "tecnico_id": rng.choice(datos["tecnicos"]),
                    "creado_por": datos["creador"],
                    "tipo": tipo,
                    "priority": rng.choice(PRIORIDAD_POR_TIPO[tipo][0]),
                    "estado": estado,
                    "descripcion_problema": DESCRIPCION,
                    "fecha_creacion": creacion,
                    "fecha_inicio": fecha_inicio,
                    "fecha_cierre": fecha_cierre,
                    "fecha_vencimiento": fecha_vencimiento,
                    "tiempo_reparacion_min": t_min,
                    "downtime_minutes": downtime,
                    "costo_estimado": round(rng.uniform(50_000, 500_000), 2),
                    "costo_real": costo,
                    # Metadato interno para el ajuste de demo; no es una columna de la tabla.
                    "empresa_id": empresa_id,
                })

    # Tramo denso de los últimos 14 días (CGBIDA-439). Va DESPUÉS del historial mensual
    # y ANTES del ajuste de largas: así el ajuste sigue normalizando la empresa de la demo
    # a 2 o 3 OTs sobre el SLA, sin importar cuántas haya generado la ventana.
    recientes, contador = _generar_ventana_reciente(empresas, hoy, rng, contador)
    filas.extend(recientes)
    _garantizar_largas_de_demo(filas)

    return filas


def _aplicar_duracion(fila: dict, t_min: int, rng: random.Random) -> None:
    """Fija la duración de una fila y recalcula su inactividad, su costo y su cierre.

    Se usa solo desde el ajuste de demo, para que una orden forzada siga siendo
    coherente: `downtime_minutes` proporcional al tiempo y `costo_real` proporcional.
    """
    fila["tiempo_reparacion_min"] = t_min
    fila["downtime_minutes"] = _downtime_de(fila["tipo"], t_min, rng)
    fila["costo_real"] = _costo_de(fila["tipo"], t_min, rng)
    if fila["fecha_inicio"]:
        fila["fecha_cierre"] = fila["fecha_inicio"] + timedelta(minutes=t_min + 30)


def _garantizar_largas_de_demo(filas: list[dict]) -> int:
    """Ajuste de demo (CGBIDA-408): garantiza que la empresa 1 tenga entre
    2 y 3 OTs por encima del SLA para que el KPI "Cumplimiento de SLA" y el
    futuro gráfico de resolución muestren variedad. No es una regla de
    negocio, es calibración del dataset sintético para la demo.

    El rango es [2, 3] y no "al menos 2": con 4 o más órdenes largas el promedio
    correctivo pasa de 180 min y el ahorro proyectado vuelve a ser negativo.

    Es determinístico: si el sorteo ya dejó entre 2 y 3, no hace nada. Si dejó 0 o 1,
    promueve las de mayor duración de la banda media. Si dejó 4 o más, devuelve las
    sobrantes (las de mayor duración de la banda larga) a la banda media.

    Solo afecta a la empresa de la demo. Las demás se rigen por el sorteo natural.
    Devuelve cuántas filas ajustó.
    """
    candidatas = [
        f for f in filas
        if f["empresa_id"] == EMPRESA_DEMO
        and f["tipo"] == "corrective"
        and f["estado"] == "completed"
        and f["tiempo_reparacion_min"] is not None
    ]
    largas = [f for f in candidatas if f["tiempo_reparacion_min"] > SLA_MINUTOS]

    # RNG propio con semilla fija: el ajuste es reproducible y no altera el sorteo previo.
    rng = random.Random(SEED + 1)
    ajustadas = 0

    if len(largas) < LARGAS_MINIMAS_DEMO:
        # Promover: las de mayor duración dentro de la banda media.
        _, lo_media, hi_media = BANDAS_CORRECTIVA[1]
        media = sorted(
            (f for f in candidatas if lo_media <= f["tiempo_reparacion_min"] <= hi_media),
            key=lambda f: f["tiempo_reparacion_min"],
            reverse=True,
        )
        for i, fila in enumerate(media[: LARGAS_MINIMAS_DEMO - len(largas)]):
            _aplicar_duracion(fila, DURACIONES_PROMOVIDAS[i % len(DURACIONES_PROMOVIDAS)], rng)
            ajustadas += 1

    elif len(largas) > LARGAS_MAXIMAS_DEMO:
        # Revertir: las de mayor duración de la banda larga vuelven a la media.
        sobran = sorted(largas, key=lambda f: f["tiempo_reparacion_min"], reverse=True)
        for i, fila in enumerate(sobran[: len(largas) - LARGAS_MAXIMAS_DEMO]):
            _aplicar_duracion(fila, DURACIONES_REVERTIDAS[i % len(DURACIONES_REVERTIDAS)], rng)
            ajustadas += 1

    return ajustadas


SQL_INSERT = """
    INSERT INTO orden_trabajo
      (numero_ot, maquina_id, tecnico_id, creado_por, tipo, priority, estado,
       descripcion_problema, fecha_creacion, fecha_inicio, fecha_cierre,
       fecha_vencimiento, tiempo_reparacion_min, downtime_minutes,
       costo_estimado, costo_real)
    VALUES
      (%(numero_ot)s, %(maquina_id)s, %(tecnico_id)s, %(creado_por)s, %(tipo)s,
       %(priority)s, %(estado)s, %(descripcion_problema)s, %(fecha_creacion)s,
       %(fecha_inicio)s, %(fecha_cierre)s, %(fecha_vencimiento)s,
       %(tiempo_reparacion_min)s, %(downtime_minutes)s, %(costo_estimado)s,
       %(costo_real)s)
"""


async def _cargar_empresas(conn) -> dict[int, dict]:
    """Máquinas, técnicos y creador de cada empresa. Una consulta, no N."""
    async with conn.cursor() as cur:
        await cur.execute("""
            SELECT p.empresa_id, m.maquina_id
            FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
            ORDER BY p.empresa_id, m.maquina_id
            """)
        maquinas: dict[int, list[int]] = {}
        for r in await cur.fetchall():
            maquinas.setdefault(r["empresa_id"], []).append(r["maquina_id"])

        await cur.execute("""
            SELECT empresa_id, usuario_id FROM usuario
            WHERE rol IN ('tecnico', 'supervisor') ORDER BY empresa_id, usuario_id
            """)
        tecnicos: dict[int, list[int]] = {}
        for r in await cur.fetchall():
            tecnicos.setdefault(r["empresa_id"], []).append(r["usuario_id"])

        await cur.execute("""
            SELECT DISTINCT ON (empresa_id) empresa_id, usuario_id FROM usuario
            WHERE rol = 'admin' ORDER BY empresa_id, usuario_id
            """)
        creadores = {r["empresa_id"]: r["usuario_id"] for r in await cur.fetchall()}

    return {
        e: {"maquinas": maquinas.get(e, []), "tecnicos": tecnicos.get(e, []), "creador": creadores[e]}
        for e in maquinas
        if e in creadores and tecnicos.get(e)
    }


async def contar_sinteticas(conn) -> int:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT COUNT(*) AS n FROM orden_trabajo WHERE numero_ot LIKE %(p)s",
            {"p": f"{PREFIJO}%"},
        )
        return int((await cur.fetchone())["n"])


async def poblar_historial(conn, *, forzar: bool = False) -> int:
    """Inserta el historial sintético. Devuelve cuántas filas insertó.

    La comprobación de idempotencia va ANTES de insertar: si ya hay filas con el
    prefijo, no se hace nada (salvo `forzar`, que solo se usa desde la CLI).
    """
    existentes = await contar_sinteticas(conn)
    if existentes and not forzar:
        logger.info("Historial sintético ya presente (%s filas); no se inserta.", existentes)
        return 0
    if existentes and forzar:
        logger.info("--force: se borran las %s filas sintéticas previas.", existentes)
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM orden_trabajo WHERE numero_ot LIKE %(p)s", {"p": f"{PREFIJO}%"}
            )

    empresas = await _cargar_empresas(conn)
    filas = generar_ots(empresas)
    # `empresa_id` es metadato interno del generador, no una columna de la tabla.
    for f in filas:
        f.pop("empresa_id", None)
    async with conn.cursor() as cur:
        await cur.executemany(SQL_INSERT, filas)
    logger.info("Historial sintético insertado: %s filas en %s empresas.", len(filas), len(empresas))
    return len(filas)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    forzar = "--force" in sys.argv
    await open_pool()
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                n = await poblar_historial(conn, forzar=forzar)
        logger.info("Listo. Filas nuevas: %s", n)
    finally:
        await close_pool()


if __name__ == "__main__":
    import asyncio

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
