"""
Pruebas del detalle de nodo de topología.

CGBIDA-380 (endpoint implementado en CGBIDA-379). Decisiones en
`CGBIDA-378_decisiones-tecnicas.md`:
  - D2: endpoint propio `GET /api/topology/{nodo_id}` -> {nodo, ordenes, hijos}
  - D3: los hijos se derivan de las aristas del grafo, no de una consulta aparte
  - D4: permiso `require_route("topology", solo_lectura=True)`

Solo lectura sobre el estado del sistema: las pruebas que necesitan una condicion
concreta la CREAN y la revierten al terminar. Historicamente se apoyaban en que el seed
dejara una maquina SIN ordenes (m_11), pero el historial sintetico del dashboard
(CGBIDA-408) dio OTs a las 12 maquinas de la empresa 1. En vez de depender de que un seed
ajeno deje una fila vacia, la prueba que necesita una maquina sin ordenes crea la suya y
la borra.

Contrato del mapa: `docs/contrato_api_topologia.md`.
"""

from __future__ import annotations

import pytest

from barb.core.db import execute, fetch_all, fetch_one

ADMIN_E1 = ("admin@barb.com", "admin123")
ADMIN_E2 = ("admin@mineranorte.cl", "minera123")
VISITANTE_E1 = ("visitante@planta.com", "visitante123")
SUPER = ("super@barb.com", "super123")

MAQUINA_CON_OTS = "m_1"
PLANTA_E1 = "p_1"
PLANTA_E2 = "p_4"
DISCIPLINA_E2 = "d_13"

# Maquina temporal para la prueba de "sin ordenes". El nombre lleva un prefijo propio
# para poder identificarla sin ambiguedad.
MAQUINA_PRUEBA_NOMBRE = "ZZ Maquina sin OTs (prueba)"


@pytest.fixture
async def maquina_sin_ots(db_pool):
    """Crea una maquina de la empresa 1 SIN ordenes de trabajo, y la borra al final.

    Es la unica escritura del archivo y es reversible: la fila se elimina en el teardown
    aunque la prueba falle. Reemplaza la dependencia del seed que quedo obsoleta.
    """
    fila = await fetch_one(
        """
        INSERT INTO maquina (planta_id, disciplina_id, nombre, codigo)
        VALUES (1, NULL, %(nombre)s, %(codigo)s)
        RETURNING maquina_id
        """,
        {"nombre": MAQUINA_PRUEBA_NOMBRE, "codigo": "ZZ-SIN-OTS"},
    )
    maquina_id = fila["maquina_id"]
    try:
        # El prefijo `m_` lo fija el contrato del mapa (topology.py:129).
        yield f"m_{maquina_id}"
    finally:
        # En orden inverso: primero las OTs (ninguna, por construccion) y despues la
        # maquina. Asi el teardown tambien funciona si algo llegara a crear una OT.
        await execute("DELETE FROM orden_trabajo WHERE maquina_id = %(m)s", {"m": maquina_id})
        await execute("DELETE FROM maquina WHERE maquina_id = %(m)s", {"m": maquina_id})


async def _login(client, creds) -> dict:
    r = await client.post("/api/auth/login", json={"email": creds[0], "password": creds[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _nodo(client, headers, nodo_id: str, qs: str = ""):
    return await client.get(f"/api/topology/{nodo_id}{qs}", headers=headers)


# =============================================================================
# Camino feliz
# =============================================================================

async def test_maquina_con_ots_devuelve_nodo_ordenes_e_hijos(client):
    """Forma completa de la respuesta para una máquina que sí tiene órdenes."""
    h = await _login(client, ADMIN_E1)
    r = await _nodo(client, h, MAQUINA_CON_OTS)

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert set(cuerpo.keys()) == {"nodo", "ordenes", "hijos"}

    nodo = cuerpo["nodo"]
    assert nodo["nodo_id"] == MAQUINA_CON_OTS
    assert nodo["tipo"] == "Máquina"
    assert isinstance(nodo["maquina_id"], int)

    # El número de órdenes se contrasta con la BD, no se fija a mano.
    esperadas = await fetch_all(
        """
        SELECT count(*) AS n FROM orden_trabajo ot
        JOIN maquina m ON m.maquina_id = ot.maquina_id
        JOIN planta p ON p.planta_id = m.planta_id
        WHERE ot.maquina_id = %(id)s AND p.empresa_id = 1
        """,
        {"id": nodo["maquina_id"]},
    )
    assert len(cuerpo["ordenes"]) == esperadas[0]["n"]
    assert len(cuerpo["ordenes"]) > 0, "m_1 debería tener órdenes en el seed"

    # Una máquina no contiene otras máquinas.
    assert cuerpo["hijos"] == []


async def test_las_ordenes_traen_el_contrato_de_ots(client):
    """Las órdenes usan el mismo contrato que /api/work-orders, no uno paralelo."""
    h = await _login(client, ADMIN_E1)
    cuerpo = (await _nodo(client, h, MAQUINA_CON_OTS)).json()
    ot = cuerpo["ordenes"][0]

    for campo in ("numero_ot", "estado", "priority", "title", "machine_id", "allowed_transitions"):
        assert campo in ot, f"falta {campo} en la orden"
    # `estado` es el valor crudo, que es lo que la UI necesita para agrupar (D1).
    assert ot["estado"] in {"pending", "assigned", "in_progress", "overdue", "completed", "cancelled"}
    assert ot["machine_id"] == cuerpo["nodo"]["maquina_id"]


async def test_maquina_sin_ots_devuelve_lista_vacia(client, maquina_sin_ots):
    """Sin órdenes no es un error: es una lista vacía.

    Usa una maquina creada por el propio test en vez de depender de que el seed deje
    alguna sin OTs. Antes se usaba `m_11` fijo; el historial sintetico del dashboard le
    dio 15 OTs y la premisa dejo de ser cierta.
    """
    h = await _login(client, ADMIN_E1)
    r = await _nodo(client, h, maquina_sin_ots)

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["nodo"]["nodo_id"] == maquina_sin_ots
    assert cuerpo["ordenes"] == []
    assert cuerpo["hijos"] == []


async def test_planta_devuelve_hijos_y_sin_ordenes(client):
    """Una planta contiene disciplinas y no tiene órdenes propias."""
    h = await _login(client, ADMIN_E1)
    r = await _nodo(client, h, PLANTA_E1)

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["nodo"]["tipo"] == "Planta"
    assert cuerpo["ordenes"] == []
    assert cuerpo["hijos"], "la planta 1 tiene máquinas, así que debe tener disciplinas"
    assert {x["tipo"] for x in cuerpo["hijos"]} == {"Disciplina"}
    # Los hijos deben ser nodos del mismo contrato que el mapa.
    for hijo in cuerpo["hijos"]:
        assert {"nodo_id", "nombre_visual", "tipo", "estado_actual"} <= set(hijo.keys())


async def test_disciplina_devuelve_hijos_maquina(client):
    """Una disciplina contiene máquinas."""
    h = await _login(client, ADMIN_E2)
    r = await _nodo(client, h, DISCIPLINA_E2)

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["nodo"]["tipo"] == "Disciplina"
    assert cuerpo["ordenes"] == []
    assert cuerpo["hijos"], "d_13 tiene máquinas en el seed"
    assert {x["tipo"] for x in cuerpo["hijos"]} == {"Máquina"}
    assert all(isinstance(x["maquina_id"], int) for x in cuerpo["hijos"])


async def test_el_nodo_del_detalle_es_identico_al_del_mapa(client):
    """El detalle no puede inventar coordenadas: debe ser el mismo nodo que dibuja el mapa."""
    h = await _login(client, ADMIN_E1)
    mapa = (await client.get("/api/topology", headers=h)).json()
    en_mapa = next(n for n in mapa["nodos"] if n["nodo_id"] == MAQUINA_CON_OTS)
    en_detalle = (await _nodo(client, h, MAQUINA_CON_OTS)).json()["nodo"]
    assert en_detalle == en_mapa


# =============================================================================
# Nodo inexistente
# =============================================================================

@pytest.mark.parametrize("nodo_id", ["m_999999", "p_999999", "d_999999", "xyz"])
async def test_nodo_inexistente_devuelve_404(client, nodo_id):
    h = await _login(client, ADMIN_E1)
    r = await _nodo(client, h, nodo_id)
    assert r.status_code == 404, r.text
    assert r.json()["detail"] == "Nodo de topología no encontrado."


# =============================================================================
# Aislamiento multi-empresa (CGBIDA-379)
# =============================================================================

@pytest.mark.parametrize("nodo_ajeno", [PLANTA_E1, MAQUINA_CON_OTS, "d_1"])
async def test_empresa_no_ve_nodos_de_otra_empresa(client, nodo_ajeno):
    """Un usuario de la empresa 2 no puede abrir un nodo de la empresa 1: 404.

    Mismo criterio que el mapa: no se revela si el nodo no existe o es de otro cliente.
    """
    h = await _login(client, ADMIN_E2)
    r = await _nodo(client, h, nodo_ajeno)
    assert r.status_code == 404, f"{nodo_ajeno} no debería ser visible desde la empresa 2: {r.text}"


async def test_empresa_ve_sus_propios_nodos(client):
    """Contraprueba del test anterior: los nodos propios sí responden."""
    h = await _login(client, ADMIN_E2)
    for nodo_id in (PLANTA_E2, DISCIPLINA_E2):
        r = await _nodo(client, h, nodo_id)
        assert r.status_code == 200, f"{nodo_id} debería ser visible desde la empresa 2: {r.text}"


async def test_las_ordenes_no_cruzan_empresas(client):
    """Aunque el nodo sea propio, sus órdenes no pueden traer datos de otra empresa."""
    h = await _login(client, ADMIN_E2)
    cuerpo = (await _nodo(client, h, PLANTA_E2)).json()
    # Se recorren todas las máquinas de la planta y se piden sus órdenes.
    for hijo in (await _nodo(client, h, DISCIPLINA_E2)).json()["hijos"]:
        detalle = (await _nodo(client, h, hijo["nodo_id"])).json()
        for ot in detalle["ordenes"]:
            assert ot["machine_id"] == hijo["maquina_id"], "una OT apunta a otra máquina"
    assert cuerpo["nodo"]["tipo"] == "Planta"


async def test_super_usuario_no_accede_al_detalle_de_nodos(client):
    """El super_usuario (empresa NULL) no tiene acceso a la topología de ninguna empresa."""
    h = await _login(client, SUPER)
    assert (await _nodo(client, h, MAQUINA_CON_OTS)).status_code == 403
    assert (await _nodo(client, h, PLANTA_E2, "?empresa_id=1")).status_code == 403


# =============================================================================
# Permisos y autenticación
# =============================================================================

async def test_visitante_puede_leer(client):
    """La matriz da 'ver' al visitante en topología (permissions.py:44)."""
    h = await _login(client, VISITANTE_E1)
    r = await _nodo(client, h, MAQUINA_CON_OTS)
    assert r.status_code == 200, r.text
    assert r.json()["nodo"]["nodo_id"] == MAQUINA_CON_OTS


async def test_sin_token_no_devuelve_datos(client):
    """Hoy 422 porque FastAPI valida el header antes del guard (deuda: CGBIDA-374)."""
    r = await client.get(f"/api/topology/{MAQUINA_CON_OTS}")
    assert r.status_code == 422, r.text


async def test_token_invalido_devuelve_401(client):
    r = await client.get(
        f"/api/topology/{MAQUINA_CON_OTS}",
        headers={"Authorization": "Bearer token-que-no-existe"},
    )
    assert r.status_code == 401, r.text


async def test_alias_topologia_funciona_igual(client):
    """El contrato expone `/api/topologia/{nodo}` como alias."""
    h = await _login(client, ADMIN_E1)
    a = await client.get(f"/api/topology/{MAQUINA_CON_OTS}", headers=h)
    b = await client.get(f"/api/topologia/{MAQUINA_CON_OTS}", headers=h)
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
