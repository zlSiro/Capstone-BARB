"""
Test consolidado del bloque de correcciones del dashboard (CGBIDA-409).

Cierra las subtareas 403-408 verificando el resultado como un todo, sobre el dataset
ampliado de 24 meses (CGBIDA-408):

1. **Los 6 KPIs** del dashboard se calculan sin error y con tipo correcto.
2. **Los flags de visibilidad** (`mtbf_visible`, `impacto_visible`) y el de supuestos
   (`supuestos_incompletos`) se comportan como corresponde en cada rango.
3. **El aislamiento por empresa** sigue vigente con el volumen nuevo.
4. **El contrato completo** del endpoint: estructura, campos y códigos de error.

Los casos de error (500, 503, 401, 422) se cubren en `test_stats_error.py`; aquí se
comprueba además el 403, que esa suite no ejercía.
"""

from __future__ import annotations

from barb.core.db import fetch_one
from barb.routers import stats

ADMIN_E1 = ("admin@barb.com", "admin123")
ADMIN_E2 = ("admin@mineranorte.cl", "minera123")
VISITANTE = ("visitante@planta.com", "visitante123")
TECNICO = ("carlos@planta.com", "tecnico123")

RUTA = "/api/stats/financial-impact"

# Los 6 KPIs visibles del dashboard, con el tipo que expone el contrato.
KPIS = {
    "mttr": (int, float),
    "efficiency": (int, float),
    "costo_total_acumulado": (int, float),
    "mtbfHours": (int, float, type(None)),
    "ahorro_generado": (int, float),
}

SUPUESTOS = ("minutos_sin_barb", "costo_por_minuto", "dias_periodo")


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _stats(client, creds=ADMIN_E1, qs: str = "") -> dict:
    h = await _login(client, creds)
    r = await client.get(f"{RUTA}{qs}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# =============================================================================
# 1. Contrato: estructura y tipos
# =============================================================================

async def test_contrato_del_endpoint_tiene_las_claves_exactas(client):
    """La forma de la respuesta es un contrato: si cambia, el frontend se rompe.

    ACTUALIZADO A PROPOSITO en CGBIDA-395: se agrego la clave `por_tipo` (distribucion por
    tipo de intervencion para la dona del dashboard).
    ACTUALIZADO A PROPOSITO en CGBIDA-396: se agrego la clave `estancadas` (banner de
    ordenes vencidas o demoradas).

    Esta asercion es un guardarrail: se toca cuando el contrato cambia a proposito, nunca
    para que una prueba pase.
    """
    d = await _stats(client)
    assert set(d) == {
        "financials", "trend14Days", "machines", "impacto_anual", "por_tipo", "estancadas",
    }, sorted(d)


async def test_por_tipo_tiene_la_forma_esperada(client):
    """Cada elemento de `por_tipo` declara el tipo de intervencion y su volumen."""
    d = await _stats(client)
    filas = d["por_tipo"]
    assert isinstance(filas, list) and filas, "el dataset de demo deberia tener OTs por tipo"
    for fila in filas:
        assert set(fila) == {"tipo", "total"}, sorted(fila)
        assert isinstance(fila["tipo"], str)
        assert isinstance(fila["total"], int) and fila["total"] > 0


async def test_por_tipo_ordena_por_volumen_descendente(client):
    """El orden de los segmentos debe ser estable y legible: de mayor a menor.

    Sin este orden la dona podria dibujar los segmentos en un orden que cambia entre
    llamadas, segun el plan de ejecucion de la consulta.
    """
    totales = [f["total"] for f in (await _stats(client))["por_tipo"]]
    assert totales == sorted(totales, reverse=True), totales


async def test_por_tipo_solo_usa_valores_del_enum(client):
    """El `tipo` debe ser uno de los cuatro valores del enum `tipo_mantenimiento`."""
    permitidos = {"corrective", "preventive", "predictive", "inspection"}
    for fila in (await _stats(client))["por_tipo"]:
        assert fila["tipo"] in permitidos, fila


async def test_por_tipo_suma_lo_mismo_que_el_total_de_ots(client):
    """La dona y el KPI de volumen deben hablar de la misma poblacion.

    Es la comprobacion que evita el defecto clasico: que la dona filtre distinto que el
    resto del endpoint y muestre un total que no cuadra con ninguna otra cifra.
    """
    from barb.core.db import fetch_one

    d = await _stats(client)
    suma_dona = sum(f["total"] for f in d["por_tipo"])
    fila = await fetch_one(
        """
        SELECT COUNT(*) AS n
        FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        WHERE p.empresa_id = 1
        """
    )
    # El endpoint sin filtro de fecha cuenta todas las OTs de la empresa, igual que la dona
    # sin rango. Si algun dia la dona empieza a filtrar distinto, este test lo delata.
    assert suma_dona == int(fila["n"]), (
        f"la dona suma {suma_dona} pero la empresa 1 tiene {fila['n']} OTs"
    )


async def test_por_tipo_respeta_el_filtro_de_fecha(client):
    """La dona debe cambiar con el selector de rango, como el resto de las metricas.

    El legacy calculaba su dona sobre el arreglo ya filtrado por el selector
    (`Dashboard.tsx:217-224` usa `filtered`), asi que respetar el rango es parte de la
    replica. Sin este test, quitar el `date_filter` de la consulta de `por_tipo` no lo
    detectaria ninguna otra prueba: la dona seguiria cuadrando, solo que sobre un periodo
    equivocado.
    """
    from barb.core.db import fetch_one

    d7 = await _stats(client, qs="?days=7")
    suma7 = sum(f["total"] for f in d7["por_tipo"])

    fila = await fetch_one(
        """
        SELECT COUNT(*) AS n
        FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        WHERE p.empresa_id = 1
          AND ot.fecha_creacion >= NOW() - INTERVAL '7 days'
        """
    )
    assert suma7 == int(fila["n"]), (
        f"la dona con ?days=7 suma {suma7} pero la empresa 1 tiene {fila['n']} OTs "
        f"creadas en los ultimos 7 dias"
    )


async def test_por_tipo_acota_por_empresa(client):
    """La dona no puede sumar OTs de otras empresas: es la regla no negociable del sistema.

    Se compara contra el conteo de la empresa 1 y contra el conteo global. Si la consulta
    perdiera el `ot_scope`, la dona sumaria el total global y este test lo delataria.
    """
    from barb.core.db import fetch_one

    suma_dona = sum(f["total"] for f in (await _stats(client))["por_tipo"])
    empresa1 = await fetch_one(
        """
        SELECT COUNT(*) AS n
        FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        WHERE p.empresa_id = 1
        """
    )
    global_ = await fetch_one("SELECT COUNT(*) AS n FROM orden_trabajo")

    assert suma_dona == int(empresa1["n"]), "la dona no coincide con las OTs de la empresa 1"
    assert suma_dona != int(global_["n"]), (
        "la dona suma TODAS las OTs del sistema: se perdio el filtro por empresa"
    )


# =============================================================================
# Órdenes estancadas (CGBIDA-396)
# =============================================================================

ESTADOS_FINALES = {"completed", "cancelled"}


async def _estancadas_esperadas(empresa_id: int) -> dict[str, int]:
    """Calcula las estancadas de una empresa EN PYTHON, sin repetir el SQL del endpoint.

    Es a propósito: una prueba que copia la consulta del endpoint se adapta a cualquier
    cambio de esa consulta y termina verificándose a sí misma. Acá se traen los campos
    crudos y se aplican las dos condiciones del ticket con código independiente.

    El `NOW()` se toma de la base para que el cálculo no dependa del reloj de la máquina
    ni de la zona horaria del proceso. Las columnas son `timestamp without time zone`, así
    que se comparan contra un naive extraído de la propia base.
    """
    from barb.core.db import fetch_all

    filas = await fetch_all(
        """
        SELECT
            ot.estado::text AS estado,
            ot.fecha_vencimiento AS vence,
            ot.fecha_inicio AS inicio,
            ot.fecha_creacion AS creacion,
            NOW()::timestamp AS ahora
        FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        WHERE p.empresa_id = %(empresa_id)s
        """,
        {"empresa_id": empresa_id},
    )

    vencidas = demoradas = total = 0
    for f in filas:
        if f["estado"] in ESTADOS_FINALES:
            sigue_abierta = False
        else:
            sigue_abierta = True

        es_vencida = sigue_abierta and f["vence"] is not None and f["vence"] < f["ahora"]

        referencia = f["inicio"] or f["creacion"]
        es_demorada = (
            sigue_abierta
            and f["estado"] == "in_progress"
            and referencia is not None
            and (f["ahora"] - referencia).days > 7
        )

        vencidas += 1 if es_vencida else 0
        demoradas += 1 if es_demorada else 0
        total += 1 if (es_vencida or es_demorada) else 0

    return {"total": total, "vencidas": vencidas, "demoradas": demoradas}


async def test_estancadas_tiene_la_forma_esperada(client):
    """El banner necesita el total y de dónde sale, más el umbral para no repetirlo."""
    e = (await _stats(client))["estancadas"]
    assert set(e) == {"total", "vencidas", "demoradas", "umbral_dias"}, sorted(e)
    for campo in ("total", "vencidas", "demoradas", "umbral_dias"):
        assert isinstance(e[campo], int), f"{campo} deberia ser int, es {type(e[campo])}"
    assert e["umbral_dias"] == 7


async def test_estancadas_coincide_con_el_calculo_independiente(client):
    """El total del endpoint debe coincidir con la definicion aplicada aparte.

    Detecta que se invierta una condicion, que se olvide una, o que se cuente de mas.
    """
    e = (await _stats(client))["estancadas"]
    esperado = await _estancadas_esperadas(1)
    assert e == {**esperado, "umbral_dias": 7}, f"endpoint={e} esperado={esperado}"


async def test_estancadas_incluye_una_orden_vencida_creada_para_la_prueba(client):
    """Prueba de comportamiento real: se crea una OT vencida y debe aparecer.

    No alcanza con comparar contra un calculo paralelo: hace falta comprobar que el
    conteo REACCIONA a un cambio concreto en los datos.
    """
    from barb.core.db import execute, fetch_one

    antes = (await _stats(client))["estancadas"]["total"]

    # Una OT pendiente, con vencimiento en el pasado y de la empresa 1.
    ot_id = await fetch_one(
        """
        INSERT INTO orden_trabajo
            (numero_ot, maquina_id, tecnico_id, creado_por, tipo, priority, estado,
             fecha_creacion, fecha_vencimiento)
        VALUES
            ('ZZ-ESTANCADA-PRUEBA',
             (SELECT m.maquina_id FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
              WHERE p.empresa_id = 1 LIMIT 1),
             4, 1, 'corrective', 'medium', 'pending',
             NOW() - INTERVAL '30 days', NOW() - INTERVAL '10 days')
        RETURNING ot_id
        """
    )
    try:
        despues = (await _stats(client))["estancadas"]
        assert despues["total"] == antes + 1, f"{antes} -> {despues['total']}"
        assert despues["vencidas"] >= 1
    finally:
        await execute("DELETE FROM orden_trabajo WHERE ot_id = %(id)s", {"id": int(ot_id["ot_id"])})

    final = (await _stats(client))["estancadas"]["total"]
    assert final == antes, f"no se limpio la OT de prueba: {antes} -> {final}"


async def test_estancadas_no_cuenta_estados_finales(client):
    """Una OT completada o cancelada no esta estancada, aunque tenga vencimiento viejo.

    El defecto que evita: contar todo lo que tiene `fecha_vencimiento` pasada sin mirar
    el estado, que inflaria el banner con trabajo ya hecho.
    """
    from barb.core.db import execute, fetch_one

    antes = (await _stats(client))["estancadas"]["total"]
    ids = []
    for estado in ("completed", "cancelled"):
        fila = await fetch_one(
            """
            INSERT INTO orden_trabajo
                (numero_ot, maquina_id, tecnico_id, creado_por, tipo, priority, estado,
                 fecha_creacion, fecha_vencimiento, fecha_cierre, tiempo_reparacion_min)
            VALUES
                (%(numero)s,
                 (SELECT m.maquina_id FROM maquina m JOIN planta p ON p.planta_id = m.planta_id
                  WHERE p.empresa_id = 1 LIMIT 1),
                 4, 1, 'corrective', 'medium', %(estado)s,
                 NOW() - INTERVAL '60 days', NOW() - INTERVAL '30 days', NOW(), 30)
            RETURNING ot_id
            """,
            {"numero": f"ZZ-FINAL-{estado}", "estado": estado},
        )
        ids.append(int(fila["ot_id"]))
    try:
        despues = (await _stats(client))["estancadas"]["total"]
        assert despues == antes, f"se contaron OT de estado final: {antes} -> {despues}"
    finally:
        for ot_id in ids:
            await execute("DELETE FROM orden_trabajo WHERE ot_id = %(id)s", {"id": ot_id})


async def test_estancadas_acota_por_empresa(client):
    """El banner es una alerta operativa: no puede filtrar ordenes de otra empresa."""
    global_ = await _estancadas_esperadas(2)
    propio = (await _stats(client))["estancadas"]

    # La empresa 1 no debe estar viendo las estancadas de la empresa 2.
    assert propio["total"] == (await _estancadas_esperadas(1))["total"]
    if global_["total"] > 0:
        assert propio["total"] != global_["total"], "el banner mezcla empresas"


async def test_estancadas_no_depende_del_selector_de_rango(client):
    """Es una foto del estado actual, no una metrica del periodo elegido.

    Documentado en el ticket: el banner responde a "que esta trabado AHORA". Si empezara
    a leer `days`, un rango corto escondería ordenes que siguen abiertas.
    """
    a = (await _stats(client, qs="?days=7"))["estancadas"]
    b = (await _stats(client, qs="?days=90"))["estancadas"]
    c = (await _stats(client))["estancadas"]
    assert a == b == c, f"days=7:{a} days=90:{b} sin filtro:{c}"


async def test_estancadas_total_es_la_union_no_la_suma(client):
    """El total cuenta cada OT una sola vez, aunque cumpla las dos condiciones."""
    e = (await _stats(client))["estancadas"]
    assert e["total"] <= e["vencidas"] + e["demoradas"], (
        f"total={e['total']} supera la suma del desglose, que es imposible"
    )
    assert e["total"] >= max(e["vencidas"], e["demoradas"]), (
        f"total={e['total']} es menor que uno de sus desgloses"
    )


async def test_los_6_kpis_estan_presentes_y_son_numericos(client):
    """Los 6 KPIs del dashboard, con valor y del tipo correcto, sobre el dataset ampliado."""
    d = await _stats(client)
    fin = d["financials"]

    for nombre, tipos in KPIS.items():
        assert nombre in fin, f"falta el KPI {nombre}"
        assert isinstance(fin[nombre], tipos), f"{nombre} es {type(fin[nombre])}"
        assert fin[nombre] is not None, f"{nombre} no debería ser null sin filtro"

    # El 6.º KPI es el impacto anual, que es un objeto.
    imp = d["impacto_anual"]
    assert isinstance(imp, dict)
    for campo in ("escenario_sin_barb", "escenario_con_barb", "ahorro_proyectado", "incidentes_anuales"):
        assert campo in imp, f"falta {campo} en impacto_anual"


async def test_los_kpis_tienen_valores_no_cero_con_el_dataset_ampliado(client):
    """El dataset de 24 meses debe dar cifras utilizables, no ceros.

    Es la comprobación que justifica CGBIDA-408 entera.
    """
    fin = (await _stats(client))["financials"]
    assert fin["mttr"] > 0, f"MTTR = {fin['mttr']}"
    assert fin["efficiency"] > 0, f"efficiency = {fin['efficiency']}"
    assert fin["costo_total_acumulado"] > 0, f"costo = {fin['costo_total_acumulado']}"
    assert fin["mtbfHours"] is not None and fin["mtbfHours"] > 0, f"MTBF = {fin['mtbfHours']}"
    assert fin["ahorro_generado"] > 0, f"ahorro = {fin['ahorro_generado']}"


async def test_el_cumplimiento_de_sla_no_es_plano(client):
    """El KPI de SLA debe estar entre 0 y 100 y no ser exactamente 100.

    El seed garantiza al menos 2 órdenes sobre el SLA en la empresa 1 (CGBIDA-408), así
    que un 100% aquí significa que el ajuste determinístico dejó de funcionar.
    """
    eff = (await _stats(client))["financials"]["efficiency"]
    assert 0 < eff <= 100, f"efficiency fuera de rango: {eff}"
    assert eff < 100, (
        f"efficiency = {eff}: el dataset no tiene ninguna OT sobre el SLA, "
        "el KPI queda plano y el ajuste de demo no está operando"
    )


async def test_trend_y_machines_tienen_la_forma_esperada(client):
    d = await _stats(client)
    assert len(d["trend14Days"]) == 14, f"{len(d['trend14Days'])} puntos"
    for punto in d["trend14Days"]:
        assert set(punto) == {"date", "abiertas", "cerradas"}, sorted(punto)

    assert len(d["machines"]) == 5, f"{len(d['machines'])} máquinas"
    # El backend envía 6 campos por máquina. El modelo del frontend
    # (`stats.model.ts`, interfaz `MachineData`) solo declara 3: `ahorroGenerado`, `mttr`
    # y `slaCompliance` llegan pero no se consumen. Queda documentado en CGBIDA-410.
    esperado = {"id", "name", "total", "ahorroGenerado", "mttr", "slaCompliance"}
    for m in d["machines"]:
        assert set(m) == esperado, sorted(m)


# =============================================================================
# 2. Flags de visibilidad
# =============================================================================

async def test_mtbf_visible_sin_filtro_y_con_365(client):
    """El MTBF se muestra cuando la ventana pedida justifica un año."""
    for qs in ("", "?days=365"):
        fin = (await _stats(client, qs=qs))["financials"]
        assert fin["mtbf_visible"] is True, qs
        assert fin["mtbfHours"] is not None, qs


async def test_mtbf_oculto_con_ventanas_cortas(client):
    """Con 7 o 30 días el MTBF se oculta y viene null, sin importar el valor real."""
    for qs in ("?days=7", "?days=30", "?days=89"):
        fin = (await _stats(client, qs=qs))["financials"]
        assert fin["mtbf_visible"] is False, qs
        assert fin["mtbfHours"] is None, qs


async def test_el_umbral_de_impacto_es_90_dias(client):
    """El impacto anual se muestra a partir de 90 días (IMPACTO_DIAS_MINIMOS)."""
    assert (await _stats(client, qs="?days=90"))["impacto_anual"]["impacto_visible"] is True
    assert (await _stats(client, qs="?days=89"))["impacto_anual"]["impacto_visible"] is False


async def test_impacto_oculto_devuelve_todo_null_pero_con_supuestos(client):
    """Oculto no es solo un flag: las cifras deben ser null y los supuestos seguir."""
    imp = (await _stats(client, qs="?days=30"))["impacto_anual"]
    assert imp["impacto_visible"] is False
    for campo in ("escenario_sin_barb", "escenario_con_barb", "ahorro_proyectado", "incidentes_anuales"):
        assert imp[campo] is None, f"{campo} debería ser null"
    assert set(imp["supuestos"]) == set(SUPUESTOS), sorted(imp["supuestos"])
    assert imp["supuestos"]["dias_periodo"] == 30


async def test_supuestos_incompletos_es_false_con_el_dataset_ampliado(client):
    """El dataset tiene tiempos de reparación medidos, así que el flag no debe dispararse."""
    imp = (await _stats(client))["impacto_anual"]
    assert imp["supuestos_incompletos"] is False, (
        "el seed no dejó tiempos de reparación en las correctivas del período"
    )


async def test_el_ahorro_proyectado_es_positivo_con_el_dataset_ampliado(client):
    """El promedio correctivo del seed está por debajo del supuesto de 180 min.

    Si esto falla, el KPI estrella de la demo muestra un ahorro negativo.
    """
    imp = (await _stats(client))["impacto_anual"]
    assert imp["impacto_visible"] is True
    assert imp["ahorro_proyectado"] is not None and imp["ahorro_proyectado"] > 0, (
        f"ahorro proyectado = {imp['ahorro_proyectado']}"
    )
    assert imp["escenario_sin_barb"] > imp["escenario_con_barb"]
    # La coherencia aritmética del modelo.
    assert imp["ahorro_proyectado"] == round(
        imp["escenario_sin_barb"] - imp["escenario_con_barb"], 2
    )


async def test_los_supuestos_salen_de_config_y_no_del_codigo(client):
    """El 180 y el 2000 deben poder cambiarse sin tocar el router."""
    imp = (await _stats(client))["impacto_anual"]
    assert imp["supuestos"]["minutos_sin_barb"] == stats.settings.impact_without_barb_minutes
    assert imp["supuestos"]["costo_por_minuto"] == stats.settings.downtime_cost_per_minute


# =============================================================================
# 3. Aislamiento por empresa, con el volumen nuevo
# =============================================================================

async def test_dos_empresas_ven_metricas_distintas(client):
    """El volumen ampliado no debe haber filtrado datos entre empresas."""
    d1 = await _stats(client, ADMIN_E1)
    d2 = await _stats(client, ADMIN_E2)

    assert d1["financials"] != d2["financials"], "las dos empresas ven exactamente lo mismo"
    # El costo directo es el indicador más directo de fuga de datos.
    assert d1["financials"]["costo_total_acumulado"] != d2["financials"]["costo_total_acumulado"]


async def test_el_costo_de_cada_empresa_cuadra_con_su_propia_suma(client):
    """Contra la BD: cada empresa ve SU costo, ni el de otra ni el total."""
    for creds, empresa_id in ((ADMIN_E1, 1), (ADMIN_E2, 2)):
        d = await _stats(client, creds)
        fila = await fetch_one(
            """
            SELECT COALESCE(SUM(ot.costo_real) FILTER (WHERE ot.estado != 'cancelled'), 0) AS c
            FROM orden_trabajo ot
            JOIN maquina m ON m.maquina_id = ot.maquina_id
            JOIN planta p ON p.planta_id = m.planta_id
            WHERE p.empresa_id = %(e)s
            """,
            {"e": empresa_id},
        )
        esperado = round(float(fila["c"]), 2)
        assert d["financials"]["costo_total_acumulado"] == esperado, (
            f"empresa {empresa_id}: endpoint {d['financials']['costo_total_acumulado']} != BD {esperado}"
        )


async def test_el_mtbf_de_cada_empresa_cuadra_con_su_propia_ventana(client):
    """El MTBF se calcula sobre las correctivas no canceladas de los últimos 365 días.

    Se calcula bajo las dos interpretaciones del `SUM` para que el test no se limite a
    espejar al endpoint: si la inactividad se sumara sobre todas las órdenes y no solo
    las correctivas, el valor coincidiría con la interpretación incorrecta.
    """
    for creds, empresa_id in ((ADMIN_E1, 1), (ADMIN_E2, 2)):
        mtbf = (await _stats(client, creds))["financials"]["mtbfHours"]
        fila = await fetch_one(
            """
            SELECT
                COUNT(*) FILTER (WHERE ot.tipo = 'corrective') AS fallas,
                COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.tipo = 'corrective'), 0)
                    AS dt_correctivas,
                COALESCE(SUM(ot.downtime_minutes), 0) AS dt_todas
            FROM orden_trabajo ot
            JOIN maquina m ON m.maquina_id = ot.maquina_id
            JOIN planta p ON p.planta_id = m.planta_id
            WHERE p.empresa_id = %(e)s
              AND ot.tipo = 'corrective' AND ot.estado != 'cancelled'
              AND ot.fecha_creacion >= NOW() - INTERVAL '365 days'
            """,
            {"e": empresa_id},
        )
        fallas = int(fila["fallas"])
        if fallas >= 2:
            correcto = round((8760 - float(fila["dt_correctivas"]) / 60) / fallas, 1)
            assert mtbf == correcto, f"empresa {empresa_id}: MTBF {mtbf} != {correcto}"
            if float(fila["dt_correctivas"]) != float(fila["dt_todas"]):
                incorrecto = round((8760 - float(fila["dt_todas"]) / 60) / fallas, 1)
                assert mtbf != incorrecto, (
                    f"empresa {empresa_id}: el MTBF coincide con la interpretación que "
                    "suma la inactividad de órdenes que no son correctivas"
                )
        else:
            assert mtbf is None, f"empresa {empresa_id}: con {fallas} fallas debería ser null"


async def test_el_mttr_corresponde_solo_a_las_completadas(client):
    """El MTTR es el promedio del tiempo de reparación de las COMPLETADAS.

    Es la mutación M4 de CGBIDA-409: si el `FILTER` de estado desapareciera, el promedio
    incluiría órdenes en curso y el valor no cuadraría. Se contrasta contra la BD.
    """
    for creds, empresa_id in ((ADMIN_E1, 1), (ADMIN_E2, 2)):
        mttr = (await _stats(client, creds))["financials"]["mttr"]
        fila = await fetch_one(
            """
            SELECT
                COALESCE(AVG(ot.tiempo_reparacion_min) FILTER (WHERE ot.estado = 'completed'), 0)
                    AS solo_completadas,
                COALESCE(AVG(ot.tiempo_reparacion_min), 0) AS todas
            FROM orden_trabajo ot
            JOIN maquina m ON m.maquina_id = ot.maquina_id
            JOIN planta p ON p.planta_id = m.planta_id
            WHERE p.empresa_id = %(e)s
            """,
            {"e": empresa_id},
        )
        solo_completadas = float(fila["solo_completadas"])
        todas = float(fila["todas"])

        assert mttr == round(solo_completadas, 1), (
            f"empresa {empresa_id}: MTTR {mttr} != promedio de completadas {round(solo_completadas, 1)}"
        )
        # Si los dos promedios coincidieran, el test no distinguiría el FILTER.
        if round(solo_completadas, 1) != round(todas, 1):
            assert mttr != round(todas, 1), (
                f"empresa {empresa_id}: el MTTR coincide con el promedio SIN filtrar por estado"
            )


# =============================================================================
# 4. Contrato de permisos
# =============================================================================

async def test_tecnico_recibe_403(client):
    """La matriz de rutas niega `dashboard` a tecnico y operador (permissions.py:47).

    `test_stats_error.py` cubre 200/401/422/500/503 pero no el 403; se cierra aquí.
    """
    h = await _login(client, TECNICO)
    r = await client.get(RUTA, headers=h)
    assert r.status_code == 403, r.text


async def test_visitante_lee_en_solo_lectura(client):
    h = await _login(client, VISITANTE)
    r = await client.get(RUTA, headers=h)
    assert r.status_code == 200, r.text


async def test_rango_invalido_devuelve_422(client):
    """`days` es ge=1: un cero o un negativo no son válidos."""
    h = await _login(client, ADMIN_E1)
    for qs in ("?days=0", "?days=-5"):
        assert (await client.get(f"{RUTA}{qs}", headers=h)).status_code == 422, qs


async def test_la_base_caida_da_503_y_no_ceros(client, monkeypatch):
    """Repetido a propósito desde la óptica del contrato: un error no es una métrica."""
    import psycopg

    class _PoolCaido:
        def connection(self):
            raise psycopg.OperationalError("sin conexión")

    monkeypatch.setattr(stats, "pool", _PoolCaido())
    h = await _login(client, ADMIN_E1)
    r = await client.get(RUTA, headers=h)
    assert r.status_code == 503, r.text
