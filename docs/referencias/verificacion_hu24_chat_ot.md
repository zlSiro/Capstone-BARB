# CGBIDA-535 — Verificación y Cierre de HU-24

**Fecha:** 2026-11-16 · **Rama:** `feat/CGBIDA-535-hu-24` · **Alcance:** CGBIDA-535 y subtareas 536, 537, 538, 539  
**Historia de Usuario:** HU-24 · «El chat consultará y creará OTs por conversación»

---

## 1. Matriz de Criterios de Aceptación

| # | Criterio de la HU | Subtarea | Estado | Evidencia |
|---|---|---|---|---|
| **CA-1** | Consulta de órdenes de trabajo abiertas de un equipo sin necesidad de permisos especiales. | CGBIDA-535 | ✅ | `test_chat_graph.py::test_la_tool_encuentra_una_maquina_real_y_cuenta_sus_ots`; tool `consultar_ots_maquina`. |
| **CA-2** | **RBAC fail-closed:** Si el rol no puede crear OTs directas, la herramienta `proponer_ot` no se registra y el prompt la omite. | CGBIDA-536 | ✅ | `test_permisos_tools.py::test_roles_sin_permiso_no_reciben_la_tool_proponer_ot`, `test_el_prompt_omite_regla_proponer_ot_para_roles_sin_permiso`. |
| **CA-3** | **Asignación de técnico:** Al crear una OT, si quien chatea es técnico se le asigna a él; si es supervisor se asigna al primer técnico de la empresa. | CGBIDA-537 | ✅ | `test_crear_ot.py::test_resolver_tecnico_asigna_al_tecnico_de_la_conversacion`, `test_resolver_tecnico_supervisor_asigna_al_primer_tecnico`. |
| **CA-4** | **Aislamiento multiempresa:** Nunca se asignan técnicos de otra empresa ni se consultan o crean OTs en activos ajenos. | CGBIDA-537 | ✅ | `test_crear_ot.py::test_resolver_tecnico_aislamiento_multiempresa`, `test_crear_ot_no_escribe_en_otra_empresa`. |
| **CA-5** | **Candado humano y caducidad:** Proponer nunca inserta; el INSERT requiere confirmación explícita y la propuesta caduca si la conversación continúa. | CGBIDA-538 | ✅ | `test_candado_ot.py::test_el_modelo_solo_ve_tools_de_lectura_y_propuesta`, `test_candado_ot.py::test_confirmacion_inserta_la_ot`. |
| **CA-6** | **Tolerancia a errores ortográficos (Fuzzy):** Tolerar variaciones en nombres y códigos (`bom001`, `bom-01`, `BOM-001`) sin falsos positivos. | CGBIDA-539 | ✅ | `test_chat_graph.py::test_el_matcher_tolera_variaciones_en_codigo_de_maquina`, `test_el_matcher_resuelve_las_mutaciones_de_cada_maquina_real`. |

---

## 2. Estado de Subtareas en Jira

| Subtarea | Resumen | Estado | Implementación |
|---|---|---|---|
| **CGBIDA-536** | RBAC fail-closed en tools y prompt | Listo | `crear_tools()` no registra `proponer_ot` para roles sin permiso; `_prompt_sistema` omite la regla 9. |
| **CGBIDA-537** | Asignación por rol y aislamiento | Listo | `_resolver_tecnico()` asigna técnico de la sesión o primer técnico de la empresa; tests en `test_crear_ot.py`. |
| **CGBIDA-538** | E2E + docs | Listo | Sección §2.14 en `docs/referencias/AI_ARCHITECTURE.md` y este informe de verificación. |
| **CGBIDA-539** | Fuzzy matching en máquinas | Listo | Tolerancia en `_buscar_maquinas`, `_puntaje` y `_coincide_identificador` con pruebas de variación y aislamiento. |

---

## 3. Suite Automatizada de Verificación

Se ejecutó la suite de tests unitarios e integrados que cubren el alcance de la HU-24:

```bash
uv run pytest tests/test_permisos_tools.py tests/test_crear_ot.py tests/test_candado_ot.py tests/test_chat_graph.py
```

- **`test_permisos_tools.py`**: 22 passed (evaluación de permisos, omisión de tool para 7 perfiles no autorizados, validación de prompt condicional, defensa en profundidad en `crear_ot_aprobada`).
- **`test_crear_ot.py`**: 13 passed (creación real coherente, anti-duplicados, aislamiento de empresa, asignación por rol y bloqueo ante empresa sin técnicos).
- **`test_candado_ot.py`**: 9 passed (candado humano, preservación de texto literal en borrador, confirmación, rechazo y ambigüedad).
- **`test_chat_graph.py`**: 23 passed, 1 skipped (resolución de nombres de equipos, variaciones de códigos, propiedades de mutación difusa y aislamiento multi-tenant).

**Total verificado:** 67 tests específicos en verde.

---

## 4. Verificación E2E de Flujo Conversacional

### Escenario A: Usuario Supervisor (Creación con éxito)
1. **Inicio de sesión:** `supervisor@mineradelnorte.cl` (rol `supervisor`).
2. **Turno 1 (Consulta de OTs):**
   - *Usuario:* «¿Cuántas OTs abiertas tiene la bomba de pulpa?»
   - *Asistente:* Invoca `consultar_ots_maquina("bomba de pulpa")`. Responde con el recuento y listado de OTs abiertas.
3. **Turno 2 (Propuesta de OT):**
   - *Usuario:* «Por favor crea una orden de trabajo correctiva para la bomba BOM-01 por fuga severa en el sello mecánico.»
   - *Asistente:* Invoca `proponer_ot(nombre_maquina="bomba BOM-01", descripcion_problema="fuga severa en el sello mecánico", prioridad="high")`.
   - *Asistente (Respuesta):*
     ```text
     PROPUESTA DE ORDEN DE TRABAJO:
     - Equipo: Bomba de pulpa KSB (BOM-001)
     - Problema: fuga severa en el sello mecánico
     - Prioridad: high
     ¿Confirmas la creación de esta orden de trabajo?
     ```
   - *BD:* No se ha insertado ninguna fila en `orden_trabajo`.
4. **Turno 3 (Confirmación):**
   - *Usuario:* «Sí, confirmo.»
   - *Grafo (`gate_ot`):* Intercepta la confirmación antes del modelo. Ejecuta `crear_ot_aprobada`.
   - *Asistente (Respuesta):*
     ```text
     OT creada: **OT-IA-20261116-220000-A1B2**
     ```
   - *BD:* Fila insertada con `creado_por = 7` (supervisor), `tecnico_id = 4` (primer técnico activo), `estado = 'pending'`, `tipo = 'corrective'`, `origen = 'ia'`.

### Escenario B: Usuario Técnico / Operador (RBAC fail-closed)
1. **Inicio de sesión:** `tecnico1@mineradelnorte.cl` (rol `tecnico`).
2. **Turno 1:**
   - *Usuario:* «Crea una orden de trabajo para el chancador por sobrecalentamiento.»
   - *LLM:* No tiene disponible la herramienta `proponer_ot` ni la instrucción en el system prompt.
   - *Asistente (Respuesta):* Explica que como técnico no cuenta con privilegios para generar OTs directamente sin un aviso de falla previo y ofrece registrar un aviso de falla conforme al flujo operativo.
