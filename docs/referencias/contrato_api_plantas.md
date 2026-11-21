# Contrato API — alta masiva de plantas (HU-25 / CGBIDA-461, CGBIDA-462)

Endpoints del mantenedor de plantas, disciplinas y máquinas. Todo bajo `/api`, con
`Authorization: Bearer <token>` (la sesión se resuelve con `get_sesion_actual`).

Implementación: `backend/src/barb/routers/catalog.py` y
`backend/src/barb/schemas/plantas.py`.

---

## `POST /api/plantas/completa`

Crea una planta, resuelve sus disciplinas y da de alta sus máquinas **en una sola
transacción**: si una fila falla, no queda nada a medias.

| | |
|---|---|
| Permiso | ruta `plantas` → **sólo `gerente` y `admin`** (el resto recibe 403) |
| Código de éxito | `201` |
| Transaccional | sí (`async with transaction()`) |

### Request

```json
{
  "nombre": "Planta Norte",
  "ubicacion": "Quilicura",
  "disciplinas": ["Mecánica", "Eléctrica"],
  "maquinas": [
    { "nombre": "Compressor A1", "codigo": "CMP-01", "disciplina": "Mecánica" },
    { "nombre": "Pump E4", "codigo": "PMP-04", "disciplina": null }
  ]
}
```

| Campo | Tipo | Obligatorio | Límites | Notas |
|---|---|---|---|---|
| `nombre` | string | sí | 2–120 | Debe ser único por empresa |
| `ubicacion` | string \| null | no | ≤255 | Se guarda `null` si viene vacío |
| `disciplinas` | string[] | no (default `[]`) | ≤50 por nombre | Nombres, no ids |
| `maquinas` | object[] | no (default `[]`) | — | Ver abajo |
| `maquinas[].nombre` | string | sí | 1–100 | |
| `maquinas[].codigo` | string | sí | 1–50 | Único por planta |
| `maquinas[].disciplina` | string \| null | no | ≤50 | Nombre de la disciplina |

### Disciplinas: se reutilizan, no se duplican

Las disciplinas **cuelgan de la empresa**, no de la planta (`disciplina.empresa_id`), y se
comparten entre plantas. Por eso el alta las recibe por **nombre**:

- Si la empresa ya tiene esa disciplina, se **reutiliza** su id.
- Si no existe, se **crea** dentro de la misma transacción.
- La comparación es por `lower()`, así que «mecánica» y «Mecánica» son la misma.
- Los nombres repetidos en el propio payload y los vacíos se colapsan antes de insertar.
- Una máquina puede nombrar una disciplina que no venga en `disciplinas[]`: se resuelve
  igual (se busca o se crea).

### Response `201`

```json
{
  "planta_id": 8,
  "nombre": "Planta Norte",
  "ubicacion": "Quilicura",
  "disciplinas": [
    { "disciplina_id": 3, "nombre": "Mecánica", "creada": false },
    { "disciplina_id": 17, "nombre": "Eléctrica", "creada": true }
  ],
  "maquinas": [
    { "maquina_id": 45, "nombre": "Compressor A1", "codigo": "CMP-01", "disciplina_id": 3 },
    { "maquina_id": 46, "nombre": "Pump E4", "codigo": "PMP-04", "disciplina_id": null }
  ]
}
```

`creada` distingue lo nuevo de lo reutilizado, para que la UI pueda informarlo
(«2 disciplinas nuevas, 1 reutilizada»).

### Errores

| Código | `detail` | Cuándo |
|---|---|---|
| `403` | `El rol '<rol>' no tiene acceso a 'plantas'.` | rol distinto de gerente/admin |
| `409` | `Ya existe una planta llamada «X» en tu empresa.` | `UNIQUE(empresa_id, nombre)` |
| `409` | `Ya existe una máquina con ese código en la planta.` | `UNIQUE(planta_id, codigo)` |
| `409` | `Hay dos máquinas con el mismo código en la solicitud.` | detectado **antes** de abrir la transacción |
| `409` | `La empresa o la disciplina indicada ya no existe.` | violación de FK |
| `422` | lista de validación de Pydantic | falta `nombre`, excede un límite |
| `500` | `Error interno al crear la planta.` | fallo inesperado |

---

## GET relacionados

Los usa el listado de plantas para armarse sin endpoints nuevos.

### `GET /api/plants` (alias `/api/plantas`)

Sólo sesión. Filtra por la empresa de la sesión (`empresa_id` opcional para `super_usuario`).

```json
[{ "id": 1, "name": "Planta Central San Bernardo", "ubicacion": "San Bernardo" }]
```

### `GET /api/machines`

```json
[{ "id": 10, "name": "Compressor A1", "discipline_id": 1, "plant_id": 1 }]
```

El listado agrupa por `plant_id` para contar las máquinas de cada planta.

### `GET /api/disciplines`

```json
[{ "id": 1, "name": "Mecánica" }]
```

Resuelve el nombre de la disciplina de cada máquina (`discipline_id` → `name`).

---

## Notas de implementación

- **Baja lógica: no existe.** La columna `planta.activa` y su migración se eliminaron por
  decisión del equipo (ver `AGENTS.md`). Tampoco hay `PATCH` ni `DELETE` de plantas: hoy no
  se puede retirar una planta desde la API.
- **Atomicidad probada contra la base real**, no con mocks: si la segunda máquina repite
  código, el test comprueba que la planta y la disciplina tampoco existan
  (`backend/tests/test_plantas_completa.py`).
- La **topología** sintetiza sus nodos desde `planta`/`disciplina`/`maquina`, así que una
  planta creada aquí aparece en el mapa sin trabajo extra.
