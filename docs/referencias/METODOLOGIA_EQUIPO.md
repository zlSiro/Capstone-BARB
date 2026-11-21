# Metodología del equipo — Spec Driven Development + Harness

> Basado en harness engineering (Mitchell Hashimoto, feb 2026): **el sistema alrededor del modelo importa más que el modelo**. Nuestro harness ya existe — esta página lo formaliza para que cualquier integrante (y cualquier agente de IA que use) trabaje igual.

## El harness de BARB (4 pilares)

1. **Documentación como código**: `AGENTS.md` en la raíz (contexto del proyecto + handoff al cierre de cada HU) y `frontend/AGENTS.md` (restricciones de código). Se actualizan al terminar cada historia — el agente que no lee el handoff arranca en blanco.
2. **Restricciones legibles por máquina**: las reglas del frontend (signals, standalone, sin `ngClass`), el flujo git (ramas por tarea, main protegida con review) y los contratos de API de `docs/`.
3. **Verificación en capas**: `ruff` + suite de tests **a mano antes de cada PR** (obligatorio) → review de un par (JP) → producción. CI automática queda como deuda registrada.
4. **Recolección de contexto**: al cerrar cada HU se actualiza el handoff (estado, hallazgos, deuda) para que la próxima sesión o agente no redescubra el proyecto.

## La regla SDD (acuerdo del equipo)

**Toda feature nueva nace como spec antes que código:**

1. Doc de diseño con decisiones (`docs/*_ARCHITECTURE.md`) y contrato de API si aplica (`docs/contrato_api_*.md`)
2. Validación con el equipo **antes de programar**
3. Código en rama por tarea, commits por subtarea, tests incluidos
4. PR con plantilla (el checkbox de spec lo verifica)
5. Verificación end-to-end real + cierre en Jira + handoff actualizado

**Regla de las specs:** una decisión sin verificación no cuenta — cada una debe decir *cómo se comprueba* (comando, prueba o evidencia esperada).

## Herramientas

Cada integrante usa el agente de IA que prefiera. El contrato común del equipo es **la spec**, no la herramienta: cualquier agente que reciba la spec validada produce el mismo resultado.

## Evidencia de que funciona

- **HU-04** (documentos + RAG): arquitectura y contrato validados antes de programar → producción en días, sin retrabajo.
- **HU-05** (multimodal): comparativa de model cards + ping real *antes* de integrar → el hallazgo del `Reasoning strength: low` se documentó antes de que produjera respuestas vacías en producción.
- Ambas incluyeron experimentos de validación (nunca se integra un modelo sin probarlo contra el endpoint real).
