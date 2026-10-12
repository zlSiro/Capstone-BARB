# Contrato API `/api/topology` (HU-07 y HU-377)

> Mapa navegable de la planta en tres niveles — plantas, disciplinas y máquinas — con el
> estado de cada equipo derivado de sus órdenes de trabajo.
> Decisiones de diseño: ver CGBIDA-355. Aislamiento multi-empresa: CGBIDA-356.
> Detalle por nodo (OTs e hijos): CGBIDA-379, documentado aquí en CGBIDA-381.
>
> **Dos endpoints:**
> - `GET /api/topology` — el mapa completo (HU-07, CGBIDA-358).
> - `GET /api/topology/{nodo_id}` — un nodo con sus órdenes de trabajo y sus hijos (HU-377).

Un solo documento para los dos: el segundo es un subrecurso del primero y comparte base,
permisos y códigos de error. Separarlos obligaría a duplicar la mitad del contenido.

## Base

- **Rutas:** `GET /api/topology` · alias `GET /api/topologia`
  (`backend/src/barb/routers/topology.py:167-168`)
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

`backend/src/barb/routers/topology.py:67-150`

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
(`backend/src/barb/routers/topology.py:46-65`), no de una columna de estado del equipo:

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
`operativo` (`topology.py:90,113`); solo las Máquinas reciben estado derivado
(`topology.py:138`).

---

## Comportamiento multi-empresa

El endpoint aísla por `empresa_id` (CGBIDA-356). El aislamiento se aplica a **las cuatro**
consultas: `planta` y `disciplina` filtran por su propia columna `empresa_id`, `maquina` filtra
por la empresa de su planta, y el cálculo de estado de OT se acota a las máquinas ya filtradas
(`backend/src/barb/routers/topology.py:24-49`).

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

## `GET /api/topology/{nodo_id}` — detalle de un nodo

Alias: `GET /api/topologia/{nodo_id}`. Devuelve **un nodo del mapa** junto con lo que
contiene. Existe para que el panel de detalle no tenga que pedir el mapa entero ni cruzar
listas en el cliente.

**Ruta y línea:** `backend/src/barb/routers/topology.py:195-196` (rutas) y `:197-226` (handler).

### Parámetros

| Nombre | Dónde | Tipo | Obligatorio | Descripción |
|---|---|---|---|---|
| `nodo_id` | path | string | ✅ | Identificador del nodo, tal como lo emite el mapa |
| `empresa_id` | query | int | ❌ | Solo tiene efecto para el `super_usuario`. Igual que en el mapa |

El `nodo_id` sigue el formato `<prefijo>_<id>`: `p_<planta_id>`, `d_<disciplina_id>`,
`m_<maquina_id>`.

### Response `200`

```json
{
  "nodo":   { ... },
  "ordenes": [ ... ],
  "hijos":  [ ... ]
}
```

| Campo | Tipo | Contenido |
|---|---|---|
| `nodo` | objeto | **Exactamente el mismo objeto** que el mapa emite para ese `nodo_id` (mismos campos y mismas coordenadas) |
| `ordenes` | array | Órdenes de trabajo de la máquina. **Vacío** si el nodo no es Máquina |
| `hijos` | array | Nodos que este nodo contiene directamente. **Vacío** en una Máquina |

**`nodo` y `hijos` usan los campos de la sección "Campos de un nodo"** más abajo: no se
redefinen aquí.

#### Qué contiene cada tipo de nodo

| Tipo de nodo | `ordenes` | `hijos` |
|---|---|---|
| **Máquina** | Sus órdenes de trabajo | `[]` — una máquina no contiene otras máquinas |
| **Planta** | `[]` | Sus **disciplinas** |
| **Disciplina** | `[]` | Sus **máquinas** |

Los hijos se derivan de **las aristas del propio grafo** (`_hijos_de`,
`topology.py:152-164`), no de una consulta aparte. Así el panel y el mapa no pueden discrepar
sobre quién contiene a quién, y se heredan las reglas A-2/A-3 sin volver a implementarlas.

En una disciplina repartida en varias plantas (regla A-3), `hijos` lista **todas** sus
máquinas, sin duplicados.

#### Los `estado` de `nodo` son los mismos del mapa

`operativo` · `alerta` · `falla` (ver "Estados de un nodo"). El endpoint **no introduce
estados nuevos**. Solo las Máquinas reciben estado derivado; Planta y Disciplina van siempre
como `operativo`.

#### Campos de `ordenes`

**No se documentan aquí.** Cada elemento es la misma OT que devuelve el listado de órdenes de
trabajo, con su contrato completo (campos, significados y `allowed_transitions`):

> **Ver `docs/WORK_ORDERS.md`, sección 2 "Contrato API"**.

Se reutiliza el mismo serializador del backend (`row_to_work_order`), así que reescribir los
campos aquí garantizaría que los dos documentos se separen con el primer cambio.

Lo que sí importa para el panel: `estado` llega en **crudo** (`pending`, `assigned`,
`in_progress`, `overdue`, `completed`, `cancelled`), que es lo que la UI necesita para agrupar.

### Ejemplos de respuesta

#### Nodo Máquina — `GET /api/topology/m_13`

```json
{
  "nodo": {
    "nodo_id": "m_13",
    "maquina_id": 13,
    "nombre_visual": "Sistema Lubricación Molino",
    "tipo": "Máquina",
    "icono": "🤖",
    "pos_x": 50, "pos_y": 500,
    "estado_actual": "alerta"
  },
  "ordenes": [
    {
      "numero_ot": "OT-2026-106",
      "estado": "assigned",
      "status": "Asignada",
      "priority": "low",
      "title": "Cambio de aceite y filtros del molino",
      "machine_id": 13,
      "allowed_transitions": ["in_progress", "cancelled"]
    }
  ],
  "hijos": []
}
```

> La OT se muestra recortada a los campos que el panel usa. El objeto real trae el contrato
> completo de `docs/WORK_ORDERS.md`.

#### Nodo Planta — `GET /api/topology/p_4`

```json
{
  "nodo": {
    "nodo_id": "p_4", "nombre_visual": "Faena Chancado Norte",
    "tipo": "Planta", "icono": "🏭", "pos_x": 500, "pos_y": 100,
    "estado_actual": "operativo"
  },
  "ordenes": [],
  "hijos": [
    { "nodo_id": "d_13", "nombre_visual": "Eléctrica",  "tipo": "Disciplina", "estado_actual": "operativo", "pos_x": 200, "pos_y": 300 },
    { "nodo_id": "d_14", "nombre_visual": "Mecánica",   "tipo": "Disciplina", "estado_actual": "operativo", "pos_x": 450, "pos_y": 300 }
  ]
}
```

#### Nodo Disciplina — `GET /api/topology/d_13`

```json
{
  "nodo": {
    "nodo_id": "d_13", "nombre_visual": "Eléctrica",
    "tipo": "Disciplina", "icono": "⚙️", "pos_x": 200, "pos_y": 300,
    "estado_actual": "operativo"
  },
  "ordenes": [],
  "hijos": [
    { "nodo_id": "m_16", "maquina_id": 16, "nombre_visual": "Celda de Flotación CF-2", "tipo": "Máquina", "estado_actual": "operativo" },
    { "nodo_id": "m_17", "maquina_id": 17, "nombre_visual": "Subestación Eléctrica SE-4", "tipo": "Máquina", "estado_actual": "operativo" }
  ]
}
```

### Códigos de respuesta

| Código | Causa | Detalle | Verificado |
|---|---|---|---|
| `200` | Nodo encontrado y visible para la empresa del usuario | `{nodo, ordenes, hijos}` | ✅ con comando |
| `401` | Token inválido, expirado o header mal formado | Igual que el mapa | ✅ con comando |
| `404` | El `nodo_id` no existe, **o existe pero es de otra empresa** | `{"detail": "Nodo de topología no encontrado."}` | ✅ con comando |
| `422` | Falta el header `Authorization` | Array de errores de FastAPI | ✅ con comando |
| `500` / `503` | Fallo inesperado / base de datos no disponible | Análogos al mapa | ⚠️ NO VERIFICABLE en vivo |

### Aislamiento multi-empresa

Un usuario de la empresa A **no puede abrir un nodo de la empresa B**: recibe **`404`**, no
`403`. Es deliberado y es el mismo criterio que el mapa: **no se revela si el nodo no existe
o si es de otro cliente.** Un `403` confirmaría la existencia del nodo ajeno.

Verificado por comando: `admin@mineranorte.cl` (empresa 2) obtiene **404** en `p_1`, `m_1` y
`d_1`, que son de la empresa 1; y **200** en `p_4` y `d_13`, que son suyos.

Cubierto por `backend/tests/test_topology_nodo.py::test_empresa_no_ve_nodos_de_otra_empresa`
(parametrizado en 3 nodos) y por `test_las_ordenes_no_cruzan_empresas`. La mutación de quitar
el `empresa_id` del alcance hace **fallar 4 tests**, así que el aislamiento no está sin cubrir.

**El `super_usuario` (empresa `NULL`) los ve todos**; con `?empresa_id=1` vuelve a quedar
acotado.

### Permisos

`require_route("topology", solo_lectura=True)` — el mismo guard del mapa
(`topology.py:195` y `:196`). **`visitante` puede leer** (`permissions.py:44` le da `"ver"`).

La decisión (CGBIDA-378, D4) es deliberada: el endpoint es un **subrecurso** de la topología,
así que exige su permiso y no uno más laxo. El listado de órdenes usa `require_auth`
(`work_orders.py:162`), que **no consulta la matriz** — porque alimenta desplegables del
formulario. Reutilizar esa laxitud aquí dejaría el subrecurso sin la comprobación que su
endpoint padre sí hace, y retirarle a un rol el permiso de topología no le quitaría el acceso
a los datos de la topología.

**Efecto concreto:** quien puede ver el nodo en el mapa, puede ver qué contiene.

### Ejemplo

```bash
curl -s http://localhost:9000/api/topology/m_13 \
  -H "Authorization: Bearer $TOKEN"
```

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
| 1 | Los códigos `500` y `503` en vivo | Provocarlos exige tumbar la base de datos de desarrollo. Están implementados (`topology.py:179-190` para el mapa, `:230-241` para el detalle) y cubiertos por test (`test_topology.py:35,46,54`), pero no observados en vivo |
| 2 | Que `403` sea **imposible** en toda configuración | Verificado que no ocurre con los 7 roles definidos. Si se añadiera un rol nuevo sin entrada en la matriz, el código devolvería `500`, no `403`; no se probó ese escenario |
| 3 | Comportamiento con **tres o más** plantas por disciplina | El seed solo tiene disciplinas repartidas en **2** plantas (empresa 2). Que funcione con 2 es lo verificado (`test_topology.py::test_a3_disciplina_con_maquinas_en_varias_plantas_se_conecta_a_todas`); el caso de 3+ no tiene datos |

## Pendiente respecto de las decisiones aprobadas

**A-2 y A-3 quedaron implementadas** en CGBIDA-376 (ver "Qué equipos aparecen en el mapa").
Este documento las describe como comportamiento vigente.

Queda pendiente, en **CGBIDA-370**, decidir el destino de las cuatro tablas del esquema
`topologia_zona` / `topologia_nodo` / `topologia_conexion` / `zona_nodo`: existen, están
pobladas y **ningún código las lee**. La decisión y sus opciones viven en
`docs/TOPOLOGIA.md`; aquí solo se referencia para no duplicar.
