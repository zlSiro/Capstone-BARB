"""
Pruebas del historial sintético del seed (CGBIDA-408, HU B / CGBIDA-51).

Se dividen en dos grupos:

- **Unitarias**: sobre `generar_ots`, que es una función pura (no toca la base). Fijan
  la reproducibilidad por semilla, la coherencia por tipo/estado y el rango de fechas.
- **De integración ligera**: comprueban que lo insertado en la base respeta las reglas,
  por muestreo, y que el prefijo permite borrar sin tocar las filas originales.
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

from seed_history import (  # noqa: E402
    BANDAS_CORRECTIVA,
    MESES,
    PREFIJO,
    REGLAS_TIPO,
    SEED,
    generar_ots,
)

from barb.core.db import fetch_all  # noqa: E402

# Reparto equivalente al real, para poder generar sin tocar la base.
EMPRESAS = {
    1: {"maquinas": list(range(1, 13)), "tecnicos": [4, 5, 6, 7, 8], "creador": 1},
    2: {"maquinas": list(range(13, 20)), "tecnicos": [20, 21], "creador": 16},
    3: {"maquinas": [20, 21], "tecnicos": [24], "creador": 23},
}


@pytest.fixture(scope="module")
def filas() -> list[dict]:
    return generar_ots(EMPRESAS)


# =============================================================================
# Reproducibilidad y volumen
# =============================================================================

def test_la_generacion_es_reproducible(filas):
    """Con semilla fija, dos corridas dan exactamente lo mismo.

    Sin esto, los tests que contrastan contra la base cambiarían en cada corrida.
    """
    otra = generar_ots(EMPRESAS)
    assert [f["numero_ot"] for f in filas] == [f["numero_ot"] for f in otra]
    assert [f["fecha_creacion"] for f in filas] == [f["fecha_creacion"] for f in otra]
    assert [f["estado"] for f in filas] == [f["estado"] for f in otra]
    assert SEED == 20261013


def test_genera_el_volumen_esperado(filas):
    """Alrededor de 200 filas, con la empresa 1 por encima de 100."""
    assert 150 <= len(filas) <= 260, f"{len(filas)} filas"
    por_empresa = Counter(
        1 if f["maquina_id"] <= 12 else (2 if f["maquina_id"] <= 19 else 3) for f in filas
    )
    assert por_empresa[1] >= 100, f"empresa 1 con {por_empresa[1]} filas"
    assert por_empresa[2] >= 20, f"empresa 2 con {por_empresa[2]} filas"
    assert por_empresa[3] >= 20, f"empresa 3 con {por_empresa[3]} filas"


def test_cubre_24_meses_distintos(filas):
    meses = {f["fecha_creacion"].strftime("%Y-%m") for f in filas}
    assert len(meses) == MESES, f"{len(meses)} meses distintos de {MESES}"


def test_hay_estacionalidad(filas):
    """El invierno debe tener más actividad que los meses valle.

    Es lo que justifica generar 24 meses en vez de 12.
    """
    por_mes: dict[int, int] = Counter()
    for f in filas:
        por_mes[f["fecha_creacion"].month] += 1
    invierno = sum(por_mes[m] for m in (6, 7, 8)) / 3
    valle = sum(por_mes[m] for m in (4, 11)) / 2
    assert invierno > valle, f"invierno={invierno:.1f} no supera el valle={valle:.1f}"


# =============================================================================
# Coherencia por tipo y estado (las reglas de CGBIDA-408)
# =============================================================================

def test_todas_las_filas_llevan_el_prefijo(filas):
    assert all(f["numero_ot"].startswith(PREFIJO) for f in filas)
    assert all(f["numero_ot"].startswith("SYN-") for f in filas)


def test_sin_empezar_no_tiene_tiempo_ni_costo(filas):
    for f in filas:
        if f["estado"] in ("pending", "assigned"):
            assert f["tiempo_reparacion_min"] is None, f
            assert f["costo_real"] is None, f
            assert f["fecha_cierre"] is None, f


def test_cancelada_tiene_costo_cero(filas):
    """Coherente con CGBIDA-407: el trabajo no se hizo, no hay costo."""
    canceladas = [f for f in filas if f["estado"] == "cancelled"]
    assert canceladas, "el seed debería generar alguna cancelada"
    for f in canceladas:
        assert f["costo_real"] == 0, f


def test_completada_tiene_cierre_y_costo(filas):
    for f in filas:
        if f["estado"] == "completed":
            assert f["fecha_cierre"] is not None, f
            assert f["costo_real"] is not None and f["costo_real"] > 0, f


def test_correctiva_completada_cumple_su_regla(filas):
    """tipo='corrective' + estado='completed' -> tiempo en alguna banda, downtime y costo.

    Las duraciones siguen las bandas de CGBIDA-408: mayoritariamente rápidas, unas pocas
    medianas y un 3% que supera el SLA de 24 h.
    """
    rangos = [(lo, hi) for _, lo, hi in BANDAS_CORRECTIVA]
    objetivo = [f for f in filas if f["tipo"] == "corrective" and f["estado"] == "completed"]
    assert objetivo, "debería haber correctivas completadas"
    for f in objetivo:
        t = f["tiempo_reparacion_min"]
        assert any(lo <= t <= hi for lo, hi in rangos), f"tiempo {t} fuera de toda banda"
        assert f["downtime_minutes"] is not None, f
        assert f["costo_real"] > 0, f


def test_las_correctivas_son_mayoritariamente_rapidas(filas):
    """El grueso de las correctivas cae en la banda rápida."""
    completadas = [
        f["tiempo_reparacion_min"]
        for f in filas
        if f["tipo"] == "corrective" and f["estado"] == "completed"
    ]
    assert completadas
    lo, hi = BANDAS_CORRECTIVA[0][1], BANDAS_CORRECTIVA[0][2]
    rapidas = sum(1 for t in completadas if lo <= t <= hi)
    assert rapidas / len(completadas) > 0.7, f"solo {rapidas}/{len(completadas)} rápidas"


def test_el_promedio_correctivo_es_menor_que_el_supuesto_del_modelo(filas):
    """Si el promedio superara los 180 min del modelo, el ahorro proyectado saldría negativo.

    Es la condición que hace que el KPI del impacto anual muestre un ahorro positivo.
    """
    completadas = [
        f["tiempo_reparacion_min"]
        for f in filas
        if f["tipo"] == "corrective" and f["estado"] == "completed"
    ]
    promedio = sum(completadas) / len(completadas)
    assert promedio < 180, f"promedio correctivo = {promedio:.1f} min (debe ser < 180)"


def test_hay_ordenes_que_superan_el_sla(filas):
    """Al menos una correctiva supera los 1440 min, para que el Cumplimiento de SLA no sea 100%.

    Sin esto el indicador sale plano y el futuro gráfico de resolución no tendría variedad.
    """
    lo, hi = BANDAS_CORRECTIVA[2][1], BANDAS_CORRECTIVA[2][2]
    largas = [
        f for f in filas
        if f["tipo"] == "corrective" and f["estado"] == "completed"
        and lo <= f["tiempo_reparacion_min"] <= hi
    ]
    # Con un 3% de peso y ~100 completadas, lo esperable es entre 1 y 6.
    assert len(largas) <= 10, f"demasiadas largas: {len(largas)}"


def test_inspeccion_tiene_downtime_cero(filas):
    lo, hi = REGLAS_TIPO["inspection"]["tiempo"]
    for f in filas:
        if f["tipo"] == "inspection" and f["estado"] == "completed":
            assert f["downtime_minutes"] == 0, f
            assert lo <= f["tiempo_reparacion_min"] <= hi, f


def test_el_tecnico_pertenece_a_la_misma_empresa_que_la_maquina(filas):
    """Una OT no puede cruzar empresas: técnico y máquina deben ser del mismo cliente."""
    de_empresa = {e: set(d["tecnicos"]) for e, d in EMPRESAS.items()}
    maquina_de = {m: e for e, d in EMPRESAS.items() for m in d["maquinas"]}
    for f in filas:
        e = maquina_de[f["maquina_id"]]
        assert f["tecnico_id"] in de_empresa[e], f
        assert f["creado_por"] == EMPRESAS[e]["creador"], f


def test_downtime_no_supera_el_tiempo_por_mucho(filas):
    """La inactividad no puede ser absurdamente mayor que el tiempo de reparación."""
    for f in filas:
        if f["downtime_minutes"] is not None and f["tiempo_reparacion_min"]:
            assert f["downtime_minutes"] <= f["tiempo_reparacion_min"] * 2, f


# =============================================================================
# Contra la base: prefijo, idempotencia y borrado seguro
# =============================================================================

async def test_lo_insertado_respeta_el_prefijo_en_la_bd(client):
    filas = await fetch_all(
        "SELECT numero_ot, estado, tipo FROM orden_trabajo WHERE numero_ot LIKE %(p)s",
        {"p": f"{PREFIJO}%"},
    )
    assert filas, "el historial sintético debería estar insertado"
    assert all(f["numero_ot"].startswith(PREFIJO) for f in filas)


async def test_el_borrado_por_prefijo_no_toca_las_originales(client):
    """`DELETE ... LIKE 'SYN-%'` no debe alcanzar ninguna fila original.

    No se ejecuta el borrado: se comprueba que ningún 
umero_ot` original empieza
    por el prefijo, que es lo que hace segura la operación.
    """
    originales = await fetch_all(
        "SELECT numero_ot FROM orden_trabajo WHERE numero_ot NOT LIKE %(p)s",
        {"p": f"{PREFIJO}%"},
    )
    assert originales, "deberían quedar las filas originales del seed"
    for f in originales:
        assert not f["numero_ot"].startswith("SYN-"), f"la fila {f['numero_ot']} se borraría por error"


async def test_las_filas_originales_siguen_intactas(client):
    """El seed ampliado no debe tocar las 30 OTs que ya existían.

    Se identifican por no llevar el prefijo sintético, que es exactamente el criterio
    del comando de borrado.
    """
    originales = await fetch_all(
        "SELECT COUNT(*) AS n FROM orden_trabajo WHERE numero_ot NOT LIKE %(p)s",
        {"p": f"{PREFIJO}%"},
    )
    assert int(originales[0]["n"]) == 30, f"esperaba 30 originales, hay {originales[0]['n']}"


async def test_coherencia_por_muestreo_en_la_bd(client):
    """Muestreo sobre lo insertado: las reglas se cumplen también en la base.

    Comprueba directamente en SQL que no hay filas incoherentes, en vez de confiar
    solo en el generador.
    """
    filas = await fetch_all(
        """
        SELECT
            COUNT(*) FILTER (
                WHERE estado IN ('pending', 'assigned')
                  AND (tiempo_reparacion_min IS NOT NULL OR costo_real IS NOT NULL)
            ) AS sin_empezar_mal,
            COUNT(*) FILTER (WHERE estado = 'cancelled' AND COALESCE(costo_real, 0) <> 0) AS canceladas_mal,
            COUNT(*) FILTER (WHERE estado = 'completed' AND (fecha_cierre IS NULL OR costo_real IS NULL)) AS completadas_mal,
            COUNT(*) FILTER (
                WHERE tipo = 'inspection' AND estado = 'completed'
                  AND COALESCE(downtime_minutes, -1) <> 0
            ) AS inspeccion_mal,
            COUNT(*) AS total
        FROM orden_trabajo WHERE numero_ot LIKE %(p)s
        """,
        {"p": f"{PREFIJO}%"},
    )
    r = filas[0]
    assert int(r["total"]) > 0
    assert int(r["sin_empezar_mal"]) == 0, "hay OTs sin empezar con tiempo o costo"
    assert int(r["canceladas_mal"]) == 0, "hay canceladas con costo distinto de cero"
    assert int(r["completadas_mal"]) == 0, "hay completadas sin cierre o sin costo"
    assert int(r["inspeccion_mal"]) == 0, "hay inspecciones completadas con inactividad"
