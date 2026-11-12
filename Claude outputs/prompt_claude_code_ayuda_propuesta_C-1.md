Necesito que implementes en el frontend de BARB el apartado de ayuda «Aprende BARB» (Propuesta C, aprobada por el equipo). Lee completo este mensaje antes de empezar y trabaja por etapas, verificando cada una.

## 0. Antes de tocar código

1. Lee `CLAUDE.md`, `AGENTS.md`, `frontend/CLAUDE.md` y `matriz_rol.md`. Sigue al pie de la letra las convenciones de `frontend/CLAUDE.md` (componentes standalone sin `standalone: true`, `input()`/`output()`, signals con `set`/`update`, `computed()`, control de flujo nativo, sin `CommonModule`, sin `ngClass`/`ngStyle`, `inject()`, `@Service` para servicios nuevos, AXE y WCAG AA).
2. Lee la propuesta de referencia: `Claude outputs/Propuestas ayuda/Propuesta_C_Aprende_BARB_guias_interactivas.pdf`. Las maquetas son la guía visual; los datos que aparecen en ellas son de ejemplo.
3. Ejecuta `git status`. Hay archivos modificados sin commitear de otra tarea (chat, tests del backend, `frontend/src/app/core/i18n/translations.ts`, `chat-titulo.ts`, entre otros). **No los toques ni los incluyas en tus cambios.** La única excepción es `translations.ts`: ahí solo puedes agregar las dos claves de la sección `nav` que se indican abajo, sin reformatear ni mover nada más. Si eso no se puede hacer sin mezclar cambios ajenos, detente y avísame.
4. Crea la rama `feat/HU-18_<subtarea>` desde `main` antes de cambiar algo.
5. Revisa estos archivos antes de programar:
   - Navegación: `shared/components/layout/nav-items.ts`, `sidebar/sidebar.component.ts`, `bottom-nav/bottom-nav.ts`, `main-layout/main-layout.component.ts`, `header/header.component.ts`.
   - Rutas y permisos: `app.routes.ts`, `core/guards/`, `core/permissions/permissions.ts` y `permissions.service.ts`.
   - Idioma: `core/i18n/i18n.service.ts` (`tr`, `textoActual`, señal `lang`), `translate.pipe.ts`, `translations.ts`, `textos/index.ts`, `textos/privilegios.ts` (patrón a imitar), `idioma-vistas.spec.ts` y `translations.spec.ts`.
   - Visual: `src/styles.css` (tokens, `.btn-*`, `.chip-*`, `.panel`, `.pill`, `.fld-*`, animación `hoja-sube`, `--radius-hoja`) y `shared/components/ui/icon/icon.ts`.
   - Dashboard: `features/dashboard/dashboard.component.ts`, `core/models/stats.model.ts`, `core/services/currency.service.ts`, `core/services/mtbf-unit.service.ts`, y en el backend (solo lectura) `backend/src/barb/routers/stats.py` para las reglas de Salud Operacional, Disponibilidad y OT demoradas.
6. Antes de programar, muéstrame un plan corto con los archivos que vas a crear y modificar, y espera mi confirmación.

## 1. Reglas obligatorias

- **Solo frontend.** No modifiques nada en `backend/`, ni migraciones, ni endpoints.
- **La pestaña «Ayuda» se muestra a toda sesión iniciada**, porque es contenido fijo del frontend. **No** agregues una `RutaKey` nueva ni cambies `permissions.ts`, `permissions.py`, `matriz_rol.md`, `privilegios.ts` ni sus tests. El acceso a la ruta lo controla solo `authGuard`, que ya protege al layout principal.
- **Dentro de la ayuda, cada usuario ve solo lo de su perfil.** Cada guía, tarea de primeros pasos y recorrido declara qué `RutaKey` y/o `AccionKey` necesita, y se filtra con `PermissionsService.canAccess()` / `canPerform()`. La matriz de `permissions.ts` sigue siendo la única fuente de verdad: no repitas listas de roles a mano.
- **Español e inglés en todo.** Ningún texto visible queda escrito en la plantilla o en el código. Todo sale de i18n, se actualiza al cambiar el idioma con el botón ES/EN de la cabecera sin recargar ni recrear la vista, y vuelve a quedar igual al regresar a ES. Esto aplica también al buscador, a los recorridos, al resumen del dashboard, a los `aria-label` y a los textos para lectores de pantalla.
- **Sin IA y sin inventar datos.** «Explícame» arma frases con plantillas fijas a partir de las cifras que el dashboard ya recibe. «Pregúntale» responde solo con guías existentes. No llames a `/api/chat` ni a DocChat desde la ayuda.
- Usa los tokens y clases que ya existen en `styles.css`. No agregues colores, fuentes ni dependencias nuevas.
- No hagas commit ni push. Yo hago el commit con el resumen que me entregues al final.

## 2. Etapa A — Pestaña, ruta y textos

1. **Ruta:** agrega `{ path: 'ayuda', loadComponent: ... }` como hija del layout principal en `app.routes.ts`, **sin** `roleGuard`. Si usas subrutas (por ejemplo `ayuda/preguntar`), van igual.
2. **Ítem del menú:** en `nav-items.ts` agrega `'ayuda'` al tipo de `label` y haz que `ruta` pueda faltar para los ítems visibles en toda sesión (por ejemplo `ruta?: RutaKey`). Ajusta el filtro de `sidebar.component.ts` y de `bottom-nav.ts` para que un ítem sin `ruta` siempre se muestre (por ejemplo `!i.ruta || canAccess(i.ruta)`). Revisa que nada más dependa de que `ruta` exista (por ejemplo `item.ruta === 'avisos'` para el contador).
3. **Posición:**
   - En el menú lateral, «Ayuda» va al final y separado del resto (borde superior y empujado al fondo). Debe funcionar en el riel de íconos de tablet, con el nombre en el `title` y en `sr-only`, igual que los demás ítems.
   - En el celular, debe caer en el menú «Más». Dale una prioridad que lo deje siempre fuera de los 3 destinos principales.
   - Es el mismo lugar en todas las pantallas (WCAG 2.2, criterio 3.2.6).
4. **Ícono:** agrega `ayuda` a `icon.ts` (círculo con signo de interrogación, trazo de 2 px en la malla 24 × 24, igual que el resto). Agrega también los íconos que necesiten los recorridos (por ejemplo `adelante`, `play`, `foco`), con el mismo estilo. Si existe un test que recorre los íconos, actualízalo.
5. **Textos:**
   - En `translations.ts`, sección `nav`, agrega **solo** `ayuda: 'Ayuda', ayudaCorto: 'Ayuda'` en `es` y `ayuda: 'Help', ayudaCorto: 'Help'` en `en`.
   - Todo el resto va en un archivo nuevo, `core/i18n/textos/ayuda.ts`, que exporta `{ es, en }` con `en` tipado como `typeof es` (patrón de `privilegios.ts`), y se registra en `textos/index.ts`.
   - Escribe los textos en español neutro y su traducción al inglés.

## 3. Etapa B — Inicio «Aprende BARB» y primeros pasos

Componente de página en `features/ayuda/`, según la maqueta 1 del PDF:

- Encabezado con «Aprende BARB» y un chip con el perfil del usuario (etiqueta de rol traducida).
- Tarjeta «Primeros pasos como {rol}» con barra de avance, «{k} de {n}» y la lista de tareas. Cada tarea pendiente tiene el botón «Mostrarme cómo», que inicia su recorrido; las hechas muestran «Hecho».
- Panel «Pregúntale a la ayuda» (Etapa E), lista «Recorridos guiados» con el número de pasos de cada uno, y tarjeta «Explícame esta pantalla» que explica dónde está el botón.

Primeros pasos por perfil (filtra cada tarea con la acción o ruta que corresponda; si un perfil no tiene la acción, la tarea no aparece):

| Perfil | Tareas |
|---|---|
| operador | Confirmar privilegios · Reportar una falla con foto · Seguir mi aviso · Ver la OT que generó · Consultar un manual en DocChat |
| tecnico | Confirmar privilegios · Reportar una falla · Iniciar una OT asignada · Enviarla a validación · Consultar un manual en DocChat |
| supervisor | Revisar avisos pendientes · Generar una OT desde un aviso · Asignar una OT · Validar o devolver · Leer la Salud Operacional |
| engineer | Leer el dashboard operativo · Revisar el Top 5 por máquina · Subir un documento técnico · Reportar una falla · Usar DocChat |
| gerente | Leer el dashboard completo · Revisar el costo por máquina · Crear un administrador · Ver la bitácora · Revisar avisos |
| admin | Crear un usuario operativo · Registrar una planta y sus máquinas · Gestionar disciplinas · Subir un documento · Consultar OT |
| super_usuario | Crear una empresa · Crear su gerente · Suspender y reactivar una empresa · Ver mis transacciones |

Avance:
- Se guarda en `localStorage` con una clave por usuario (por ejemplo `barb.ayuda.progreso.<id de usuario>`). Envuelve lecturas y escrituras en `try/catch` y, si falla o viene vacío, parte de cero sin romper la vista.
- «Confirmar privilegios» se marca solo cuando el aviso de privilegios ya fue aceptado (revisa `AuthService.privilegiosPendientes`).
- Las demás tareas se marcan al terminar su recorrido. Si una acción de la app ya avisa cuando ocurre, úsala también (por ejemplo `ReportarFallaUi.creado` al crear un aviso). No agregues llamadas al backend para esto.

## 4. Etapa C — Recorridos guiados

1. **Servicio de recorridos** (`@Service`):
   - Cada recorrido es una lista de pasos con: ruta donde ocurre, selector del elemento a resaltar (atributo `data-tour="..."`), clave i18n del título y clave i18n del texto.
   - Expón con signals el recorrido activo, el paso actual y el total.
   - Métodos: iniciar, siguiente, anterior y salir.
   - Si el paso está en otra ruta, navega a ella y espera a que el elemento exista.
   - Si el elemento no aparece en un tiempo razonable, muestra el paso sin resaltado y con un aviso traducido. Nunca dejes al usuario trabado.
2. **Capa del recorrido:**
   - Componente montado en `main-layout`. Oscurece la pantalla (`--velo`), resalta el elemento con borde `--senal` y muestra una burbuja con «Paso {n} de {total}», barra de avance, título, texto y los botones «Anterior», «Siguiente» y «Salir del recorrido».
   - En el celular, la burbuja va abajo, sobre la barra inferior.
   - El usuario puede interactuar con el elemento resaltado (por ejemplo cambiar el estado de verdad) o avanzar sin tocar nada.
3. **Accesibilidad:**
   - El recorrido no avanza solo ni tiene límite de tiempo.
   - `Esc` lo cierra.
   - El foco entra en la burbuja al empezar y vuelve al botón que lo inició al salir.
   - La burbuja tiene `role="dialog"` con `aria-labelledby`, y cada cambio de paso se anuncia con una región `aria-live`.
   - El resaltado no depende solo del color: lleva borde y el texto del paso.
   - Respeta `prefers-reduced-motion`, que ya está en `styles.css`.
4. **Marcas:** agrega atributos `data-tour` a los elementos que usan los recorridos, por ejemplo:
   - el botón «Reportar falla» (cabecera y barra inferior);
   - el selector de estado de la lista de OT;
   - los botones «Generar OT» y «Descartar» de Avisos;
   - el campo de pregunta de DocChat;
   - las tarjetas de KPI y la Salud Operacional del dashboard.

   **Solo agregas el atributo: no cambies la lógica de esas pantallas.**
5. **Recorridos de esta entrega:** construye los que respaldan los primeros pasos de cada perfil. Si alguno depende de una pantalla que no existe en el frontend, no lo construyas y avísame en el resumen final. Arranca por el piloto del técnico, «Iniciar y enviar a validación una OT»:
   - Abre «Órdenes».
   - Elige la OT.
   - Pásala a «En curso».
   - Al terminar, cámbiala a «Por validar».
   - El supervisor la revisa.

## 5. Etapa D — «Explícame este dashboard»

1. Botón «Explícame» (ícono `foco`) en la cabecera del dashboard, junto a la moneda y el período. Abre un panel lateral a la derecha (en el celular, una hoja inferior) con las pestañas «Resumen» y «Cómo leerlo». Es el único cambio visible en `dashboard.component.ts`.
2. **Función pura** (en su propio archivo, sin inyección) que recibe la respuesta `FinancialStats` que el dashboard ya tiene, el rango elegido y las funciones de formato de moneda y de MTBF. Devuelve una lista de frases con este orden:
   - **Salud Operacional** (`salud_operacional`): estado traducido (Saludable, Atención, Crítico o Sin datos) y su motivo.
     - Atención: el campo `motivo` lo redacta el backend **solo en español**. En ES, muéstralo tal cual. En EN, arma el motivo con los campos estructurados (`vencidas`, `estancadas`, `sla`) siguiendo las mismas reglas de `stats.py` (crítico si hay al menos una OT vencida o el SLA está bajo 85 %; atención si hay OT demoradas o el SLA está bajo 95 %).
     - Si en EN no se puede reconstruir el motivo con exactitud, muestra el estado con las cifras de SLA y OT vencidas, sin motivo. Nunca traduzcas el texto del backend a mano.
   - **Cumplimiento de SLA** (`financials.efficiency`): porcentaje y comparación con el objetivo de 95 % y el piso de 85 %. Agrega «de cada {n} OT cerradas, {k} se cerraron dentro de 24 h» solo si el porcentaje corresponde exactamente a una fracción con denominador de 10 o menos. Si no, deja solo el porcentaje.
   - **Disponibilidad** (`financials.disponibilidad_planta`): porcentaje de tiempo detenido (100 − valor). Con un rango numérico, agrega las horas aproximadas sobre `días × 24`. En «Histórico» no muestres horas.
   - **MTTR** (`financials.mttr`, en minutos): convertido a horas y minutos.
   - **MTBF** (`financials.mtbfHours`): con la unidad que eligió el usuario (`MtbfUnitService`). Si es nulo o `mtbf_visible` es falso, usa el texto `financial.mtbfNeedData` que ya existe.
   - **Costo directo** (`financials.costo_total_acumulado`): solo si `financieros_visibles` no es `false`, con la moneda activa (`CurrencyService`) y un enlace que abra el desglose por máquina que ya existe.
3. Cierra con la nota traducida: «Resumen armado con plantillas a partir de las mismas cifras que muestra el dashboard. No usa IA ni agrega datos.»
4. Los números se formatean según el idioma activo (coma decimal en ES y punto en EN), igual que el resto del dashboard. Revisa cómo lo hace hoy y úsalo.

## 6. Etapa E — «Pregúntale a la ayuda» (búsqueda local)

- Vista conversacional según la maqueta 4 del PDF: la pregunta del usuario a la derecha y, debajo, una respuesta con un texto corto, pasos, «Fuente: guía "{título}"» y tres botones: «Mostrarme en la pantalla» (inicia el recorrido), «Ir a {pantalla}» y «Abrir la guía».
- La búsqueda se hace sobre el contenido de ayuda **del idioma activo** y **del perfil del usuario**: títulos, palabras clave y sinónimos de planta definidos por idioma en `textos/ayuda.ts` (por ejemplo «cerrar» = «validar», «ticket» = «OT» / «close» = «validate», «ticket» = «work order»). Normaliza mayúsculas y tildes.
- Usa `computed()` sobre la pregunta y el idioma. Sin servidor ni IA.
- Si nada coincide, dilo con claridad y ofrece «Preguntar en DocChat» (solo si el perfil tiene acceso a `docchat`; navega a `/chat` sin enviar nada) o «Contactar al administrador». El superusuario no tiene DocChat.

## 7. Etapa F — Pruebas y verificación

1. **Tests nuevos con Vitest:**
   - Filtrado por perfil: para cada uno de los 7 roles, ninguna tarea, guía o recorrido requiere una acción o ruta que el rol no tenga según `permissions.ts`.
   - Menú: «Ayuda» aparece para los 7 roles en el menú lateral y en «Más» del celular, y el resto de los ítems sigue filtrándose igual.
   - Ruta: `/ayuda` se abre con cualquier rol con sesión iniciada y redirige al login sin sesión.
   - Idioma: suma la vista de Ayuda a `idioma-vistas.spec.ts` con el mismo método (se monta en ES, se cambia a EN con el servicio, el texto cambia sin recrear la vista y vuelve al regresar a ES). Haz lo mismo con la burbuja de un recorrido y con el panel «Explícame».
   - Claves: todas las claves de `ayuda.ts` existen en ES y EN, y no hay claves faltantes en la consola (el `TranslatePipe` avisa con `console.warn`).
   - «Explícame»: casos por plantilla (SLA con y sin fracción exacta, MTBF nulo, rango «Histórico», costo oculto si `financieros_visibles === false`, motivo en ES copiado tal cual y motivo en EN reconstruido o sin motivo).
   - Recorridos: avanzar, retroceder, salir con `Esc`, devolución del foco y paso con elemento faltante.
   - Avance: `localStorage` vacío, corrupto o que lanza error.
   - Cada `data-tour` usado por un recorrido existe en su componente.
2. Ejecuta `npm test` y `npm run build`, y corrige todo lo que falle. Revisa que la vista pase AXE.
3. Revisa a mano en `npm start`, con al menos técnico, supervisor y gerente, en escritorio y en el ancho de un celular, en modo claro y oscuro, y cambiando ES ↔ EN con la ayuda abierta y con un recorrido en curso.

## 8. Resumen final

Entrégame:
- la lista de archivos creados y modificados;
- qué recorridos quedaron construidos y cuáles no (con el motivo);
- los resultados de `npm test` y `npm run build`;
- cualquier decisión que hayas tomado sin consultarme;
- un mensaje de commit sugerido en español.
