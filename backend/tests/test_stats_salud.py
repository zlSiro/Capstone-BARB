"""
Tests del Índice de Salud Operacional (CGBIDA-438).

El índice combina tres señales con umbrales industriales:
  - SLA: verde >= 95 %, rojo < 85 %.
  - MTBF: verde >= 730 h, rojo < 365 h.
  - Backlog: verde <= 4 semanas, rojo > 8 semanas.

Se prueban dos cosas distintas y por separado:

1. **La aritmética**, con funciones puras: así los umbrales se pueden mover sin reescribir
   los tests, y un fallo dice exactamente qué regla se rompió.
2. **El contrato del endpoint**, para que el frontend reciba siempre la misma forma.

La regla que más importa y que está blindada aquí: **sin datos NO se pinta verde**. Un
semáforo que no puede medir no debe tranquilizar a nadie.
"""

from __future__ import annotations

import pytest

from barb.routers.stats import (
    AMARILLO,
    INSUFICIENTE,
    ROJO,
    SALUD_BACKLOG_ROJO_SEM,
    SALUD_BACKLOG_VERDE_SEM,
    SALUD_MTBF_ROJO_H,
    SALUD_MTBF_VERDE_H,
    SALUD_SLA_ROJO,
    SALUD_SLA_VERDE,
    VERDE,
    _estado_por_umbral,
    _salud_operacional,
    _score_backlog,
    _score_mtbf,
    _score_sla,
    _semanas_backlog,
)

ADMIN_E1 = ("admin@barb.com", "admin123")
RUTA = "/api/stats/financial-impact"


# =============================================================================
# Semanas de backlog
# =============================================================================

class TestSemanasDeBacklog:
    """backlog_semanas = OTs abiertas / ritmo de cierre semanal del período."""

    def test_un_anio_con_un_cierre_por_semana_da_las_semanas_del_anio(self):
        # 365 dias son 52,14 semanas (no 52 exactas), asi que una OT cerrada por semana
        # deja 52 abiertas en 52,1 semanas. El 52,1 es correcto, no un redondeo sucio.
        assert _semanas_backlog(abiertas=52, completadas=52, dias_periodo=365) == 52.1

    def test_dos_cierres_por_semana_reducen_el_backlog_a_la_mitad(self):
        # 104 cierres en 52 semanas = 2 por semana; 20 abiertas -> 10 semanas.
        assert _semanas_backlog(abiertas=20, completadas=104, dias_periodo=365) == 10.0

    def test_sin_cierres_no_se_puede_estimar(self):
        # Devolver infinito rompería el JSON y el umbral; None es honesto.
        assert _semanas_backlog(abiertas=10, completadas=0, dias_periodo=365) is None

    def test_periodo_invalido_no_divide_por_cero(self):
        assert _semanas_backlog(abiertas=10, completadas=5, dias_periodo=0) is None

    def test_sin_backlog_son_cero_semanas(self):
        assert _semanas_backlog(abiertas=0, completadas=87, dias_periodo=365) == 0.0


# =============================================================================
# Umbrales
# =============================================================================

class TestUmbrales:
    """Los cortes son inclusivos en verde y exclusivos en rojo, como se documentó."""

    @pytest.mark.parametrize(
        ("valor", "esperado"),
        [
            (SALUD_SLA_VERDE, VERDE),
            (99.9, VERDE),
            (94.9, AMARILLO),
            (SALUD_SLA_ROJO, AMARILLO),
            (84.9, ROJO),
            (0.0, ROJO),
        ],
    )
    def test_sla_mayor_es_mejor(self, valor, esperado):
        assert _estado_por_umbral(valor, SALUD_SLA_VERDE, SALUD_SLA_ROJO, True) == esperado

    @pytest.mark.parametrize(
        ("valor", "esperado"),
        [
            (SALUD_MTBF_VERDE_H, VERDE),
            (1000.0, VERDE),
            (500.0, AMARILLO),
            (SALUD_MTBF_ROJO_H, AMARILLO),
            (364.9, ROJO),
        ],
    )
    def test_mtbf_mayor_es_mejor(self, valor, esperado):
        assert (
            _estado_por_umbral(valor, SALUD_MTBF_VERDE_H, SALUD_MTBF_ROJO_H, True) == esperado
        )

    @pytest.mark.parametrize(
        ("valor", "esperado"),
        [
            (0.0, VERDE),
            (SALUD_BACKLOG_VERDE_SEM, VERDE),
            (6.0, AMARILLO),
            (SALUD_BACKLOG_ROJO_SEM, AMARILLO),
            (8.1, ROJO),
            (40.0, ROJO),
        ],
    )
    def test_backlog_menor_es_mejor(self, valor, esperado):
        assert (
            _estado_por_umbral(valor, SALUD_BACKLOG_VERDE_SEM, SALUD_BACKLOG_ROJO_SEM, False)
            == esperado
        )


# =============================================================================
# Scores
# =============================================================================

class TestScores:
    def test_el_sla_ya_es_un_porcentaje(self):
        assert _score_sla(97.7) == 97.7
        assert _score_sla(120.0) == 100.0
        assert _score_sla(-5.0) == 0.0

    def test_el_mtbf_satisface_su_umbral_verde(self):
        assert _score_mtbf(SALUD_MTBF_VERDE_H) == 100.0

    def test_el_umbral_rojo_de_mtbf_puntua_50(self):
        # Es la propiedad que hace la escala interpretable: 365 h está a mitad de camino.
        assert _score_mtbf(SALUD_MTBF_ROJO_H) == 50.0

    def test_el_backlog_en_su_umbral_verde_puntua_100(self):
        assert _score_backlog(SALUD_BACKLOG_VERDE_SEM) == 100.0

    def test_el_backlog_en_su_umbral_rojo_puntua_0(self):
        assert _score_backlog(SALUD_BACKLOG_ROJO_SEM) == 0.0


# =============================================================================
# Índice compuesto
# =============================================================================

def _salud(sla=97.7, mtbf=800.0, abiertas=10, completadas=104, dias=365):
    return _salud_operacional(
        sla=sla, mtbf_horas=mtbf, abiertas=abiertas, completadas=completadas, dias_periodo=dias
    )


class TestIndiceCompuesto:
    def test_tres_verdes_dan_estado_verde(self):
        s = _salud(sla=99.0, mtbf=1000.0, abiertas=0)
        assert s["estado"] == VERDE
        assert s["componentes"]["sla"]["estado"] == VERDE
        assert s["componentes"]["mtbf"]["estado"] == VERDE
        assert s["componentes"]["backlog"]["estado"] == VERDE

    def test_una_senal_critica_hace_critico_el_conjunto(self):
        # SLA perfecto y backlog vacío, pero MTBF de 200 h: la planta es crítica.
        s = _salud(sla=100.0, mtbf=200.0, abiertas=0)
        assert s["componentes"]["sla"]["estado"] == VERDE
        assert s["componentes"]["mtbf"]["estado"] == ROJO
        assert s["estado"] == ROJO

    def test_un_ambar_sin_rojos_da_atencion(self):
        s = _salud(sla=90.0, mtbf=1000.0, abiertas=0)
        assert s["componentes"]["sla"]["estado"] == AMARILLO
        assert s["estado"] == AMARILLO

    def test_el_indice_es_la_media_de_los_tres_scores(self):
        s = _salud(sla=90.0, mtbf=730.0, abiertas=0)
        esperado = round((90.0 + 100.0 + 100.0) / 3, 1)
        assert s["indice"] == esperado

    def test_sin_mtbf_el_estado_es_insuficiente_y_no_verde(self):
        # Es la regla central: un rango corto no puede producir un semáforo tranquilizador.
        s = _salud(mtbf=None)
        assert s["estado"] == INSUFICIENTE
        assert s["indice"] is None
        assert s["componentes"]["mtbf"]["estado"] == INSUFICIENTE
        assert s["componentes"]["mtbf"]["valor"] is None

    def test_sin_cierres_el_backlog_no_se_puede_estimar(self):
        s = _salud(completadas=0)
        assert s["componentes"]["backlog"]["estado"] == INSUFICIENTE
        assert s["estado"] == INSUFICIENTE
        assert s["indice"] is None

    def test_los_componentes_siempre_traen_valor_estado_y_score(self):
        s = _salud()
        for nombre in ("sla", "mtbf", "backlog"):
            assert set(s["componentes"][nombre]) == {"valor", "estado", "score"}, nombre


# =============================================================================
# Contrato del endpoint
# =============================================================================

async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _stats(client, qs: str = "") -> dict:
    h = await _login(client, ADMIN_E1)
    r = await client.get(f"{RUTA}{qs}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_el_endpoint_devuelve_salud_operacional(client):
    d = await _stats(client)
    s = d["salud_operacional"]
    assert set(s) == {"indice", "estado", "componentes"}, sorted(s)
    assert set(s["componentes"]) == {"sla", "mtbf", "backlog"}, sorted(s["componentes"])
    assert s["estado"] in {VERDE, AMARILLO, ROJO, INSUFICIENTE}


async def test_el_indice_esta_en_rango_cuando_se_puede_calcular(client):
    s = (await _stats(client))["salud_operacional"]
    if s["indice"] is not None:
        assert 0.0 <= s["indice"] <= 100.0, s["indice"]


async def test_el_sla_del_semaforo_coincide_con_el_kpi(client):
    """El semáforo no debe calcular su propio SLA: reusa el del KPI."""
    d = await _stats(client)
    assert d["salud_operacional"]["componentes"]["sla"]["valor"] == d["financials"]["efficiency"]


async def test_con_rango_corto_el_estado_es_insuficiente(client):
    """Con 30 días no hay MTBF visible, así que el semáforo NO puede estar verde."""
    s = (await _stats(client, "?days=30"))["salud_operacional"]
    assert s["estado"] == INSUFICIENTE
    assert s["indice"] is None
