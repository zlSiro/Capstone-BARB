# Topología de planta — comportamiento y tablas sin uso

> **Estado:** documento de decisión. La decisión sobre las tablas `topologia_*` está
> **pendiente** (CGBIDA-370). La decisión sobre los **permisos del endpoint de detalle** ya se
> tomó (CGBIDA-378, D4) y está en la sección 4.
>
> El contrato de la API vive en `docs/contrato_api_topologia.md` y **no se duplica aquí**.

## 1. Qué equipos aparecen en el mapa (implementado, CGBIDA-376)

Los nodos se derivan de las **máquinas** que el usuario puede ver, no del catálogo completo.
Dos reglas, aprobadas en CGBIDA-355:

| Regla | Comportamiento | Razón |
|---|---|---|
| **A-2** | Una planta sin máquinas **no aparece** | Mostrarla sugeriría actividad inexistente |
| **A-3** | Una disciplina se dibuja **una vez** y se conecta a **cada planta donde tenga máquinas** | `disciplina` pertenece a la empresa, no a una planta |

**Corolario:** una disciplina sin máquinas en las plantas visibles tampoco aparece: sería un
nodo sin aristas, el mismo problema que A-2 evita en el nivel superior.

### El detalle de un nodo (HU-377, CGBIDA-379)

El mapa tiene ahora un segundo endpoint, `GET /api/topology/{nodo_id}`, que devuelve un nodo
con sus órdenes de trabajo y sus hijos. **Los hijos se derivan de las aristas del mismo
grafo**, así que A-2 y A-3 se heredan sin volver a implementarlas: lo que el mapa no dibuja,
el panel tampoco lo lista.

El contrato exacto —rutas, respuesta, códigos y ejemplos— está en
`docs/contrato_api_topologia.md`, sección "detalle de un nodo". **No se repite aquí.**

**Consecuencia de A-3:** el grafo deja de ser un árbol estricto de tres niveles. Un nodo de
disciplina puede tener varios padres. El cliente debe soportarlo.

## 1.a El panel de detalle (HU-377, CGBIDA-382 a 386)

Al seleccionar un nodo se abre un panel que muestra **contenido según su nivel**, y que es
**navegable**: los hijos son clicables.

| Nivel del nodo | El panel muestra |
|---|---|
| **Máquina** | Sus órdenes de trabajo, agrupadas |
| **Planta** | Sus disciplinas |
| **Disciplina** | Sus máquinas |

### Agrupación de las órdenes: 3 grupos + Canceladas

`filterGroup()` (`frontend/src/app/features/work-orders/utils/work-order-labels.ts:74-77`) es la
**única** fuente de la agrupación. El panel de topología la reutiliza; no la reimplementa.

| Estado original | Grupo del panel | Por qué |
|---|---|---|
| `pending` | **Pendientes** | Estado inicial |
| `assigned` | **Pendientes** | Transiciones idénticas a `pending` (`backend/src/barb/core/work_order_states.py:27`) |
| `overdue` | **Pendientes** | Idem (`:28`). Se agrupa por **ciclo de vida**, no por urgencia |
| `in_progress` | **En curso** | Ya iniciada |
| `completed` | **Cerradas** | Estado final |
| `cancelled` | **Canceladas** (grupo propio) | Estado final, y **no debe confundirse con cerrada** |

El orden de presentación es Pendientes → En curso → Cerradas → Canceladas: primero lo que exige
acción. **Los grupos vacíos no se dibujan.**

**`overdue` dentro de Pendientes es contraintuitivo**, así que lleva un **badge rojo** en la
tarjeta. Así el supervisor lo distingue a simple vista sin que se cree un cuarto grupo que
obligaría a tocar también la vista de OTs existente (decisión de CGBIDA-378).

### Navegación: el botón "Volver"

Al pulsar un hijo, el panel pasa a mostrar ese hijo y se apila el nodo anterior. Aparece un
botón **"Volver"** que sube un nivel. La pila vive **en memoria del componente**, no en la URL:
no hay ruta por nodo, así que recargar la página pierde la navegación.

Detalle de implementación que costó un bug: **la pila debe ser una señal** (no un array plano).
Un `computed` que lea un array mutado con `push` se memoriza con el primer valor y nunca se
invalida, así que el botón no aparecía.

### Comportamiento con muchas órdenes (CGBIDA-386)

El panel tiene **scroll propio** (`overflow-y-auto` + `max-h-[85%]`) y **no limita** el número
de órdenes: las renderiza todas.

Los **encabezados de grupo quedan fijos** al desplazarse (`sticky top-0 z-10 bg-white`). El
fondo opaco es imprescindible: sin él, el contenido que pasa por debajo se transparenta a
través del encabezado.

Verificado con un test de 20 órdenes repartidas en los 4 grupos. **Con los datos actuales
(1-2 OTs por máquina) el caso no se ejerce en producción**, así que el volumen solo está
cubierto por test, no por uso real. Si en el futuro una máquina acumula decenas de órdenes,
lo siguiente sería un límite con "ver todas" por grupo.

## 1.b El legacy no resolvió ninguno de los dos casos

`BARB\backend\main.py:3353-3360` conectaba **toda** disciplina a `plantas[0]`, con un
comentario que lo admitía: *"Conectamos cada disciplina a la primera planta disponible (raíz)"*.
Y su seed no tenía plantas vacías, así que A-2 nunca se le presentó.

## 1.c Permisos del detalle de nodo (decidido en CGBIDA-378, D4)

El endpoint de detalle usa **`require_route("topology", solo_lectura=True)`**, el mismo guard
del mapa. El `visitante` puede leer (`permissions.py:44` le da `"ver"`): **quien puede ver el
nodo en el mapa, puede ver qué contiene.**

**La alternativa descartada y por qué.** El listado de órdenes de trabajo usa `require_auth`
(`work_orders.py:162`), una dependencia que **no consulta la matriz de rutas**: su docstring la
define para *"datos de referencia que no aparecen en la matriz"*, porque alimenta los
desplegables del formulario de creación. Copiar esa laxitud en un **subrecurso de la
topología** habría dejado el detalle sin la comprobación que su endpoint padre sí hace: quitarle
a un rol el permiso de topología no le habría quitado el acceso a los datos de la topología.

**Consecuencia de aislamiento:** un usuario de la empresa A que pida un nodo de la empresa B
recibe **404**, no 403. No se revela si el nodo no existe o si es de otro cliente.

## 2. Las tablas `topologia_*`: evidencia

### 2.1 Estado actual

| Tabla | Filas | Última escritura |
|---|---|---|
| `topologia_zona` | 10 | 2026-09-25 |
| `topologia_nodo` | 12 | `updated_at` = **2026-09-25 01:36:26** (todos idénticos) |
| `topologia_conexion` | 15 | 2026-09-25 |
| `zona_nodo` | **0** | — (nunca se pobló) |

`topologia_nodo` no tiene `created_at`; `updated_at` es idéntico en las 12 filas, lo que
confirma que se escribieron de una sola vez y **nunca se volvieron a tocar**.

### 2.2 Ningún código las lee

```
grep 'topologia_zona|topologia_nodo|topologia_conexion|zona_nodo' en backend/src/
-> NINGUNA referencia
```

Solo aparecen en:
- `backend/migrations/versions/0001_initial_schema.py:162-208` — donde se **crean**
- `backend/seeds/seed_data.sql:97,110,125` — donde se **pueblan**

Es decir: se crean, se llenan una vez y nadie las consulta.

### 2.3 Qué aportan que el endpoint sintetizado NO puede producir

| Campo | En la tabla | En el endpoint |
|---|---|---|
| `position_x/y/z` | Coordenadas reales | **Calculadas** por contador (`x_offset += 300/250/180`, `pos_y` fijo en 100/300/500) |
| `tipo` (`machine`/`controller`/`sensor`/`hub`) | 4 tipos, incluida infraestructura | Solo `Planta`/`Disciplina`/`Máquina` |
| `categoria` | Texto libre | No existe |
| `sensor_id` | FK a `sensor` | No existe |
| `tipo_conexion` (`electrical`/`mechanical`/`data`/`hydraulic`/`pneumatic`) | Tipado | Solo `jerarquia`/`pertenece` |
| `label`, `bidirectional`, `bandwidth`, `strength` | Presentes | No existen |
| `estado_nodo` (`operational`/`warning`/`error`/`offline`) | Enum de 4 valores | 3 valores derivados de OTs |

### 2.4 Pero el estado guardado está desactualizado

Comparación de `topologia_nodo.estado` contra el estado que el sistema deriva de las OTs:

| Máquina | `topologia_nodo.estado` | Derivado de OTs | ¿Coincide? |
|---|---|---|---|
| 1 | `warning` | alerta | ✅ |
| 2 | `operational` | **falla** | ❌ |
| 3 | `error` | **operativo** | ❌ |
| 4 | `operational` | **alerta** | ❌ |
| 6 | `warning` | **operativo** | ❌ |
| 7 | `operational` | operativo | ✅ |
| 8 | `operational` | operativo | ✅ |
| 9 | `operational` | **alerta** | ❌ |

**Discrepan 5 de 8.** El estado guardado es una foto del 25/09; las OTs siguieron cambiando.

### 2.5 Cobertura

Los 12 nodos pertenecen a **una sola planta** (`planta_id = 1`) y alcanzan **8 de las 21
máquinas**. 4 de los 12 nodos no representan equipos sino infraestructura
(`hub`, `controller` ×2, `sensor`).

## 3. Tres opciones

### Opción (a) — Usarlas como fuente real en el futuro

**Razón técnica:** son el único lugar del esquema que modela disposición física
(`position_x/y/z`), tipos de conexión y zonas, así que un "plano de planta" real solo puede
construirse sobre ellas.

**Coste:** endpoint nuevo, repoblado de las 3 tablas para las 4 empresas con máquinas
(hoy solo hay datos de la planta 1), mecanismo que mantenga `estado` sincronizado con las OTs
—hoy discrepa en 5 de 8—, y poblar `zona_nodo`, que está vacía. Cambia el contrato que
consumen CGBIDA-361/362.

### Opción (b) — Documentarlas como legado y dejar el schema intacto

**Razón técnica:** no leerlas no cuesta nada y eliminarlas no aporta beneficio medible, así
que documentar su estado evita que alguien las tome por una fuente vigente.

**Coste:** cero en código. Deja cuatro tablas pobladas y sin dueño, con el riesgo de que un
desarrollador futuro las lea creyendo que están al día.

### Opción (c) — Eliminarlas del schema en una migración futura

**Razón técnica:** cuatro tablas sin lector son superficie muerta que confunde, y
`zona_nodo` está vacía desde su creación, así que no hay datos que preservar.

**Coste:** una migración `DROP TABLE` (con `zona_nodo` → `topologia_conexion` →
`topologia_nodo` → `topologia_zona` por las FK) y la pérdida de las 37 filas sembradas, que
son el único registro de la disposición física de la planta del legacy.

## 4. Recomendación

**Opción (b), con una salvedad.** Es la de menor riesgo y coste: no hay lector que romper y
no se destruye información que el legacy usó para algo que el rewrite todavía no intenta
(el plano físico). La salvedad es que documentar sin fecha de caducidad equivale a aplazar la
decisión: conviene fijar que, si ninguna HU del próximo sprint planea un plano físico, se
pase a (c).

La opción (a) solo se justifica si existe una HU que requiera disposición física real. Hoy
CGBIDA-310 pide un mapa navegable con colores por estado, que el endpoint sintetizado ya
entrega.

**Decide René.** No se implementa ninguna de las tres.
