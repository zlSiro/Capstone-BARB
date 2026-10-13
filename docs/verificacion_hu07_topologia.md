# CGBIDA-373 — Revisión cruzada de HU-07

**Fecha:** 2026-10-12 · **Rama:** `feat/Topology` · **Alcance:** CGBIDA-310 y sus 20 subtareas
**Ejecutada por:** quien implementó. **NO es una revisión independiente** — ver "Limitación".

Cada punto lleva la evidencia con la que se comprobó. Lo que no se pudo comprobar se marca
como NO VERIFICABLE en lugar de darse por bueno.

---

## 1. ¿Todo lo que la HU promete está hecho?

Contrastado contra los 6 criterios de aceptación de CGBIDA-310.

| # | Criterio de la HU | Estado | Evidencia |
|---|---|---|---|
| CA-1 | Tres niveles: plantas, disciplinas y máquinas | ✅ | `test_topology.py::test_los_tres_niveles_estan_presentes`; en vivo: `plantas=2 disciplinas=4 maquinas=7` |
| CA-2 | Nombre, tipo y color según estado | ✅ | `test_campos_de_nodo_son_los_del_contrato`, `test_estados_y_tipos...`; color en `topology.component.ts` (`COLOR_POR_ESTADO`) |
| CA-3 | Distingo operativo / alerta / falla | ✅ | Leyenda en el componente + `test_planta_y_disciplina_siempre_operativo`; en vivo: `alerta, falla, operativo` |
| CA-4 | Desplazar y acercar/alejar | ✅ | `test_acerca_la_vista...`, `test_vuelve_a_la_vista_inicial`, `test_el_paneo_desplaza_la_vista...` |
| CA-5 | Panel de detalle al seleccionar | ✅ | `test_abre_el_panel_con_el_nombre...`, `test_cierra_el_panel...`, `test_cambia_el_contenido...` |
| CA-6 | Solo veo los equipos de mi empresa | ✅ | `test_multiempresa.py:151-161` + `test_usuario_normal_no_puede_espiar_otra_empresa_con_empresa_id` |

**Un criterio salió del alcance por decisión:** "Desde una máquina puedo ir a su diagnóstico
con IA" se retiró a **CGBIDA-375** porque la pantalla `/debug` no existe en el rewrite.

---

## 2. ¿Las subtareas están correctamente marcadas?

| Subtarea | Marca | ¿Coincide con el trabajo? |
|---|---|---|
| CGBIDA-355 | Listo | ✅ 6 decisiones aprobadas, documento entregado |
| CGBIDA-356 | Listo | ✅ aislamiento verificado tras el merge |
| CGBIDA-357 | Listo | ✅ 3 ramas de error, 6 tests, mutación verificada |
| CGBIDA-358 | Listo | ✅ `contrato_api_topologia.md` |
| CGBIDA-359 | Listo | ✅ endpoint cubierto |
| CGBIDA-360 | Listo | ✅ `topology.service.ts` |
| CGBIDA-361 | Listo | ✅ `topology.model.ts` |
| CGBIDA-362 | Listo | ✅ lienzo SVG |
| CGBIDA-363 | Listo | ✅ zoom, paneo, reset |
| CGBIDA-364 | Listo | ✅ panel de detalle |
| **CGBIDA-365** | **Por hacer** | ✅ correcto: **fuera de alcance**, derivada a CGBIDA-375 |
| CGBIDA-366 | Listo | ✅ 4 estados + test del estado de carga |
| CGBIDA-367 | Listo | ✅ integración verificada, citas corregidas |
| CGBIDA-368 | Listo | ✅ sección `topology` en i18n, es/en |
| CGBIDA-369 | Listo | ✅ 29 tests de componente |
| **CGBIDA-370** | Listo | ✅ documento de decisión `docs/TOPOLOGIA.md` |
| **CGBIDA-371** | Listo | ✅ E2E por el proxy, evidencia cruda |
| **CGBIDA-372** | Listo | ✅ contrato actualizado + `TOPOLOGIA.md` |
| **CGBIDA-373** | Listo | ✅ este documento |
| **CGBIDA-376** | Listo | ✅ A-2/A-3 implementadas y con mutación verificada |

Las 20 subtareas tienen **René Rojas** como assignee. El padre CGBIDA-310 **no se tocó**.

---

## 3. ¿El contrato y el código coinciden?

| Afirmación del contrato | ¿La cumple el código? | Evidencia |
|---|---|---|
| Dos rutas, `Bearer`, RBAC con `visitante: "ver"` | ✅ | `topology.py:17-19`, `permissions.py:44` |
| Respuesta `{nodos, conexiones}` | ✅ | `topology.py:142` |
| `maquina_id` solo en nodos Máquina | ✅ | `topology.py:125`; `test_campos_de_nodo_son_los_del_contrato` |
| `pos_y` fijo 100/300/500 | ✅ | `topology.py:82,106,130` |
| Estados `operativo`/`alerta`/`falla` derivados de OTs | ✅ | `topology.py:39-58` |
| `desconectado` existe como concepto pero **no se emite** | ✅ | ningún punto del router lo asigna |
| 401 con token inválido; 422 sin header | ✅ | `test_token_invalido_devuelve_401`, `test_sin_token_no_devuelve_datos` |
| 503 en fallo de dependencia; 500 en error inesperado | ✅ | `topology.py:146-159`; tests con mutación |
| **A-2**: planta sin máquinas no aparece | ✅ | `topology.py:73-75`; `test_a2_no_devuelve_plantas_sin_maquinas` |
| **A-3**: una disciplina, N aristas | ✅ | `topology.py:110-117`; `test_a3_disciplina_con_maquinas_en_varias_plantas...` |

**Verificado en vivo** que el contrato no miente sobre los conteos: empresa 1 → 21 nodos,
empresa 2 → 13, super → 39. Los tres coinciden con lo que documenta el contrato.

---

## 4. ¿i18n está aplicado?

| Punto | Estado | Evidencia |
|---|---|---|
| Existe una sección `topology` propia en `translations.ts` | ✅ | 16 claves, en `es` y en `en` |
| El componente no tiene literales de texto | ✅ | todo el texto sale de `t()`; verificado por build + tests |
| Ambas traducciones se renderizan | ✅ | `setupEnIdioma('es')` y `('en')` |
| En inglés no queda nada en español | ✅ | `expect(el.textContent).not.toContain('Desconectado')` |
| El cuarto estado se traduce a "Offline" | ✅ | `test_en_ingles_traduce_la_pantalla_completa...` |
| Los mensajes de carga/error/vacío se traducen | ✅ | `test_traduce_tambien_los_estados_de_carga...` |
| El panel traduce su botón y su etiqueta de estado | ✅ | `test_traduce_el_boton_de_cerrar_del_panel_de_detalle` |

Las claves `topologyTitle`/`topologyDescription` que ya existían **no se reutilizaron**: son
del **menú**, no de la página.

---

## 5. ¿Los tests pasan?

```
backend : 209 passed in 33.73s        EXIT 0
frontend: 38 passed, 1 failed         (29 de topología)
ruff    : All checks passed! (src/barb/routers/topology.py, tests/test_topology.py)
build   : Application bundle generation complete. topology-component 8.49 kB
```

El único fallo es `app.spec.ts > should render title`, **preexistente y ajeno**: falla idéntico
en el árbol limpio de `f192c22` y el archivo no lo tocó nadie de este trabajo. Reportado, no
arreglado (regla vigente).

### Los tests no son vacuos: verificado por mutación

| Mutación aplicada | Tests que fallaron |
|---|---|
| Volver a devolver listas vacías ante fallo | 3 (`..._503` ×2, `..._500`) |
| `"alerta"` → `"operativo"` en la derivación de estado | 1 (`test_estado_de_maquina_se_deriva_de_las_ots`) |
| Revertir A-2 (todas las plantas) + A-3 (solo `plantas[0]`) | **4** (`test_a2_...`, `test_a3_...`, `test_sin_nodos_huerfanos`, `test_toda_planta_tiene_al_menos_una_disciplina`) |

Cada mutación se restauró y la suite volvió a verde.

---

## 6. ¿Queda algo suelto?

| # | Punto | Estado |
|---|---|---|
| 1 | Cuatro tablas `topologia_*` pobladas y sin lector | **Decisión pendiente de René** (`docs/TOPOLOGIA.md`, CGBIDA-370) |
| 2 | La ruta `/debug` y su pantalla no existen | Derivado a **CGBIDA-375** |
| 3 | 401 vs 422 en endpoints autenticados | Derivado a **CGBIDA-374** |
| 4 | `app.spec.ts` roto | Ajeno, reportado |
| 5 | 13 errores de ruff en `chat.py`, `conftest.py`, `test_chat*.py` | Ajenos, reportados |
| 6 | El endpoint emite 422 en vez de 401 sin token | Aceptado; documentado y derivado a CGBIDA-374 |
| 7 | El grafo dejó de ser un árbol estricto (A-3) | Documentado en el contrato como comportamiento esperado |

---

## 7. Limitación de esta revisión

**La ejecutó quien implementó**, así que no cumple el propósito de una revisión cruzada
independiente: no es una defensa contra los sesgos de quien escribió el código. Lo que sí
aporta es el contraste mecánico (comandos, mutaciones, evidencia cruda) en lugar de un juicio.

Idealmente la revisa **otra persona del equipo** antes del merge. Está anotado en las reglas
del proyecto: CGBIDA-373 se cierra con "revisión registrada", y esta lo está, pero conviene
que JP o Javier le den una pasada al diff.

## 8. NO VERIFICABLE

| # | Qué | Por qué |
|---|---|---|
| 1 | Que el mapa **se dibuje** correctamente en Chrome | No puedo ejecutar JavaScript en un navegador. Los 29 tests renderizan en jsdom, no en un motor real. **Requiere que lo mire René** en `http://localhost:4200/topology` |
| 2 | Que el paneo se sienta fluido con el mouse real | Igual que el anterior: jsdom no tiene layout |
| 3 | Que los colores sean legibles en tema claro y oscuro | Juicio visual; el tema del rewrite no se probó en el mapa |
| 4 | Comportamiento con 3+ plantas por disciplina | El seed solo tiene disciplinas en 2 plantas |
