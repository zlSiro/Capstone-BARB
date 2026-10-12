# Contrato API `/api/topology` (HU-07)

> Mapa navegable de la planta en tres niveles — plantas, disciplinas y máquinas — con el
> estado de cada equipo derivado de sus órdenes de trabajo.
> Decisiones de diseño: ver CGBIDA-355. Aislamiento multi-empresa: CGBIDA-356.

## Base

- **Rutas:** `GET /api/topology` · alias `GET /api/topologia`
  (`backend/src/barb/routers/topology.py:17-18`)
- **Autenticación:** ✅ **requerida**. Header `Authorization: Bearer <token>`.
  El token se obtiene en `POST /api/auth/login` y se valida contra la tabla `sesion`.
- **Content-Type response:** `application/json`
- **Parámetros de query:** `empresa_id` (int, opcional). Ver "Comportamiento multi-empresa".

### Permisos RBAC

Todos los roles acceden a la topología; `visitante` en modo solo lectura.
Matriz idéntica en backend y frontend:
`backend/src/barb/core/permissions.py:44` y
`frontend/src/app/core/permissions/permissions.ts:58`

| Rol | Acceso |
|---|---|
| operador, tecnico, supervisor, engineer, gerente, admin | ✅ completo |
| visitante | ✅ `"ver"` (solo lectura) |

El endpoint es de solo lectura: no existe variante de escritura, así que el permiso `"ver"`
siempre alcanza.

### Códigos de error

| Código | Causa | Detalle | Verificado |
|---|---|---|---|
| `401` | Token inválido, expirado, o header `Authorization` mal formado | `{"detail": "Sesión inválida o expirada. Vuelve a iniciar sesión."}` | ✅ con comando |
| `403` | **No alcanzable por rol en este endpoint** — ver nota | — | ✅ por comando |
| `422` | Falta el header `Authorization`, o `empresa_id` no es un entero | Array de errores de FastAPI | ✅ con comando |
| `500` | Fallo inesperado al generar la topología | `{"detail": "Error interno al generar la topología."}` | ⚠️ ver nota |
| `503` | La base de datos no está disponible (conexión caída o pool agotado) | `{"detail": "No se pudo consultar la topología: la base de datos no está disponible."}` | ⚠️ ver nota |

**Nota sobre `403`:** no es alcanzable. La matriz de rutas da acceso a los 7 roles
(`permissions.py:44`), y verificado por comando: `visitante@planta.com` obtiene **HTTP 200**.
El único camino a un `403` en el código es la dependencia `require_route`, que no deniega a
ningún rol definido. Si el rol del usuario no existe en la matriz, el código devuelve **500**,
no 403 (`permissions.py:101`: `Ruta 'topology' no está definida en permissions.py`).

**Nota sobre `500` y `503`:** el mapeo está implementado y cubierto por test
(`backend/tests/test_topology.py:35,46,54`), pero los códigos **no se observaron en vivo**:
provocarlos exigiría tumbar la base de datos de desarrollo. Se marcan como
**NO VERIFICABLE en vivo**; sí verificados por test con `fetch_all` simulado.

El comportamiento de `422` cuando falta el header es una consecuencia de que FastAPI valida el
esquema antes de ejecutar el guard. Está registrado como deuda transversal en **CGBIDA-374**
(se esperaría `401`).

---

## Qué equipos aparecen en el mapa

El endpoint **no devuelve el catálogo completo**: deriva los nodos de las máquinas que el
usuario puede ver. Dos reglas, decididas en CGBIDA-355 (A-2 y A-3) e implementadas en
CGBIDA-376:

| Regla | Comportamiento |
|---|---|
| **A-2** | Una **planta sin máquinas no aparece**. Mostrarla sugeriría actividad inexistente. |
| **A-3** | Una **disciplina se dibuja una sola vez** y se conecta a **cada planta donde tenga máquinas**. Como `disciplina` pertenece a la empresa y no a una planta, una disciplina repartida en N plantas emite N aristas `jerarquia`, todas desde el mismo nodo `d_<disciplina_id>`. |

**Corolario:** tampoco aparece una disciplina que no tenga máquinas en las plantas visibles.
Sería un nodo sin ninguna arista, el mismo problema que A-2 evita en el nivel superior.

**Consecuencia:** el grafo ya no es un árbol estricto de tres niveles: un nodo de disciplina
puede tener más de un padre. El cliente debe soportarlo.

`backend/src/barb/routers/topology.py:63-118`

### Efecto medido (seed de desarrollo)

| Vista | Plantas devueltas | Disciplinas multi-planta |
|---|---|---|
| Empresa 1 | 1 (de 3 en el catálogo; las otras 2 no tienen máquinas) | ninguna |
| Empresa 2 | 2 | `d_13` y `d_14`, conectadas a **ambas** |
| super_usuario | 4 (de 7 en total) | `d_13` y `d_14` |

---

## `GET /api/topology`

Devuelve la topología completa de la empresa del usuario como dos listas planas: `nodos` y
`conexiones`. El cliente reconstruye el grafo a partir de `origen_nodo_id` /
`destino_nodo_id`.

### Response `200`

```json
{
  "nodos": [
    {
      "nodo_id": "p_1",
      "nombre_visual": "Planta Central San Bernardo",
      "tipo": "Planta",
      "icono": "🏭",
      "pos_x": 500,
      "pos_y": 100,
      "estado_actual": "operativo"
    },
    {
      "nodo_id": "d_1",
      "nombre_visual": "Mecánica",
      "tipo": "Disciplina",
      "icono": "⚙️",
      "pos_x": 200,
      "pos_y": 300,
      "estado_actual": "operativo"
    },
    {
      "nodo_id": "m_1",
      "maquina_id": 1,
      "nombre_visual": "Compressor A1",
      "tipo": "Máquina",
      "icono": "🤖",
      "pos_x": 50,
      "pos_y": 500,
      "estado_actual": "alerta"
    }
  ],
  "conexiones": [
    {
      "conexion_id": "conn_p1_d_1",
      "origen_nodo_id": "p_1",
      "destino_nodo_id": "d_1",
      "tipo_relacion": "jerarquia"
    },
    {
      "conexion_id": "conn_d1_m_1",
      "origen_nodo_id": "d_1",
      "destino_nodo_id": "m_1",
      "tipo_relacion": "pertenece"
    }
  ]
}
```

### Campos de un nodo

| Campo | Tipo | Presente en | Descripción |
|---|---|---|---|
| `nodo_id` | string | siempre | Identificador. Prefijo por nivel: `p_<planta_id>`, `d_<disciplina_id>`, `m_<maquina_id>` |
| `nombre_visual` | string | siempre | Nombre a mostrar |
| `tipo` | string | siempre | `"Planta"` · `"Disciplina"` · `"Máquina"` |
| `icono` | string | siempre | Emoji fijo por nivel: `🏭` · `⚙️` · `🤖` |
| `pos_x` | int | siempre | Coordenada X. Generada por el backend, no es una posición física real |
| `pos_y` | int | siempre | Coordenada Y. Fija por nivel: `100` / `300` / `500` |
| `estado_actual` | string | siempre | Ver "Estados de un nodo" |
| `maquina_id` | int | **solo** en nodos de tipo `"Máquina"` | PK de `maquina`. Es el dato que permite enlazar al diagnóstico de un equipo |

Los nodos de tipo Planta y Disciplina **no** traen `maquina_id`. El frontend debe usar su
ausencia para decidir si ofrece acciones por equipo.

### Campos de una conexión

| Campo | Tipo | Descripción |
|---|---|---|
| `conexion_id` | string | `conn_p<planta>_d_<disc>` para jerarquía · `conn_d<disc>_m_<maq>` para pertenencia |
| `origen_nodo_id` | string | `nodo_id` del extremo origen |
| `destino_nodo_id` | string | `nodo_id` del extremo destino |
| `tipo_relacion` | string | `"jerarquia"` (planta→disciplina) · `"pertenece"` (disciplina→máquina) |

Una misma disciplina `d_<n>` puede aparecer como `destino_nodo_id` en **varias** aristas
`jerarquia`, una por planta donde tenga máquinas (ver "Qué equipos aparecen en el mapa").

### Estados de un nodo

Vocabulario canónico de **tres** valores, derivado **en vivo** de las órdenes de trabajo
(`backend/src/barb/routers/topology.py:39-57`), no de una columna de estado del equipo:

| Valor | Regla |
|---|---|
| `falla` | Existe una OT no cerrada con `priority = 'urgent'` o `estado = 'overdue'` |
| `alerta` | Existe alguna OT no `completed` ni `cancelled` |
| `operativo` | Ninguna OT abierta |

**Consecuencia de diseño, no defecto:** el estado refleja las **órdenes de trabajo**, no la
salud del equipo. Un equipo sano con una OT abierta aparece en `alerta`; un equipo averiado
sin OT abierta aparece `operativo`.

**Sobre `desconectado` / `offline`:** el cuarto estado está **decidido** (nombre "Desconectado"
en español, "Offline" en inglés, color gris — ver CGBIDA-355, decisión A-4) pero **el endpoint
no lo emite hoy**. La columna `topologia_nodo.estado` tiene el enum
`operational|warning|error|offline`, pero esta API **no lee esa tabla**. Si en el futuro se
emite, el valor esperado es `desconectado`.

### Estados observados en la práctica

Medido contra la base de datos de desarrollo (empresa 1, 21 nodos):
`alerta`, `falla`, `operativo`. Los nodos de Planta y Disciplina se emiten siempre como
`operativo` (`topology.py:83,107`); solo las Máquinas reciben estado derivado
(`topology.py:131`).

---

## Comportamiento multi-empresa

El endpoint aísla por `empresa_id` (CGBIDA-356). El aislamiento se aplica a **las cuatro**
consultas: `planta` y `disciplina` filtran por su propia columna `empresa_id`, `maquina` filtra
por la empresa de su planta, y el cálculo de estado de OT se acota a las máquinas ya filtradas
(`backend/src/barb/routers/topology.py:22-49`).

### Regla del parámetro `empresa_id`

| Quién | Sin `empresa_id` | Con `empresa_id` |
|---|---|---|
| Usuario con empresa (`empresa_id` no nulo) | Ve **su** empresa | El parámetro se **ignora**; sigue viendo su empresa |
| `super_usuario` (empresa `NULL`) | Ve **todas** las empresas | Ve **solo** la empresa indicada |

### Verificado por comando

| Caso | Resultado |
|---|---|
| `admin@barb.com` (empresa 1) | 21 nodos · **1 planta**: Central San Bernardo (las otras 2 no tienen máquinas y no aparecen) |
| `admin@mineranorte.cl` (empresa 2) | 13 nodos · plantas: Faena Chancado Norte, Concentradora Calama · **no** ve `Compressor A1` |
| `visitante@planta.com` (empresa 1, solo lectura) | 21 nodos |
| `super@barb.com` sin `empresa_id` | 39 nodos · **4 plantas** (de 7 en el catálogo) |
| `super@barb.com` con `empresa_id=1` | 21 nodos · la planta de la empresa 1 |
| `?empresa_id=abc` | **422** (`int_parsing`) |
| `?empresa_id=-1` o `999` (usuario normal) | **200** con sus propios datos: el parámetro se ignora |

---

## Ejemplo completo

```bash
TOKEN=$(curl -s -X POST http://localhost:9000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@barb.com","password":"admin123"}' | grep -oP '(?<="token":")[^"]+')

curl -s http://localhost:9000/api/topology \
  -H "Authorization: Bearer $TOKEN"
```

---

## NO VERIFICABLE

| # | Qué | Por qué |
|---|---|---|
| 1 | Los códigos `500` y `503` en vivo | Provocarlos exige tumbar la base de datos de desarrollo. Están implementados (`topology.py:124-137`) y cubiertos por test (`test_topology.py:35,46,54`), pero no observados en vivo |
| 2 | Que `403` sea **imposible** en toda configuración | Verificado que no ocurre con los 7 roles definidos. Si se añadiera un rol nuevo sin entrada en la matriz, el código devolvería `500`, no `403`; no se probó ese escenario |
| 3 | Comportamiento con **tres o más** plantas por disciplina | El seed solo tiene disciplinas repartidas en **2** plantas (empresa 2). Que funcione con 2 es lo verificado (`test_topology.py::test_a3_disciplina_con_maquinas_en_varias_plantas_se_conecta_a_todas`); el caso de 3+ no tiene datos |

## Pendiente respecto de las decisiones aprobadas

**A-2 y A-3 quedaron implementadas** en CGBIDA-376 (ver "Qué equipos aparecen en el mapa").
Este documento las describe como comportamiento vigente.

Queda pendiente, en **CGBIDA-370**, decidir el destino de las cuatro tablas del esquema
`topologia_zona` / `topologia_nodo` / `topologia_conexion` / `zona_nodo`: existen, están
pobladas y **ningún código las lee**. La decisión y sus opciones viven en
`docs/TOPOLOGIA.md`; aquí solo se referencia para no duplicar.
