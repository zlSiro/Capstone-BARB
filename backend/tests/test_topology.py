"""
Pruebas del endpoint de topología.

CGBIDA-357: cuando la consulta a la base falla, el endpoint debe devolver un error
explícito en vez de una lista vacía. Antes devolvía 200 con `{"nodos": [], "conexiones": []}`,
y el usuario veía un mapa vacío sin poder distinguir "no hay datos" de "el servicio falló".

CGBIDA-359: cobertura del endpoint completo — estructura de la respuesta, códigos 401/403/422,
estados de nodo derivados, formato de conexiones e integridad referencial.

Solo lectura: estas pruebas no crean ni modifican filas.
Contrato documentado en `docs/contrato_api_topologia.md`.
"""

from __future__ import annotations

from unittest.mock import patch

import psycopg
from fastapi import HTTPException
from psycopg_pool import PoolTimeout

import barb.routers.topology as topology
from barb.core.db import fetch_all

# Credenciales del seed (seeds/seed_data.sql) — empresa 1
ADMIN_E1 = ("admin@barb.com", "admin123")
VISITANTE_E1 = ("visitante@planta.com", "visitante123")
# La empresa 2 es la única del seed con disciplina repartida en 2 plantas (d_13 y d_14),
# así que es la que permite ejercitar A-3.
ADMIN_E2 = ("admin@mineranorte.cl", "minera123")

CAMPOS_NODO = {"nodo_id", "nombre_visual", "tipo", "icono", "pos_x", "pos_y", "estado_actual"}
CAMPOS_CONEXION = {"conexion_id", "origen_nodo_id", "destino_nodo_id", "tipo_relacion"}
ESTADOS_VALIDOS = {"operativo", "alerta", "falla", "desconectado"}


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _topologia(client, headers, qs: str = "") -> dict:
    r = await client.get(f"/api/topology{qs}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _estado_esperado(abiertas: int, urgentes: int) -> str:
    """Misma regla que barb/routers/topology.py:39-57."""
    if urgentes:
        return "falla"
    if abiertas:
        return "alerta"
    return "operativo"


# =============================================================================
# CGBIDA-357 — la consulta falla: error explícito, no lista vacía
# =============================================================================

async def test_base_inalcanzable_devuelve_503(client):
    """Un fallo de conexión (dependencia caída) debe dar 503, no 200 con listas vacías."""
    h = await _login(client, ADMIN_E1)
    with patch.object(topology, "fetch_all", side_effect=psycopg.OperationalError("conexión rechazada")):
        r = await client.get("/api/topology", headers=h)
    assert r.status_code == 503, r.text
    assert "base de datos" in r.json()["detail"].lower()
    # Lo importante: ya no devuelve un cuerpo que parezca "sin datos".
    assert "nodos" not in r.json()


async def test_pool_agotado_devuelve_503(client):
    """Un timeout del pool también es indisponibilidad de dependencia -> 503."""
    h = await _login(client, ADMIN_E1)
    with patch.object(topology, "fetch_all", side_effect=PoolTimeout("pool agotado")):
        r = await client.get("/api/topology", headers=h)
    assert r.status_code == 503, r.text


async def test_error_inesperado_devuelve_500(client):
    """Un fallo no relacionado con la conexión debe dar 500, no una lista vacía."""
    h = await _login(client, ADMIN_E1)
    with patch.object(topology, "fetch_all", side_effect=RuntimeError("algo salió mal")):
        r = await client.get("/api/topology", headers=h)
    assert r.status_code == 500, r.text
    assert r.json()["detail"] == "Error interno al generar la topología."


async def test_http_exception_no_se_enmascara(client):
    """Un HTTPException deliberado no debe convertirse en 500 ni en 503.

    Se usa resolver_empresa porque se ejecuta DENTRO del try y es la clase de error
    deliberado que el endpoint puede emitir. Si el `except Exception` lo capturara,
    el 403 se transformaría en 500.
    """
    h = await _login(client, ADMIN_E1)
    with patch.object(topology, "resolver_empresa", side_effect=HTTPException(status_code=403, detail="sin permiso")):
        r = await client.get("/api/topology", headers=h)
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "sin permiso"


# =============================================================================
# CGBIDA-359 — estructura de la respuesta
# =============================================================================

async def test_respuesta_tiene_nodos_y_conexiones(client):
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    assert set(cuerpo.keys()) == {"nodos", "conexiones"}
    assert isinstance(cuerpo["nodos"], list) and cuerpo["nodos"]
    assert isinstance(cuerpo["conexiones"], list) and cuerpo["conexiones"]


async def test_los_tres_niveles_estan_presentes(client):
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    assert {n["tipo"] for n in cuerpo["nodos"]} == {"Planta", "Disciplina", "Máquina"}


async def test_campos_de_nodo_son_los_del_contrato(client):
    """Un nodo solo tiene los campos documentados, y `maquina_id` solo en las máquinas."""
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    for n in cuerpo["nodos"]:
        assert CAMPOS_NODO <= set(n.keys()), f"faltan campos en {n['nodo_id']}: {CAMPOS_NODO - set(n)}"
        if n["tipo"] == "Máquina":
            assert isinstance(n.get("maquina_id"), int), n
        else:
            # Planta y Disciplina NO traen maquina_id: el frontend usa su ausencia
            # para decidir si ofrece acciones por equipo.
            assert "maquina_id" not in n, n


async def test_estados_y_tipos_de_nodo_estan_en_el_vocabulario(client):
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    assert {n["estado_actual"] for n in cuerpo["nodos"]} <= ESTADOS_VALIDOS
    assert {n["tipo"] for n in cuerpo["nodos"]} == {"Planta", "Disciplina", "Máquina"}
    # pos_y es fija por nivel (topology.py:71,85,107)
    por_tipo = {n["tipo"]: n["pos_y"] for n in cuerpo["nodos"]}
    assert por_tipo == {"Planta": 100, "Disciplina": 300, "Máquina": 500}


async def test_id_de_nodo_respeta_el_prefijo_por_nivel(client):
    """Contrato: p_<planta>, d_<disciplina>, m_<maquina> (decision A-3, CGBIDA-355)."""
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    prefijos = {"Planta": "p_", "Disciplina": "d_", "Máquina": "m_"}
    for n in cuerpo["nodos"]:
        assert n["nodo_id"].startswith(prefijos[n["tipo"]]), n


# =============================================================================
# CGBIDA-359 — formato e integridad de las conexiones
# =============================================================================

async def test_campos_de_conexion_son_los_del_contrato(client):
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    for c in cuerpo["conexiones"]:
        assert set(c.keys()) == CAMPOS_CONEXION, c
        assert c["tipo_relacion"] in {"jerarquia", "pertenece"}, c


async def test_conexiones_apuntan_a_nodos_existentes(client):
    """Integridad referencial: ninguna arista puede referenciar un nodo ausente.

    Sin esto, el frontend dibujaría aristas colgando en el vacío.
    """
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    ids = {n["nodo_id"] for n in cuerpo["nodos"]}
    for c in cuerpo["conexiones"]:
        assert c["origen_nodo_id"] in ids, f"origen huérfano: {c}"
        assert c["destino_nodo_id"] in ids, f"destino huérfano: {c}"


async def test_jerarquia_va_de_planta_a_disciplina_y_pertenece_de_disciplina_a_maquina(client):
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    tipo_por_id = {n["nodo_id"]: n["tipo"] for n in cuerpo["nodos"]}
    for c in cuerpo["conexiones"]:
        o, d = tipo_por_id[c["origen_nodo_id"]], tipo_por_id[c["destino_nodo_id"]]
        if c["tipo_relacion"] == "jerarquia":
            assert (o, d) == ("Planta", "Disciplina"), c
        else:
            assert (o, d) == ("Disciplina", "Máquina"), c


# =============================================================================
# CGBIDA-359 — estados derivados de las órdenes de trabajo
# =============================================================================

async def test_estado_de_maquina_se_deriva_de_las_ots(client):
    """El estado de cada máquina debe coincidir con la regla documentada.

    Se recalcula contra la BD en vez de fijar valores, porque los datos cambian.
    """
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)

    filas = await fetch_all(
        """
        SELECT maquina_id,
               COUNT(*) FILTER (WHERE estado NOT IN ('completed', 'cancelled')
                                  AND (priority = 'urgent' OR estado = 'overdue')) AS urgentes,
               COUNT(*) FILTER (WHERE estado NOT IN ('completed', 'cancelled')) AS abiertas
        FROM orden_trabajo GROUP BY maquina_id
        """
    )
    por_maquina = {r["maquina_id"]: (r["abiertas"], r["urgentes"]) for r in filas}

    maquinas = [n for n in cuerpo["nodos"] if n["tipo"] == "Máquina"]
    assert maquinas, "la empresa 1 debería tener máquinas"
    for n in maquinas:
        abiertas, urgentes = por_maquina.get(n["maquina_id"], (0, 0))
        assert n["estado_actual"] == _estado_esperado(abiertas, urgentes), (
            f"{n['nombre_visual']}: esperado {_estado_esperado(abiertas, urgentes)}, "
            f"obtenido {n['estado_actual']}"
        )


async def test_planta_y_disciplina_siempre_operativo(client):
    """Solo las máquinas reciben estado derivado (topology.py:72,86,108)."""
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)
    for n in cuerpo["nodos"]:
        if n["tipo"] in ("Planta", "Disciplina"):
            assert n["estado_actual"] == "operativo", n


# =============================================================================
# CGBIDA-359 — códigos de autenticación
# =============================================================================

async def test_sin_token_no_devuelve_datos(client):
    """Sin credenciales no se expone la topología.

    Hoy devuelve 422 porque FastAPI valida el header antes del guard.
    Deuda registrada en CGBIDA-374 (se esperaría 401).
    """
    r = await client.get("/api/topology")
    assert r.status_code == 422, r.text


async def test_token_invalido_devuelve_401(client):
    r = await client.get("/api/topology", headers={"Authorization": "Bearer token-que-no-existe"})
    assert r.status_code == 401, r.text
    assert "sesión" in r.json()["detail"].lower()


async def test_header_mal_formado_devuelve_401(client):
    r = await client.get("/api/topology", headers={"Authorization": "no-es-bearer"})
    assert r.status_code == 401, r.text


async def test_empresa_id_no_entero_devuelve_422(client):
    h = await _login(client, ADMIN_E1)
    r = await client.get("/api/topology?empresa_id=abc", headers=h)
    assert r.status_code == 422, r.text


async def test_visitante_accede_en_solo_lectura(client):
    """La matriz da 'ver' al rol visitante (permissions.py:44)."""
    h = await _login(client, VISITANTE_E1)
    cuerpo = await _topologia(client, h)
    assert cuerpo["nodos"]


# =============================================================================
# CGBIDA-359 — aislamiento multi-empresa
# =============================================================================
#
# NO se duplica el aislamiento aquí: ya está cubierto de forma exhaustiva.
#
#   backend/tests/test_multiempresa.py:151-161
#     test_stats_y_topologia_solo_de_la_empresa
#       - un admin de la empresa 2 SÍ ve "Chancador Primario CH-01"
#       - y NO ve "Compressor A1" (empresa 1)
#
# Lo que se cubre aquí es el complemento que aquel test no toca: que el parámetro
# `empresa_id` no permita a un usuario espiar otra empresa, y que el super_usuario
# sí pueda filtrar (comportamiento opuesto).

async def test_usuario_normal_no_puede_espiar_otra_empresa_con_empresa_id(client):
    """Un usuario con empresa propia no puede pedir los datos de otra.

    Verificado en vivo: `?empresa_id=1` y `?empresa_id=999` se ignoran y devuelven
    los datos de la empresa del usuario.
    """
    h = await _login(client, ("admin@mineranorte.cl", "minera123"))  # empresa 2
    base = await _topologia(client, h)
    for intento in ("?empresa_id=1", "?empresa_id=999"):
        r = await client.get(f"/api/topology{intento}", headers=h)
        assert r.status_code == 200, r.text
        assert r.json() == base, f"{intento} cambió la respuesta de un usuario de empresa 2"


async def test_super_usuario_no_accede_a_la_topologia(client):
    """El super_usuario (contraparte comercial, sin empresa) no tiene acceso a la topología."""
    h = await _login(client, ("super@barb.com", "super123"))
    for url in ("/api/topology", "/api/topology?empresa_id=1"):
        assert (await client.get(url, headers=h)).status_code == 403


# =============================================================================
# CGBIDA-376 — A-2: excluir plantas sin máquinas / A-3: disciplina en N plantas
# =============================================================================
#
# Decisiones aprobadas en CGBIDA-355. El legacy nunca enfrentó el caso de plantas
# vacías y conectaba TODA disciplina a plantas[0] (BARB/backend/main.py:3353-3360).

def _por_tipo(cuerpo: dict, tipo: str) -> list[dict]:
    return [n for n in cuerpo["nodos"] if n["tipo"] == tipo]


def _padres_de_disciplina(cuerpo: dict) -> dict[str, set[str]]:
    """origen_nodo_id por cada disciplina, según las aristas `jerarquia`."""
    padres: dict[str, set[str]] = {}
    for c in cuerpo["conexiones"]:
        if c["tipo_relacion"] == "jerarquia":
            padres.setdefault(c["destino_nodo_id"], set()).add(c["origen_nodo_id"])
    return padres


async def test_a2_no_devuelve_plantas_sin_maquinas(client):
    """Una planta sin ninguna máquina no debe aparecer: sugeriría actividad inexistente.

    La empresa 1 tiene 3 plantas en el catálogo y solo 1 con máquinas.
    """
    h = await _login(client, ADMIN_E1)

    # Se comprueba contra la BD cuáles tienen máquinas, en vez de fijar nombres.
    filas = await fetch_all(
        """
        SELECT p.planta_id, COUNT(m.maquina_id) AS total
        FROM planta p LEFT JOIN maquina m ON m.planta_id = p.planta_id
        WHERE p.empresa_id = 1
        GROUP BY p.planta_id ORDER BY p.planta_id
        """
    )
    con_maquinas = {r["planta_id"] for r in filas if r["total"] > 0}
    vacias = {r["planta_id"] for r in filas if r["total"] == 0}
    assert vacias, "el seed de la empresa 1 debería tener plantas sin máquinas"

    cuerpo = await _topologia(client, h)
    devueltas = {n["nodo_id"] for n in _por_tipo(cuerpo, "Planta")}

    assert devueltas == {f"p_{pid}" for pid in con_maquinas}, (
        f"plantas devueltas={sorted(devueltas)}; con máquinas={sorted(con_maquinas)}; "
        f"vacías que no debían salir={sorted(vacias)}"
    )


async def test_a3_disciplina_con_maquinas_en_varias_plantas_se_conecta_a_todas(client):
    """Una disciplina repartida en N plantas emite N aristas, no una sola a plantas[0]."""
    h = await _login(client, ADMIN_E2)
    cuerpo = await _topologia(client, h)

    padres = _padres_de_disciplina(cuerpo)
    multi = {d: ps for d, ps in padres.items() if len(ps) > 1}
    assert multi, (
        "la empresa 2 tiene una disciplina en 2 plantas; debería haber al menos una "
        f"con 2 padres. Padres observados: {padres}"
    )

    # Cada padre debe ser un nodo Planta realmente presente y de la empresa 2.
    ids_planta = {n["nodo_id"] for n in _por_tipo(cuerpo, "Planta")}
    for disc, ps in multi.items():
        assert ps <= ids_planta, f"{disc} apunta a plantas ausentes: {ps - ids_planta}"
        assert len(ps) >= 2


async def test_a3_una_disciplina_se_dibuja_una_sola_vez(client):
    """Aunque tenga máquinas en varias plantas, el nodo de disciplina es único."""
    h = await _login(client, ADMIN_E2)
    cuerpo = await _topologia(client, h)
    ids = [n["nodo_id"] for n in _por_tipo(cuerpo, "Disciplina")]
    assert len(ids) == len(set(ids)), f"hay nodos de disciplina duplicados: {ids}"


async def test_sin_nodos_huerfanos(client):
    """Ningún nodo queda sin aristas: era el problema que A-2 evita en el nivel superior."""
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)

    con_arista: set[str] = set()
    for c in cuerpo["conexiones"]:
        con_arista.add(c["origen_nodo_id"])
        con_arista.add(c["destino_nodo_id"])
    huerfanos = [n["nodo_id"] for n in cuerpo["nodos"] if n["nodo_id"] not in con_arista]
    assert huerfanos == [], f"nodos huérfanos (sin ninguna arista): {huerfanos}"


async def test_toda_planta_tiene_al_menos_una_disciplina_conectada(client):
    """A-2, visto desde el otro lado: no basta con tener máquinas, hay que verse conectada."""
    h = await _login(client, ADMIN_E1)
    cuerpo = await _topologia(client, h)

    plantas = {n["nodo_id"] for n in _por_tipo(cuerpo, "Planta")}
    plantas_conectadas = {
        c["origen_nodo_id"] for c in cuerpo["conexiones"] if c["tipo_relacion"] == "jerarquia"
    }
    assert plantas <= plantas_conectadas, (
        f"plantas sin ninguna disciplina conectada: {plantas - plantas_conectadas}"
    )
