# KPIs y visualizaciones del Dashboard

Documento del dashboard completo: el bloque de correcciones de indicadores (HU-08, CGBIDA-51,
subtareas 403-410) y las visualizaciones de la HU-16 (subtareas 391-402).

Cubre las **seis fórmulas reales** que calcula el backend, los **cuatro gráficos** que las
presentan, el **selector de rango temporal**, los **tooltips flotantes**, el **modo oscuro**,
los flags de visibilidad y la deuda conocida.

**Endpoint:** `GET /api/stats/financial-impact`
**Implementación:** `backend/src/barb/routers/stats.py`
**Permiso:** `require_route("dashboard", solo_lectura=True)` (`stats.py:93`)

> Las referencias de línea corresponden al estado del archivo al cerrar CGBIDA-401. Si el
> código se movió, cada tabla indica también **qué buscar** (nombre de constante, de consulta
> o de función), que es lo estable.

---

## 0. Respuesta del endpoint

```
{
  "financials":     { ... },   # 5 KPIs
  "trend14Days":    [ 14 ],    # tendencia de 14 días → gráfico de backlog
  "machines":       [ 5 ],     # top 5 por volumen  → ranking y tiempo de resolución
  "impacto_anual":  { ... },   # 6.º KPI
  "por_tipo":       [ 4 ],     # distribución por tipo → dona
  "estancadas":     { ... }    # vencidas / demoradas → banner de alerta
}
```

| Clave | Contenido | Dónde se ve |
|---|---|---|
| `financials.mttr` | KPI 1 | tarjeta |
| `financials.efficiency` | KPI 2 — se muestra como «Cumplimiento de SLA» | tarjeta |
| `financials.costo_total_acumulado` | KPI 3 | tarjeta |
| `financials.mtbfHours` | KPI 4 | tarjeta |
| `financials.ahorro_generado` | KPI 5 | tarjeta |
| `impacto_anual` | KPI 6 | tarjeta |
| `trend14Days` | Serie diaria de abiertas y cerradas | gráfico de backlog (§9.1) |
| `machines` | Top 5 equipos con 6 campos cada uno | ranking (§9.2) y resolución (§9.4) |
| `por_tipo` | Volumen por tipo de intervención | dona (§9.3) |
| `estancadas` | Vencidas, demoradas y umbral | banner (§9.5) |

---

## 1. MTTR

**Tiempo medio de reparación, solo de las órdenes completadas.**

```
MTTR = AVG(tiempo_reparacion_min) FILTER (WHERE estado = 'completed')
```

| | |
|---|---|
| Código | `financials_query` (`stats.py:113`), línea del `AVG` en `stats.py:115`; se devuelve tal cual en `stats.py:288` |
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
| Código | `stats.py:123-127` (conteo) y `stats.py:295` (cálculo); SLA en `config.py:110` |
| Origen | Legacy, **renombrado en este bloque** |
| Unidad | Porcentaje (0-100) |
| Campo interno | `efficiency` — ver anexo A.2 |
| SLA | `settings.sla_target_minutes`, por defecto `24 * 60 = 1440` min |

**Nota:** se devuelve `0.0` si no hay completadas (`stats.py:295`), no `null`.

---

## 3. Costo Directo

**Suma del costo real de las órdenes, excluyendo las canceladas.**

```
Costo Directo = SUM(costo_real) FILTER (WHERE estado != 'cancelled')
```

| | |
|---|---|
| Código | `stats.py:120` (el `SUM` con el `FILTER`) |
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
| Código | `mtbf_query` (`stats.py:221-229`) y cálculo `stats.py:302-307` |
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
| Código | `stats.py:121` (consulta) y `stats.py:294` (cálculo) |
| Origen | Legacy |
| Unidad | CLP |
| Costo por minuto | `settings.downtime_cost_per_minute`, por defecto `2000` (`config.py:111`) |

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
| Código | `impacto_query` (`stats.py:245-253`); cálculo `stats.py:317-345` |
| Origen | Modelo del vendor (`Barb_Documento_de_Negocio.docx` §8.2) |
| Unidad | CLP |
| `minutos_sin_barb` | `settings.impact_without_barb_minutes = 180` (`config.py:117`) |
| `dias_periodo` | `days` si se pidió, si no `365` |
| Ventana | `IMPACTO_VENTANA_DIAS = 365` (`stats.py:82`) |

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
| `days = None` | Acota a 365 días (`stats.py:245-253`) | El numerador y `dias_periodo` deben hablar del mismo período |

**El supuesto de 180 minutos** viene del documento de negocio del vendor y vive en
`config.py:117`, no en el router. `test_los_supuestos_salen_de_config_y_no_del_codigo`
verifica que se pueda cambiar sin tocar el código.

**El 2000 y el 180 no aparecen como literales en `stats.py`**: se leen de `settings` o de
la variable local `costo_min`. Hay un test que lo comprueba leyendo el archivo.

---

## 7. Flags de visibilidad

Tres flags independientes, con propósitos distintos:

| Flag | Dónde | Qué significa |
|---|---|---|
| `financials.mtbf_visible` | `stats.py:33` | El rango pedido justifica un año (≥ 365 días) |
| `impacto_anual.impacto_visible` | `stats.py:85` | El rango pedido llega al umbral de 90 días |
| `impacto_anual.supuestos_incompletos` | `stats.py:324` y `stats.py:343` | Faltan tiempos de reparación medidos |

| Selector | `mtbf_visible` | `impacto_visible` |
|---|---|---|
| Sin filtro (histórico) | `true` | `true` |
| `?days=365` | `true` | `true` |
| `?days=90` | `false` | **`true`** (umbral exacto) |
| `?days=89` | `false` | `false` |
| `?days=30` | `false` | `false` |
| `?days=7` | `false` | `false` |

Los umbrales: `MTBF_VENTANA_DIAS = 365` (`stats.py:28`),
`IMPACTO_DIAS_MINIMOS = 90` (`stats.py:81`), `MTBF_FALLAS_MINIMAS = 2` (`stats.py:30`).

**Cuando un flag es `false`, las cifras vienen `null`** — no ceros — para que el frontend
no pueda mostrar un número sin base.

**Nota de diseño:** `supuestos` se devuelve **siempre**, incluso con `impacto_visible`
en `false`, para que la interfaz pueda explicar el modelo aunque no muestre las cifras.

---

## 8. Manejo de errores

`stats.py:389-405`. La regla: **un error nunca se convierte en una métrica.**

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

# Visualizaciones (HU-16)

Las cuatro visualizaciones son **SVG dibujado a mano**, sin biblioteca de gráficos. Es una
decisión de la subtarea CGBIDA-391: el legacy usaba Recharts, y agregarlo habría sumado una
dependencia de peso para cuatro gráficos que se resuelven con `path`, `rect` y `line`.

Cada componente vive en `frontend/src/app/features/dashboard/components/` y tiene su propio
`.spec.ts`.

## 9.1 Gráfico de backlog

**Tendencia diaria de órdenes abiertas y cerradas en los últimos 14 días.**

| | |
|---|---|
| Componente | `backlog-chart/` |
| Dato | `trend14Days` (14 puntos, siempre) |
| viewBox | `720 × 240` |
| Colores | abiertas `#d97706`, cerradas `#059669` |
| Trazo | curva monotone (sin sobreoscilación), con relleno en gradiente |
| Grilla | solo horizontal, como el legacy |

**Decisiones:**
- **No responde al selector de rango.** El backend no parametriza esta serie (CGBIDA-391,
  decisión c). Cambiar el selector no la altera.
- Se **auto-oculta** si no hay puntos, igual que el legacy.
- El eje X muestra `MM-DD` sin año, y el eje Y solo valores enteros.

> **Limitación de la demo:** con el dataset actual la serie tiene **1 punto con actividad de
> 14**, así que el gráfico se ve como un pico único. Es densidad del seed, no un defecto del
> componente. Registrado en CGBIDA-419.

## 9.2 Ranking de equipos

**Top 5 de equipos por OTs, MTTR o ahorro generado.**

| | |
|---|---|
| Componente | `machine-ranking/` |
| Dato | `machines` (el backend ya limita a 5) |
| viewBox | `420 × 240`, acotado a `max-w-[480px]` |
| Métricas | `ots` → `total`, `mttr` → `mttr`, `ahorro` → `ahorroGenerado` |
| Colores | paleta de 6 por **posición**, no por equipo |

**Decisiones:**
- **El color sigue a la posición.** Si al cambiar de métrica un equipo sube o baja, cambia de
  color. Es el comportamiento del legacy.
- **El selector tiene 3 opciones, no 4.** El legacy declaraba un cuarto caso que no era
  seleccionable y recaía silenciosamente en otra métrica: se determinó que era un defecto y
  no se reprodujo.
- Nombres truncados a **16 caracteres** con elipsis, conservando el completo en el `title`.

## 9.3 Dona por tipo de intervención

**Proporción de órdenes por tipo: correctivo, preventivo, predictivo, inspección.**

| | |
|---|---|
| Componente | `tipo-donut/` |
| Dato | `por_tipo` |
| viewBox | `200 × 200` |
| Geometría | radio exterior **90**, interior **60**, **4°** de separación |
| Porcentajes | repartidos por **mayor residuo** |

**Decisiones:**
- El campo `por_tipo` **sí respeta el selector de rango** (el legacy también), y viene
  ordenado por volumen descendente para que los segmentos no cambien de lugar.
- Los porcentajes se reparten por mayor residuo en vez de redondear cada uno por separado:
  redondear de forma independiente puede sumar 99 o 101 según la serie.
- Un solo tipo dibuja un **anillo completo sin separación**, con dos semicírculos (un arco de
  360° colapsa al mismo punto).

## 9.4 Tiempo de resolución por máquina

**MTTR de cada equipo, en barras verticales.**

| | |
|---|---|
| Componente | `tiempo-resolucion/` |
| Dato | `machines[].mttr` |
| viewBox | `720 × 190` |
| Eje Y | redondeado a múltiplos de 50 por encima del máximo |
| Etiquetas X | giradas **-45°**, ancladas al extremo, truncadas a 14 caracteres |

**Relación con el legacy:** el legacy dibujaba una barra por **orden de trabajo** (las últimas
15 cerradas) y coloreaba según SLA. Acá se dibuja una barra por **máquina**, que es lo que
entrega el endpoint agregado en `machines`; graficar por OT obligaría a traer el listado, que
está paginado.

**Deuda:** el legacy coloreaba rojo/verde según el objetivo de SLA (24 min) y dibujaba una
línea de referencia en ese valor. El frontend **no recibe el objetivo de SLA** en la respuesta
de `stats`, así que no se puede colorear por ese criterio sin inventar la constante. Se usa la
paleta por posición. Ver anexo A.6.

## 9.5 Banner de órdenes estancadas

**Aviso proactivo de SLA: no es un gráfico, es una alerta.**

| | |
|---|---|
| Componente | `alerta-estancadas/` |
| Dato | `estancadas` |
| Umbral | `UMBRAL_ESTANCADA_DIAS = 7` (`stats.py:62`) |

**Definición de «estancada»** — se cumple **cualquiera** de las dos condiciones:

1. **Vencida:** `fecha_vencimiento` en el pasado y estado no final
   (`ESTADOS_FINALES_OT`, `stats.py:65`).
2. **Demorada:** `in_progress` hace más de 7 días, medido desde `fecha_inicio` y, si está
   vacía, desde `fecha_creacion`.

**El total es la unión, no la suma:** una orden vencida que además lleva días en curso cuenta
una sola vez. Por eso `vencidas + demoradas` puede superar a `total`, y no es un error.

**Decisiones:**
- **No lee el selector de rango.** Responde a «qué está trabado ahora»: es una foto del estado
  actual, no una métrica del período elegido. Si lo leyera, un rango corto escondería órdenes
  que siguen abiertas.
- **Sí respeta el filtro por empresa**, como todo el endpoint.
- Se auto-oculta cuando `total` es 0.
- El umbral viaja en la respuesta (`umbral_dias`), así el frontend no repite el número.

> **Limitación de la demo:** con el dataset actual el banner muestra **38 de 146** órdenes,
> porque el historial sintético deja órdenes de 2024-2025 en estado `in_progress`. Es dato,
> no cálculo. Registrado en CGBIDA-419.

## 9.6 Layout

| | |
|---|---|
| Ancho máximo | `max-w-screen-2xl` (1536 px), centrado |
| KPIs | 6 en una fila desde `xl` |
| Gráficos | grid de **2 columnas**: backlog y ranking arriba; dona y resolución abajo |

**Por qué el ancho máximo:** sin él el dashboard se estiraba al 100 % y en monitores anchos
las tarjetas quedaban desproporcionadas.

**Por qué el grid de 2 columnas:** los SVG con `w-full` y viewBox de proporción fija se
escalaban al ancho de la pantalla. A 1536 px el backlog quedaba de 512 px de alto y el ranking
de 878 px. En dos columnas cada uno vuelve a su tamaño natural.

**Alto verificado:** a 1920×1080 el contenido entra **sin scroll** (desborde 0 px). Es un
criterio que se verifica con medición, no a ojo.

---

## 10. Tooltips flotantes

Los cuatro gráficos tienen tooltip al pasar el cursor. El del banner no aplica: es una alerta,
no un gráfico.

**Cómo se posicionan:**

1. El SVG escucha `mousemove` y guarda el cursor **relativo a la tarjeta**, más en qué
   cuadrante está (mitad derecha / mitad inferior).
2. El tooltip se dibuja en `position: absolute` **dentro de la tarjeta**, que pasa a
   `relative`. Así queda contenido por construcción: no puede salirse ni de la tarjeta ni de
   la pantalla.
3. **Clamping por cuadrantes:** si el cursor está en la mitad derecha o inferior, se invierte
   el desplazamiento y se traslada el propio tooltip con `translate(-100%)`. No necesita
   conocer el tamaño del tooltip, así que no falla si el contenido crece.
4. `pointer-events-none`: si el tooltip capturara el mouse, taparía la zona de hover y se
   dispararía el `mouseleave` en bucle. **Sin esto el tooltip parpadea.**
5. Al `mouseleave` del SVG se limpian el índice y la posición.

**Qué muestra cada uno:**

| Gráfico | Contenido |
|---|---|
| Backlog | Fecha, abiertas y cerradas |
| Ranking | Nombre y **las cuatro métricas** (OTs, MTTR, ahorro, SLA) |
| Dona | Tipo, volumen y porcentaje |
| Resolución | Nombre, MTTR y OTs |

En el ranking se muestran siempre las cuatro métricas, no solo la activa: así no hay que
cambiar el selector para ver el resto del perfil del equipo.

---

## 11. Selector de rango temporal

Un `<select>` con cuatro opciones, réplica del legacy (`Dashboard.tsx:258-269`):

| Opción | Valor enviado |
|---|---|
| Últimos 7 días | `?days=7` |
| Últimos 30 días | `?days=30` |
| Últimos 90 días | `?days=90` |
| Histórico | sin parámetro |

**Decisiones:**
- **Arranca en «Histórico»**, igual que el legacy.
- El valor viaja como **número**, no como texto: el `<select>` entrega strings y el componente
  los convierte antes de pedir.
- Volver a elegir el rango ya activo **no dispara una petición de más**.

**Qué responde al selector y qué no** — es la parte que más se presta a confusión:

| Dato | ¿Responde al rango? | Por qué |
|---|---|---|
| `financials` (KPIs 1, 2, 3, 5) | **Sí** | Se calculan sobre el período pedido |
| `por_tipo` | **Sí** | El legacy también filtraba la dona |
| `trend14Days` | No | Serie fija de 14 días |
| `machines` | **Sí** | El volumen es del período |
| `mtbfHours` | No | Ventana fija de 365 días; con menos, `mtbf_visible = false` |
| `impacto_anual` | Umbral | Requiere 90 días; por debajo, `impacto_visible = false` |
| `estancadas` | **No** | Foto del estado actual |

---

## 12. Modo oscuro

**Por clase, no por preferencia del sistema.**

| | |
|---|---|
| Variante | `@custom-variant dark (&:where(.dark, .dark *))` en `frontend/src/styles.css` |
| Clase | `dark` en el `<html>`, aplicada por `ThemeService` |
| Persistencia | `localStorage['barb.dark']` |
| Control | botón sol/luna en la cabecera |

**Por qué el custom-variant:** Tailwind v4 resuelve `dark:` contra `prefers-color-scheme` por
defecto, es decir contra el tema del sistema operativo. Con eso, el botón cambiaba el estado
del servicio y aplicaba la clase `dark` al `<html>`, pero **Tailwind la ignoraba**: en pantalla
no pasaba nada. Con el custom-variant, el tema elegido gana siempre sobre el del sistema.

**Tema inicial:** si hay preferencia guardada se respeta; si es la primera visita se usa el
tema del sistema, que es lo que hacía antes del cambio, para que nadie vea un salto.

**`color-scheme`** se ajusta junto con la clase, para que las barras de scroll y los controles
nativos sigan al tema.

**Cobertura:** las cuatro tarjetas de gráfico, las seis tarjetas de KPI, el banner, las tablas
y los tooltips tienen variante oscura.

---

## Anexo A — Deuda conocida

### A.1 Desajuste CLP / USD

**El rótulo dice dólares y el formato dice pesos.** Es una inconsistencia visible en la
interfaz:

| Qué | Dónde | Dice |
|---|---|---|
| Rótulo del supuesto | `frontend/src/app/core/i18n/translations.ts:104` y `:108` | «Basado en **US$2.000/min** de inactividad operativa» |
| Formato de las cifras | `dashboard.component.ts:303-307` (`moneda()`) | `Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP' })` |
| Valor real de la config | `backend/src/barb/core/config.py:111` | `2000` — sin unidad declarada |

El número (2000) es el mismo en ambos lados; **la unidad no**. Con el formato CLP, el
dashboard muestra «$2.000» donde el rótulo promete «US$2.000». No es un error de
cálculo: es una decisión pendiente sobre en qué moneda se presenta el KPI.

### A.2 El campo interno `efficiency`

El campo se llama `efficiency` en la API y en el modelo del frontend, pero la etiqueta
visible es **«Cumplimiento de SLA»** desde CGBIDA-405. El nombre interno **no se cambió**
para no romper el contrato con el frontend. Queda como deuda de nomenclatura:

```
frontend/src/app/core/i18n/translations.ts:130   efficiency: 'Cumplimiento de SLA'
```

Si en algún momento se renombra el campo, hay que cambiar los dos lados a la vez.

### A.3 (resuelto) Campos que el modelo no declaraba

> **Resuelto.** Este apartado describía que `MachineData` declaraba 3 de los 6 campos y que
> `Financials` no declaraba `mtbf_visible`. Ambas cosas se corrigieron: `MachineData` declara
> los 6 (`id`, `name`, `total`, `ahorroGenerado`, `mttr`, `slaCompliance`) y `Financials`
> declara `mtbf_visible`. Se deja el registro porque fue la causa de que el ranking y el
> gráfico de resolución no pudieran existir antes.

Lo que queda como convención, para no repetirlo: **si el backend envía un campo, el modelo del
frontend lo declara.** Un campo sin declarar es un dato que viaja y se descarta en silencio, y
además hace que el compilador no pueda ayudar cuando se quiere usar.

Los campos que hoy se declaran y no se usaban en las tarjetas son, justamente, los que
alimentan los gráficos de la HU-16: `machines[].mttr`, `machines[].ahorroGenerado`,
`machines[].slaCompliance`, `por_tipo` y `estancadas`.

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
  la empresa 1, para que el KPI de Cumplimiento de SLA y el gráfico de resolución (§9.4)
  no queden planos.

**Dos efectos visibles de esa calibración**, registrados en CGBIDA-419 para no confundirlos
con defectos:

1. **El gráfico de backlog tiene 1 punto con actividad de 14** (§9.1): el seed concentra las
   órdenes en el pasado y deja casi vacíos los últimos 14 días.
2. **El banner de estancadas muestra 38 de 146** (§9.5): hay órdenes de 2024-2025 que quedaron
   en estado `in_progress`. En un sistema real una intervención no permanece abierta veinte
   meses; es un registro que quedó sin cerrar.

### A.6 El objetivo de SLA no llega al frontend

El gráfico de tiempo de resolución (§9.4) **no puede colorear por SLA**. El legacy lo hacía
(`Dashboard.tsx:317-320`: rojo si la duración superaba el objetivo, verde si no) y dibujaba una
línea de referencia en ese valor (`Dashboard.tsx:316`).

El objetivo vive en `settings.sla_target_minutes` (`config.py:110`), **solo en el backend**, y
la respuesta de `GET /api/stats/financial-impact` no lo incluye. Tampoco lo incluye
`machines[].slaCompliance`, que es un porcentaje por equipo, no el umbral.

**Por qué no se resolvió por ahora:** la alternativa sería duplicar el `24 * 60` como constante
en el frontend. Eso crea una segunda fuente de verdad: si el cliente cambia el objetivo,
el gráfico seguiría pintando con el valor viejo y nadie lo notaría.

**Arreglo correcto:** agregar el objetivo a la respuesta de `stats` (por ejemplo
`sla_target_minutes` en `financials`) y que el frontend lo lea de ahí. Es un cambio de backend,
por eso queda como deuda y no se hizo en la HU-16.

---

## Anexo B — Trazabilidad

### Bloque de KPIs (HU-08 / CGBIDA-51)

| KPI | Subtarea | Test principal |
|---|---|---|
| Manejo de errores | CGBIDA-403 | `test_stats_error.py` |
| MTBF | CGBIDA-404 | `test_stats_mtbf.py` |
| Cumplimiento de SLA (rótulo) | CGBIDA-405 | `translations.spec.ts` |
| Impacto Anual | CGBIDA-406 | `test_stats_impacto.py` |
| Costo Directo | CGBIDA-407 | `test_stats_costo.py` |
| Dataset de demostración | CGBIDA-408 | `test_seed_history.py` |
| Consolidado del bloque | CGBIDA-409 | `test_stats_contrato.py` |
| Este documento (original) | CGBIDA-410 | — |

### Visualizaciones (HU-16 / CGBIDA-390)

| Pieza | Subtarea | Test principal |
|---|---|---|
| Decisiones técnicas: SVG a mano | CGBIDA-391 | — |
| KPIs en tarjetas con i18n y modo oscuro | CGBIDA-392 | `dashboard.component.spec.ts` |
| Gráfico de backlog | CGBIDA-393 | `backlog-chart.component.spec.ts` |
| Ranking de equipos | CGBIDA-394 | `machine-ranking.component.spec.ts` |
| Dona por tipo | CGBIDA-395 | `tipo-donut.component.spec.ts` |
| Banner de estancadas | CGBIDA-396 | `alerta-estancadas.component.spec.ts` |
| Selector de rango temporal | CGBIDA-397 | `dashboard.component.spec.ts` |
| Cobertura de estados de borde | CGBIDA-399 | los cinco specs anteriores |
| Verificación end-to-end | CGBIDA-400 | evidencia en `BARB_Presentacion/Evidencia_E2E` |
| Tiempo de resolución por máquina | CGBIDA-400 | `tiempo-resolucion.component.spec.ts` |
| Este documento (ampliación) | CGBIDA-401 | — |

**Contrato del endpoint:** `test_stats_contrato.py` verifica la forma exacta de la respuesta.
Las claves `por_tipo` y `estancadas` se agregaron a propósito en CGBIDA-395 y CGBIDA-396, y esa
prueba es el guardarraíl que obliga a actualizarla cuando el contrato cambia.

**Totales de la suite al cerrar la HU-16:** 371 pruebas en el backend (excluyendo
`test_chat_multimedia.py`) y 249 en el frontend.

Quedan **dos fallos preexistentes y ajenos a esta HU**, ambos verificados sobre `main` limpio:

- `app.spec.ts › should render title` (frontend, CGBIDA-418): el test del scaffold de Angular
  espera un `<h1>` que el componente `App` ya no tiene.
- Las **20 pruebas de `test_chat_multimedia.py`** (backend): requieren `NVIDIA_API_KEY` en el
  entorno y el endpoint responde 503 antes de validar el payload. Ese archivo es de `main`, no
  de la HU-16.
