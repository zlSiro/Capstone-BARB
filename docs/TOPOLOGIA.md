# Topología de planta — comportamiento y tablas sin uso

> **Estado:** documento de decisión. La decisión sobre las tablas `topologia_*` está
> **pendiente** (CGBIDA-370). El comportamiento del endpoint ya está implementado (CGBIDA-376).
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

**Consecuencia de A-3:** el grafo deja de ser un árbol estricto de tres niveles. Un nodo de
disciplina puede tener varios padres. El cliente debe soportarlo.

### El legacy no resolvió ninguno de los dos casos

`BARB\backend\main.py:3353-3360` conectaba **toda** disciplina a `plantas[0]`, con un
comentario que lo admitía: *"Conectamos cada disciplina a la primera planta disponible (raíz)"*.
Y su seed no tenía plantas vacías, así que A-2 nunca se le presentó.

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
