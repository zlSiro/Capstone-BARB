# KPIs del Dashboard

Documento del bloque de correcciones del dashboard (HU-08, CGBIDA-51, subtareas 403-410).
Cubre las **seis fórmulas reales** que calcula el backend, de dónde sale cada una, los
flags de visibilidad y la deuda conocida.

**Endpoint:** `GET /api/stats/financial-impact`
**Implementación:** `backend/src/barb/routers/stats.py`
**Permiso:** `require_route("dashboard", solo_lectura=True)` (`stats.py:66`)

---

## 0. Respuesta del endpoint

```
{
  "financials":     { ... },   # 5 KPIs
  "trend14Days":    [ 14 ],    # tendencia de 14 días
  "machines":       [ 5 ],     # top 5 por volumen
  "impacto_anual":  { ... }    # 6.º KPI
}
```

| Clave | Contenido |
|---|---|
| `financials.mttr` | KPI 1 |
| `financials.efficiency` | KPI 2 — se muestra como «Cumplimiento de SLA» |
| `financials.costo_total_acumulado` | KPI 3 |
| `financials.mtbfHours` | KPI 4 |
| `financials.ahorro_generado` | KPI 5 |
| `impacto_anual` | KPI 6 |

---

## 1. MTTR

**Tiempo medio de reparación, solo de las órdenes completadas.**

```
MTTR = AVG(tiempo_reparacion_min) FILTER (WHERE estado = 'completed')
```

| | |
|---|---|
| Código | `stats.py:88` (consulta principal) y `stats.py:123` (consulta del período) |
| Origen | Legacy |
| Unidad | Minutos |
| Modificado por este bloque | No |

**Nota:** el `FILTER` por `estado = 'completed'` es lo que lo distingue de un promedio
simple. Si se quitara, incluiría órdenes en curso y el valor dejaría de ser comparable.
Cubierto contra la base por `test_el_mttr_corresponde_solo_a_las_completadas`
(`test_stats_contrato.py`).

---

## 2. Cumplimiento de SLA

**Porcentaje de órdenes completadas dentro del objetivo de 24 horas.**

```
Cumplimiento = 100 × completadas_en_sla / total_completadas
completadas_en_sla = COUNT(*) FILTER (
    WHERE estado = 'completed' AND tiempo_reparacion_min <= 1440
)
```

| | |
|---|---|
| Código | `stats.py:96-98` (conteo) y `stats.py:214` (cálculo); SLA en `config.py:88` |
| Origen | Legacy, **renombrado en este bloque** |
| Unidad | Porcentaje (0-100) |
| Campo interno | `efficiency` — ver anexo A.2 |
| SLA | `settings.sla_target_minutes`, por defecto `24 * 60 = 1440` min |

**Nota:** se devuelve `0.0` si no hay completadas (`stats.py:214`), no `null`.

---

## 3. Costo Directo

**Suma del costo real de las órdenes, excluyendo las canceladas.**

```
Costo Directo = SUM(costo_real) FILTER (WHERE estado != 'cancelled')
```

| | |
|---|---|
| Código | `stats.py:93` |
| Origen | Legacy, **corregido en este bloque** (CGBIDA-407) |
| Unidad | CLP — ver anexo A.1 |
| Antes | `SUM(costo_real)` sin filtro |

**Por qué se excluyen las canceladas:** una OT cancelada significa que el trabajo no se
hizo, así que no hay costo real que sumar. Es la misma razón por la que no cuentan como
falla en el MTBF.

**Matiz sobre costos parciales:** si una OT se cancela **después** de generar un gasto
parcial, ese costo queda huérfano y no aparece en ningún KPI. La salida correcta es
marcarla `completed` con una nota, no `cancelled`. Es una limitación del modelo de
estados, no del cálculo.

**Estado actual de los datos:** el único escenario en que este filtro cambia el número es
que exista una cancelada con `costo_real` distinto de cero. Con el dataset actual **no hay
ninguna** (9 canceladas, todas con costo 0), así que el filtro hoy da el mismo resultado
que sin él. La protección está puesta para el caso futuro.

---

## 4. MTBF

**Tiempo medio entre fallas, sobre una ventana FIJA de 365 días.**

```
MTBF = (8760 - SUM(downtime_minutes de correctivas no canceladas) / 60) / COUNT(correctivas no canceladas)

8760 = 365 × 24  (horas de la ventana)
```

| | |
|---|---|
| Código | `stats.py:147-155` (consulta) y `stats.py:221-226` (cálculo) |
| Origen | Fórmula del vendor (`Barb_Documento_de_Negocio.docx` §8.2), **implementación de este bloque** (CGBIDA-404) |
| Unidad | Horas |
| Ventana | Fija en 365 días — **ignora el selector temporal** |
| Falla mínima | 2 (`stats.py:30`); con menos, devuelve `null` |

**Decisiones no obvias, todas verificadas por test:**

1. **La ventana es fija.** Sin `days` mide un año, aunque el selector diga «Histórico».
   `date_filter` **no** se aplica a esta consulta: si dependiera del selector, un rango de
   7 días daría un MTBF distinto, que es absurdo para una métrica de fiabilidad.
   (`test_la_query_de_mtbf_no_usa_el_parametro_days`)

2. **El conteo y la inactividad miran la MISMA población.** El `WHERE` filtra
   `tipo = 'corrective'` y `estado != 'cancelled'`, y el `SUM` lleva además un `FILTER`
   por tipo. Antes el `WHERE` no filtraba nada: el divisor incluía canceladas y el `SUM`
   sumaba la inactividad de **todas** las órdenes, así que numerador y denominador medían
   universos distintos. Se detectó al ampliar el seed a 24 meses (CGBIDA-408).

3. **Las canceladas no son fallas.** Coherente con CGBIDA-407: si el trabajo no se hizo,
   esa orden no es una falla.

4. **El proxy de falla es `tipo = 'corrective'`**, no todas las órdenes completadas.

**Limitación medida:** con los datos actuales, la diferencia entre acotar el `SUM` a
correctivas o no hacerlo es de **0.1 h** (223.6 vs 223.5), y se pierde en el redondeo a un
decimal. Por eso `test_la_query_de_mtbf_acota_el_sum_a_correctivas` comprueba el **SQL** y
no el valor. Está documentado en el propio test como limitación ejecutable.

---

## 5. Ahorro Generado

**Valor de la inactividad evitada por las órdenes completadas.**

```
Ahorro = SUM(downtime_minutes) FILTER (WHERE estado = 'completed') × costo_por_minuto
```

| | |
|---|---|
| Código | `stats.py:89-92` (consulta) y `stats.py:213` (cálculo) |
| Origen | Legacy |
| Unidad | CLP |
| Costo por minuto | `settings.downtime_cost_per_minute`, por defecto `2000` (`config.py:89`) |

> **Deuda abierta — `downtime_minutes`.** Este KPI depende por completo de que
> `downtime_minutes` esté poblado, y **en producción ese campo no lo llena ningún
> proceso**: lo puebla el seed sintético (CGBIDA-408). Con datos reales el ahorro sería
> cero. Es deuda del modelo de datos, no del cálculo. Queda registrada aquí para que no
> se confunda un KPI que funciona con un dato que no se recoge.

---

## 6. Impacto Anual Proyectado

**Comparativa de dos escenarios sobre los incidentes reales del período.**

```
factor_anual  = 365 / dias_periodo
sin_barb      = incidentes_periodo × factor_anual × minutos_sin_barb × costo_por_minuto
minutos_con_barb = tiempo_promedio_real   (o minutos_sin_barb si no hay medición)
con_barb      = incidentes_periodo × factor_anual × minutos_con_barb × costo_por_minuto
ahorro        = sin_barb − con_barb
incidentes_anuales = incidentes_periodo × factor_anual
```

| | |
|---|---|
| Código | Consulta `stats.py:171-179`; cálculo `stats.py:246-263` |
| Origen | Modelo del vendor (`Barb_Documento_de_Negocio.docx` §8.2) |
| Unidad | CLP |
| `minutos_sin_barb` | `settings.impact_without_barb_minutes = 180` (`config.py:95`) |
| `dias_periodo` | `days` si se pidió, si no `365` |
| Ventana | `IMPACTO_VENTANA_DIAS = 365` (`stats.py:55`) |

**Estructura de la respuesta:**

```
"impacto_anual": {
  "escenario_sin_barb":   <número|null>,
  "escenario_con_barb":   <número|null>,
  "ahorro_proyectado":    <número|null>,
  "incidentes_anuales":   <número|null>,
  "impacto_visible":      <bool>,
  "supuestos":            { "minutos_sin_barb", "costo_por_minuto", "dias_periodo" },
  "supuestos_incompletos": <bool>
}
```

**Reglas de cálculo, y el porqué de cada una:**

| Caso | Comportamiento | Razón |
|---|---|---|
| `impacto_visible == false` | Devuelve todo `null` y **no ejecuta la consulta** | Ahorra trabajo y evita mostrar un número sin base |
| `incidentes_periodo == 0` | `null`, con `visible = true` | Sin incidentes no hay nada que proyectar |
| `tiempo_promedio_real IS NULL` | `con_barb` usa los mismos 180 min → ahorro 0, y `supuestos_incompletos = true` | Se avisa de que falta el dato en vez de inventarlo |
| `ahorro < 0` | **No se recorta** | Es información real: el tiempo actual supera el objetivo del modelo |
| `days = None` | Acota a 365 días (`stats.py:156`) | El numerador y `dias_periodo` deben hablar del mismo período |

**El supuesto de 180 minutos** viene del documento de negocio del vendor y vive en
`config.py:95`, no en el router. `test_los_supuestos_salen_de_config_y_no_del_codigo`
verifica que se pueda cambiar sin tocar el código.

**El 2000 y el 180 no aparecen como literales en `stats.py`**: se leen de `settings` o de
la variable local `costo_min`. Hay un test que lo comprueba leyendo el archivo.

---

## 7. Flags de visibilidad

Tres flags independientes, con propósitos distintos:

| Flag | Dónde | Qué significa |
|---|---|---|
| `financials.mtbf_visible` | `stats.py:33` | El rango pedido justifica un año (≥ 365 días) |
| `impacto_anual.impacto_visible` | `stats.py:58` | El rango pedido llega al umbral de 90 días |
| `impacto_anual.supuestos_incompletos` | `stats.py:243` y `stats.py:262` | Faltan tiempos de reparación medidos |

| Selector | `mtbf_visible` | `impacto_visible` |
|---|---|---|
| Sin filtro (histórico) | `true` | `true` |
| `?days=365` | `true` | `true` |
| `?days=90` | `false` | **`true`** (umbral exacto) |
| `?days=89` | `false` | `false` |
| `?days=30` | `false` | `false` |
| `?days=7` | `false` | `false` |

Los umbrales: `MTBF_VENTANA_DIAS = 365` (`stats.py:28`),
`IMPACTO_DIAS_MINIMOS = 90` (`stats.py:54`), `MTBF_FALLAS_MINIMAS = 2` (`stats.py:30`).

**Cuando un flag es `false`, las cifras vienen `null`** — no ceros — para que el frontend
no pueda mostrar un número sin base.

**Nota de diseño:** `supuestos` se devuelve **siempre**, incluso con `impacto_visible`
en `false`, para que la interfaz pueda explicar el modelo aunque no muestre las cifras.

---

## 8. Manejo de errores

`stats.py:293-308`. La regla: **un error nunca se convierte en una métrica.**

| Situación | Código | Cuerpo |
|---|---|---|
| Base de datos no disponible (`OperationalError`, `PoolTimeout`) | **503** | «No se pudieron calcular las métricas: la base de datos no está disponible.» |
| Error inesperado | **500** | «Error interno al calcular las métricas del dashboard.» |
| Sin token / token inválido | **401** | — |
| Rol sin permiso (`tecnico`, `operador`) | **403** | Matriz en `permissions.py:47` |
| `days` inválido (`ge=1`) | **422** | — |

Antes de este bloque, cualquier excepción devolvía **ceros con HTTP 200**, lo que hacía
que el dashboard mostrara métricas falsas indistinguibles de datos reales. La rama de
error del frontend era código muerto.

---

## Anexo A — Deuda conocida

### A.1 Desajuste CLP / USD

**El rótulo dice dólares y el formato dice pesos.** Es una inconsistencia visible en la
interfaz:

| Qué | Dónde | Dice |
|---|---|---|
| Rótulo del supuesto | `frontend/src/app/core/i18n/translations.ts:70` | «Basado en **US$2.000/min** de inactividad operativa» |
| Formato de las cifras | `frontend/src/app/features/dashboard/dashboard.component.ts:34,45` | `currency:'CLP':'symbol-narrow':'1.0-0'` |
| Valor real de la config | `backend/src/barb/core/config.py:89` | `2000` — sin unidad declarada |

El número (2000) es el mismo en ambos lados; **la unidad no**. Con el formato CLP, el
dashboard muestra «$2.000» donde el rótulo promete «US$2.000». No es un error de
cálculo: es una decisión pendiente sobre en qué moneda se presenta el KPI.

### A.2 El campo interno `efficiency`

El campo se llama `efficiency` en la API y en el modelo del frontend, pero la etiqueta
visible es **«Cumplimiento de SLA»** desde CGBIDA-405. El nombre interno **no se cambió**
para no romper el contrato con el frontend. Queda como deuda de nomenclatura:

```
frontend/src/app/core/i18n/translations.ts:74   efficiency: 'Cumplimiento de SLA'
```

Si en algún momento se renombra el campo, hay que cambiar los dos lados a la vez.

### A.3 El modelo del frontend no declara todos los campos que recibe

El backend envía **6 campos por máquina** en `machines`, pero la interfaz `MachineData`
de `frontend/src/app/core/models/stats.model.ts` declara **3**:

| Campo | Llega del backend | Declarado en el modelo |
|---|---|---|
| `id`, `name`, `total` | Sí | Sí |
| `ahorroGenerado` | **Sí** | **No** |
| `mttr` | **Sí** | **No** |
| `slaCompliance` | **Sí** | **No** |

Lo mismo pasa con `financials.mtbf_visible`: el backend lo envía (necesario para el aviso
de CGBIDA-392) y el modelo `Financials` no lo declara.

**Impacto:** los datos viajan y se descartan. La tabla de rendimiento por máquina podría
mostrar tres columnas más sin tocar el backend. Documentado aquí; el arreglo es del
frontend.

### A.4 Convención para KPIs futuros

Los tres flags siguen un patrón único. Cualquier KPI nuevo que dependa de un mínimo de
datos debería seguirlo:

1. **Un flag booleano explícito** (`<kpi>_visible`) en la respuesta, que indique si el
   rango pedido alcanza para calcularlo.
2. **Cifras `null`, nunca ceros**, cuando el flag es `false`. Un cero es indistinguible
   de un resultado real.
3. **Los supuestos se devuelven siempre**, aunque las cifras no, para que la interfaz
   pueda explicar el modelo.
4. **Un flag de datos faltantes** (`supuestos_incompletos`) cuando se pudo calcular pero
   con un valor por defecto en lugar de una medición.
5. **El umbral y los supuestos viven en `config.py` o como constante del router**, nunca
   como literal dentro de la consulta.

### A.5 Datos sintéticos

El dashboard se demuestra con un historial sintético de 24 meses: 205 órdenes con prefijo
`SYN-HIST-`, generadas por `backend/scripts/seed_history.py` (CGBIDA-408).

```
Borrado:  DELETE FROM orden_trabajo WHERE numero_ot LIKE 'SYN-%';
```

**No es un dato de producción.** En particular:

- `downtime_minutes` lo puebla el seed, no un proceso real (ver sección 5).
- La distribución de duraciones es una calibración para la demo, no una regla de negocio.
  Incluye un ajuste determinístico que garantiza **entre 2 y 3** órdenes sobre el SLA en
  la empresa 1, para que el KPI de Cumplimiento de SLA y el futuro gráfico de resolución
  no queden planos.

---

## Anexo B — Trazabilidad

| KPI | Subtarea | Test principal |
|---|---|---|
| Manejo de errores | CGBIDA-403 | `test_stats_error.py` |
| MTBF | CGBIDA-404 | `test_stats_mtbf.py` |
| Cumplimiento de SLA (rótulo) | CGBIDA-405 | `translations.spec.ts` |
| Impacto Anual | CGBIDA-406 | `test_stats_impacto.py` |
| Costo Directo | CGBIDA-407 | `test_stats_costo.py` |
| Dataset de demostración | CGBIDA-408 | `test_seed_history.py` |
| Consolidado del bloque | CGBIDA-409 | `test_stats_contrato.py` |
| Este documento | CGBIDA-410 | — |
