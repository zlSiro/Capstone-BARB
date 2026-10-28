# Topología de planta

Este documento tiene dos partes, con dueños y estados distintos:

| Parte | Secciones | Estado |
|---|---|---|
| **Comportamiento del mapa** | §1, §1.a–§1.g | Implementado y verificado |
| **Decisión sobre las tablas `topologia_*`** | §2, §3, §4 | **Pendiente** (CGBIDA-370) |

El contrato de la API vive en `docs/contrato_api_topologia.md` y **no se duplica aquí**.
La revisión cruzada de HU-07 vive en `docs/verificacion_hu07_topologia.md`.

**Índice**

- §1 Qué equipos aparecen en el mapa
  - §1.a El panel de detalle
  - §1.b El legacy no resolvió ninguno de los dos casos
  - §1.c Permisos del detalle de nodo
  - §1.d El lienzo: encuadre, zoom y dibujo
  - §1.e Modo oscuro del mapa
  - §1.f El panel de OTs: filtro, orden y grupos plegables
  - §1.g Sincronización con el mantenedor de plantas
- §2 Las tablas `topologia_*`: evidencia
- §3 Tres opciones
- §4 Recomendación
- §5 Qué NO va en este documento

**Actualización 2026-10-16:** se documentan las mejoras visuales del lienzo, el panel de OTs y la
sincronización con el mantenedor de plantas (commits `9565a1c`, `49afd06`, `b96e0e8`, `f31c7de`,
`4236279`; HU-25 / CGBIDA-461, CGBIDA-462, CGBIDA-464 y CGBIDA-466).

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

## 1.d El lienzo: encuadre, zoom y dibujo (CGBIDA-362)

El mapa es un `<svg>` con `viewBox` propio, sin librería de grafos. Cuatro decisiones gobiernan
lo que se ve.

### 1.d.1 El encuadre se calcula, no se fija

`cajaContenido` (`topology.component.ts:866-881`) es el rectángulo que contiene **todos** los
nodos, más `PADDING_VISTA = 80` unidades de aire. Es la **vista inicial** y el **destino del
botón de reset**.

| Antes | Ahora | Por qué |
|---|---|---|
| Vista fija `1200x800` en `(-100,-50)` | Rectángulo que contiene el grafo | El mapa real llega a `x=2160`: con la vista fija **10 de los 21 nodos quedaban fuera de cuadro al cargar** |

`INITIAL_VIEW` (`:56`) sobrevive como **respaldo** para cuando todavía no hay nodos; con datos
nunca se usa. Y `resetView()` (`:927-932`) recalcula la caja en vez de restaurar una constante:
si el mapa cambió, el reset tiene que mostrar el mapa **nuevo** completo.

`viewBox` es una **signal** y `viewBoxAttr` un `computed` (`:883-891`): cada gesto actualiza un
objeto y Angular redibuja el atributo, sin tocar el DOM a mano.

### 1.d.2 Zoom y paneo

| Gesto | Implementación | Detalle |
|---|---|---|
| Botones | `zoom(1.2)` / `zoom(0.8)` (`:224-234`) | Escalan sobre el **centro actual** de la vista, no sobre el origen |
| Rueda | `onWheel` → `zoom(FACTOR_RUEDA)` o `1/1,15` (`:908-912`) | El `preventDefault()` es imprescindible: sin él la rueda scrollea la página mientras el usuario intenta acercarse |
| Reset | `resetView()` (`zoom-reset`, `:927`) | Vuelve a `cajaContenido`, no a `INITIAL_VIEW` mientras haya nodos |

`FACTOR_RUEDA = 1,15` (`:32`) se eligió por sensación: 1,2 salta, 1,1 se siente pegajoso.

El paneo arrastra el lienzo (`onMouseDown`/`onMouseMove`, `:934-953`) escalando el delta de
pantalla a unidades del `viewBox`. Los nodos **no** arrastran el mapa: `closest('.topo-node')`
corta el gesto, así que arrastrar sobre una tarjeta no mueve la cámara.

**Lo que se conserva:** al volver de otra pantalla el componente sigue montado, así que se
mantienen zoom y paneo (`:616`). Recargar los datos (`recargarTopologia()`, §1.g) tampoco mueve
la cámara.

### 1.d.3 Aristas con dirección

Las conexiones se dibujan con marcador de flecha y la punta se separa del borde de la tarjeta
con `AIRE_FLECHA = 4` (`:39`). Sin ese aire la flecha se apoya en el trazo del rectángulo y se
lee como parte del borde. El recorte (`:719`, `:739`) desplaza la punta sobre la recta
origen→destino.

### 1.d.4 Nombres de nodo

`ANCHO_NOMBRE_NODO = NODE_W - 16 = 114` (`:29`) es el ancho útil dentro de la tarjeta, y
`NODE_W/NODE_H` son `130x85` unidades del `viewBox`. `anchoNombre()` (`:922-925`) estima el ancho
del texto (11 px, peso 600, ~0,56 por carácter) y **solo si excede** devuelve el límite, que se
enlaza en `[attr.textLength]` con `lengthAdjust`: el nombre se comprime en vez de salirse.

Con `null` Angular omite el atributo y el nombre se dibuja natural. El caso que lo motivó:
«Planta Central San Bernardo» se salía del rectángulo y se montaba sobre el nodo vecino.

### 1.d.5 El color de un nodo

`COLOR_POR_ESTADO` (`:72-77`) mapea 4 estados a variables CSS de Tailwind v4
(`--color-emerald-500` / `amber-500` / `red-500` / `gray-400`). Se enlazan directo en un atributo
SVG porque en Tailwind v4 la utilidad se resuelve a `var(--color-*)`; las clases del legacy no
funcionan dentro de `<svg>`.

## 1.e Modo oscuro del mapa (CGBIDA-362)

El mapa responde al tema claro/oscuro como el resto de la aplicación, con una regla que lo
distingue de una simple inversión de colores: **el color de estado no cambia**.

| Elemento | Claro | Oscuro | Referencia |
|---|---|---|---|
| Cabecera de grupo del panel | `bg-white`, `text-gray-700` | `dark:bg-gray-900`, `dark:text-gray-200` | `:481-483` |
| Ítem de OT | borde `gray-200`, texto `gray-800` | `dark:border-gray-700`, `dark:text-gray-100` | `:500-505` |
| Controles (filtro y orden) | `bg-white`, borde `gray-300` | `dark:border-gray-600`, `dark:bg-gray-800`, `dark:text-gray-100` | `:447-448`, `:463-465` |
| Textos secundarios y estados | `text-gray-500` / `text-red-700` | `dark:text-gray-400` / `dark:text-red-300` | `:204`, `:429-434`, `:533` |
| Enlaces de acción | `text-blue-700` | `dark:text-blue-200` | `:525` |

**Lo que NO cambia: `COLOR_POR_ESTADO`.** Operativo, alerta, falla y desconectado usan las
mismas variables CSS en ambos temas. El color de un nodo **codifica información**, no estética:
si el tema lo alterara, el mismo estado se leería distinto según la preferencia del usuario.

La verificación es por **tests de clase** (`dark:` presente en el DOM) más revisión visual. No hay
medición de contraste con herramienta: queda como deuda de accesibilidad.

El modo oscuro general de la aplicación (navbar y dashboard) se documenta en
`docs/DASHBOARD_KPIS.md`; aquí solo se describe lo específico del mapa.

## 1.f El panel de OTs: filtro, orden y grupos plegables (CGBIDA-386)

Esta sección completa §1.a. La agrupación por ciclo de vida, el badge de vencidas y el scroll
sticky no cambian; lo que se agrega es cómo se **navega** dentro de esa agrupación.

### 1.f.1 Filtro por grupo

`filtroEstado` (`:1088`) es `'todos' | GrupoOt`, con `'todos'` por defecto. El `<select>`
(`data-testid="filtro-estado"`, `:446-459`) lista «Todos» más los grupos **visibles**, y cada
opción lleva su conteo (`Pendientes (3)`).

- Filtrar **no** reordena: `ORDEN_GRUPOS` (`:104`) impone Pendientes → En curso → Cerradas →
  Canceladas, porque el orden expresa urgencia y no cronología.
- El conteo de «Todos» es `totalOrdenes()`; el de cada grupo, `grupo.ordenes.length`.
- Un grupo sin órdenes no se dibuja (§1.a), así que tampoco aparece como opción del filtro.

### 1.f.2 Orden dentro de cada grupo

`OrdenOt = 'az' | 'recientes'` (`:101`). El botón `⇅` (`data-testid="orden-ot"`, `:460-471`)
alterna el criterio y se rotula con `etiquetaOrden()`.

**El orden aplica DENTRO de cada grupo, nunca entre grupos.** Los grupos mantienen su orden fijo
por urgencia; ordenar el conjunto mezclaría una OT cerrada entre las pendientes.

### 1.f.3 Grupos plegables

La cabecera de cada grupo es un `<button>` (`:479-494`): `aria-expanded="!estaPlegado(grupo)"`,
chevron `▸` que rota 90° (`rotate-90`) cuando está abierto, y el `<ul>` solo se renderiza si no
está plegado (`@if (!estaPlegado(...))`, `:496`).

`estaPlegado()` / `alternarGrupo()` (`:1107-1113`) guardan el estado **por nombre de grupo**:
plegar Pendientes no pliega En curso. Como la cabecera es `sticky` con fondo opaco (§1.a), al
plegar el grupo su cabecera sigue visible mientras se desplaza el resto del panel.

### 1.f.4 Por qué los controles van en una sola línea

El panel mide 288 px (256 internos) y el listado ya scrollea, así que la fila de controles son
40 px de alto y una sola línea: el costo vertical es despreciable y el horizontal entra con
holgura (`:440-444`). Después de `f31c7de` se le dio holgura al conjunto, porque el contenido
quedaba pegado al borde.

### 1.f.5 Cobertura

Los `data-testid` son el contrato con los tests: `ordenes-controles`, `filtro-estado`,
`orden-ot`, `grupo-<nombre>`, `grupo-lista`, `orden-item`, `orden-numero`, `orden-estado`,
`orden-vencida`, `orden-ver-detalle`. El caso de volumen (§1.a) se cubre con un test de 20
órdenes repartidas en los 4 grupos.

## 1.g Sincronización con el mantenedor de plantas (HU-25 / CGBIDA-461)

### 1.g.1 El mapa embebe el mantenedor

El mapa y el mantenedor de activos son **la misma pantalla**, en dos vistas:

```html
<app-plantas (actualizado)="recargarTopologia()" />
```

Un botón alterna entre «Gestionar activos» y «Volver al mapa» (`alternarVista()`, `:644-652`).
Al volver, `recargarTopologia()` se ejecuta **antes** de cambiar de vista: el usuario no llega a
ver el mapa viejo.

`recargarTopologia()` (`:688-691`) vuelve a pedir el mapa **sin tocar la cámara**: se conservan
zoom y paneo. Es la diferencia entre recargar y resetear (§1.d.1).

### 1.g.2 El alta es una sola transacción

`POST /api/plantas/completa` (`catalog.py:160-165`, `require_route("plantas")`, `201`) crea en
**una transacción**:

| Paso | Qué hace | Regla |
|---|---|---|
| 1 | Crea la planta | Si el nombre ya existe, la operación falla entera |
| 2 | Resuelve las disciplinas **contra la empresa** | Reutiliza la existente comparando por `lower()` o la crea; nunca la duplica (`_resolver_disciplina`, `catalog.py:116-157`) |
| 3 | Da de alta las máquinas | Código repetido **dentro del payload** → `409` antes de tocar la base (`catalog.py:200-204`) |

- Si falla cualquier fila **no queda nada a medias**: no existe una planta sin sus máquinas.
- El actor de la sesión queda en `app.usuario_id`, así que los triggers de auditoría registran
  cada fila insertada.
- Las disciplinas cuelgan de la **empresa**, no de la planta: se comparten entre plantas.

Payload y respuesta: `PlantaCompletaCreate` / `PlantaCompletaResponse`. El **contrato completo**
—campos, límites, códigos `403`/`409`/`422`/`500` y el flag `creada`— vive en
`docs/contrato_api_plantas.md` y no se duplica aquí; esta sección solo resume lo que el mapa
necesita saber del alta.

### 1.g.3 Qué se ve en el mapa después del alta

Los nodos se derivan de las **máquinas visibles** (§1, reglas A-2/A-3), no del catálogo de
plantas. Consecuencias:

| Caso | Qué pasa en el mapa |
|---|---|
| Planta nueva **con** máquinas | Aparece con sus disciplinas al recargar |
| Planta nueva **sin** máquinas | **No aparece** (A-2): mostrarla sugeriría actividad inexistente |
| Máquina sin disciplina | No tiene rama donde colgarse; el grafo no puede dibujarla como corresponde |
| Alta que falla a medias | No llega al mapa: la transacción no dejó filas |

### 1.g.4 Lo que NO hay

- **No hay push del mapa**: ningún canal avisa «se creó una planta». El refresco depende de
  `recargarTopologia()`, y por eso el mantenedor y el mapa son la misma pantalla.
- **No hay refresco entre usuarios**: si otra persona crea una máquina, hay que recargar.
- El tiempo real por SSE existe para **OTs** (`docs/HU-10-REALTIME_OT.md`), no para la topología.

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

## 5. Qué NO va en este documento

| Tema | Dónde vive |
|---|---|
| Contrato HTTP (rutas, campos, códigos, ejemplos) | `docs/contrato_api_topologia.md` |
| Revisión cruzada de HU-07 (qué se verificó y cómo) | `docs/verificacion_hu07_topologia.md` |
| KPI del dashboard y su modo oscuro | `docs/DASHBOARD_KPIS.md` |
| Tiempo real de OTs por SSE | `docs/HU-10-REALTIME_OT.md` |
| Reglas de negocio y estados de las OTs | `docs/WORK_ORDERS.md` |
| Multi-empresa, roles y `super_usuario` | `docs/MULTIEMPRESA.md` |
| Contrato del alta masiva de plantas (campos, límites, errores) | `docs/contrato_api_plantas.md` |

El índice de la documentación está en `docs/README.md`.
