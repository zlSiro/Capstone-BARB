# Matriz de roles y privilegios

Fuente de verdad: `backend/src/barb/core/permissions.py` (matrices `RUTAS` y `ACCIONES`), con las reglas adicionales de
`routers/users.py`, `routers/empresas.py`, `routers/work_orders.py`, `routers/avisos.py` y `core/work_order_states.py`.
El frontend la replica en `frontend/src/app/core/permissions/permissions.ts` (solo controla qué se muestra; el backend es quien valida).
**Cualquier cambio de permisos debe hacerse en los tres lugares** (backend, frontend y este documento) y reflejarse en el aviso de privilegios que se muestra tras el login (`frontend/src/app/core/i18n/textos/privilegios.ts`, ES/EN). Los tests
`backend/tests/test_permissions.py` y `frontend/src/app/core/permissions/permissions.spec.ts` verifican que no se desalineen.

Leyenda: ✔ acceso total · 👁 solo lectura · propio = solo lo suyo · — sin acceso

## Roles

| Rol | Qué es |
|---|---|
| `operador` | Personal de planta. Reporta fallas y sigue en qué quedaron; ve solo las OT que nacieron de sus avisos. |
| `tecnico` | Ejecuta el trabajo. Ve las OT que tiene asignadas, puede iniciarlas y reporta fallas. |
| `supervisor` | Dirige el trabajo: decide sobre los avisos, crea, prioriza y asigna OT, cambia estados y cancela. Es el único rol que opera las OT. |
| `engineer` | Ingeniería: consulta las OT, analiza el historial y los KPIs operativos y gestiona la documentación técnica. No cambia estados ni cancela. |
| `gerente` | Responsable de la empresa: consulta (OT, avisos, dashboard, historial, bitácora de la empresa) y gestiona a los administradores. No opera las OT, ni los mantenedores, ni los documentos. |
| `admin` | Gobierno del sistema: usuarios operativos, plantas, máquinas, disciplinas, documentos y notificaciones. No opera sobre las OT ni ve dashboard e historial. |
| `super_usuario` | Contraparte comercial de BARB. Sin empresa: administra empresas y gerentes; no accede a datos operativos. |

## Pantallas y rutas (`RUTAS`)

| Pantalla / ruta | operador | tecnico | supervisor | engineer | gerente | admin | super_usuario |
|---|---|---|---|---|---|---|---|
| Órdenes de trabajo (`menu`) | propias | asignadas | ✔ | ✔ | 👁 | 👁 | — |
| **Avisos de falla (`avisos`)** | propios | propios | ✔ repositorio | propios | 👁 repositorio | — | — |
| DocChat (`docchat`), `debug`, `report` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Topología, `memory` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Dashboard | — | — | ✔ | ✔ | ✔ | — | — |
| Historial (`history`) | — | — | ✔ | ✔ | ✔ | — | — |
| Documentos | 👁 | 👁 | 👁 | ✔ | 👁 | ✔ | — |
| Plantas, disciplinas y máquinas (alta) | — | — | — | — | — | ✔ | — |
| Notificaciones por correo (configuración) | — | — | ✔ | — | — | ✔ | — |
| Usuarios (mantenedor) | — | — | — | — | ✔ solo admin | ✔ operativos | ✔ solo gerentes |
| Empresas (mantenedor) | — | — | — | — | — | — | ✔ |
| Transacciones propias (`transacciones`) | — | — | — | — | — | — | ✔ |
| Transacciones de la empresa (`transacciones_empresa`) | — | — | — | — | ✔ | — | — |

## Acciones (`ACCIONES`)

| Acción | operador | tecnico | supervisor | engineer | gerente | admin | super_usuario |
|---|---|---|---|---|---|---|---|
| `crear_ot` (directa, sin aviso previo; **solo supervisor**) | — | — | ✔ | — | — | — | — |
| `cambiar_estado_ot` (iniciar la OT) | — | — | ✔ | — | — | — | — |
| `iniciar_ot_asignada` | — | solo la suya | — | — | — | — | — |
| **`enviar_a_validacion`** (`en curso → por validar`) | — | solo la suya | ✔ | — | — | — | — |
| **`validar_ot`** (`por validar → cerrada`, o devolver a en curso con comentario) | — | — | ✔ | — | — | — | — |
| `cancelar_ot` (con motivo obligatorio) | — | — | ✔ | — | — | — | — |
| `eliminar_ot` (el endpoint responde 403 a todos) | — | — | — | — | — | — | — |
| **`reportar_falla`** | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| **`gestionar_avisos`** (generar OT o descartar) | — | — | ✔ | — | — | — | — |
| **`asignar_ot`** (priorizar, asignar y reasignar) | — | — | ✔ | — | — | — | — |
| `subir_documentos`, `eliminar_documentos` | — | — | — | ✔ | — | ✔ | — |
| `configurar_notificaciones` | — | — | ✔ | — | — | ✔ | — |
| `ver_usuarios`, `gestionar_usuarios` | — | — | — | — | ✔ solo admin | ✔ operativos | ✔ solo gerentes |
| `gestionar_empresas` | — | — | — | — | — | — | ✔ |
| **`ver_kpis_financieros`** (costo directo, ahorro, impacto anual y ranking por costo del dashboard) | — | — | — | — | ✔ | — | — |

## Reglas que no están en las matrices

- **Aislamiento por empresa:** todo usuario de empresa ve únicamente lo de su empresa, y el servidor ignora cualquier `empresa_id`
  que mande el cliente. Solo el superusuario puede indicar una empresa.
- **Alcance «propio» (operador y técnico):** ven las OT que tienen asignadas, que crearon, o que nacieron de un aviso suyo. Las demás
  responden 404 (no se revela que existen), tanto en el listado, el detalle, la topología como en el canal en tiempo real (SSE).
  El resto de los roles de empresa ve todas las OT de su empresa.
- **Aviso de falla → OT:** quien reporta (con foto opcional) ve solo sus avisos. Supervisor y gerente ven el repositorio completo,
  pero solo el supervisor decide: generar una OT (queda enlazada al aviso) o descartar (con motivo obligatorio, que ve quien reportó).
  El gerente consulta, no decide. Detalle en `docs/AVISOS_FALLA.md`.
- **Notificación de atrasos:** el correo de OT atrasadas llega a los destinatarios configurados y, además, a los gerentes y supervisores activos de la empresa (si la notificación está activa). La configuran supervisor y admin; el gerente solo la recibe.
- **Estados de las OT:** `pending → in_progress → por_validar → completed`; desde `por_validar` el supervisor también puede devolverla a
  `in_progress` (comentario obligatorio). Cualquier estado activo puede pasar a `cancelled` (motivo obligatorio). `completed` y
  `cancelled` son finales; `in_progress → completed` directo no existe. El técnico asignado solo puede iniciar y enviar a validación su
  OT; un técnico que no es el asignado recibe 403. El supervisor que envió la OT a validación puede validarla (sin bloqueo de autovalidación).
  `por_validar` cuenta como OT abierta (estadísticas, atrasadas, topología, tiempo real).
- **Gestión de usuarios:**
  - Nadie puede asignar `super_usuario`.
  - **Gestión en cascada:** `super_usuario` → gerentes · `gerente` → administradores · `admin` → operador, técnico, supervisor e
    ingeniero. Cada perfil crea, ve, edita y elimina solo al nivel siguiente: crear o asignar fuera de su alcance responde 403 y
    ver o editar fuera de su alcance responde 404.
  - Una empresa conserva **al menos un supervisor activo**: no se puede desactivar, eliminar ni cambiar el rol del último (409).
    Una empresa nueva todavía sin supervisor no se bloquea.
  - Nadie alcanza su propio registro (404), así que nadie se desactiva, cambia de rol ni elimina a sí mismo.
  - No se puede convertir a alguien en superusuario ni al revés.
  - Se respeta el límite de licencias `max_usuarios`.
- **Superusuario:**
  - Solo crea y gestiona usuarios con perfil gerente.
  - No accede a OT, avisos, dashboard, topología, DocChat ni documentos.
  - Las empresas no se eliminan, solo se suspenden; una empresa suspendida bloquea el acceso de todos sus usuarios.
  - Ve únicamente sus propias transacciones (las de usuarios con rol `super_usuario`).
- **Eliminar OT:** ningún perfil puede (decisión D1). El endpoint `DELETE /api/work-orders/{numero_ot}` se mantiene y responde
  403 por permisos; lo normal es cancelar. Solo los tests borran, por SQL, las OT que ellos mismos crearon.
- **Bitácora (`transacciones`):** el gerente ve las transacciones de los usuarios de su empresa, sin las del superusuario.
  Ninguna vista muestra transacciones sin usuario identificado.

## Detalles a tener presentes

1. **Algunas pantallas solo se restringen en la interfaz.** El backend no valida `menu`, `debug`, `memory`, `report`, `history` ni
   `docchat` con la matriz: cuando el frontend oculta una pantalla, la restricción está solo ahí. El backend sí aplica la matriz en
   dashboard, topología, documentos, plantas, notificaciones, usuarios, empresas, avisos y ambas bitácoras.
2. **El chat IA no usa la matriz.** `/api/chat` solo exige una sesión válida y excluye al superusuario.
3. **KPIs financieros:** el dashboard muestra a supervisor e ingeniero solo los KPIs operativos. `GET /api/stats/financial-impact` omite
   (no pone en cero) `financials.ahorro_generado`, `financials.costo_total_acumulado`, `impacto_anual`, `machines_por_costo` y los campos
   `ahorroGenerado`/`costo_total` de cada máquina, y devuelve `financieros_visibles: false`. Solo el gerente (`ver_kpis_financieros`) los recibe.
   Los costos por OT (`costo_estimado`/`costo_real`) y el costo por máquina del catálogo no cambian.
4. **Pendiente de las fases siguientes** (no implementado): registro de avance del técnico (notas, fotos, repuestos) y datos de cierre
   obligatorios (resolución, tiempo de parada, costo).
