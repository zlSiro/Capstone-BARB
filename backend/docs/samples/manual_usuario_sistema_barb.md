# Manual de Usuario — Plataforma BARB (Gestión de Mantenimiento Industrial)

**Versión:** 1.0 (Nivel Usuario) · **Sistema:** BARB  
**Destinatarios:** Operadores, Técnicos, Supervisores, Ingenieros, Gerentes y Administradores.

---

## 1. ¿Qué es BARB y de qué se trata el sistema?

**BARB** es una plataforma integral de software diseñada para la **gestión moderna del mantenimiento industrial**, asistida por Inteligencia Artificial especializada.

El objetivo principal de BARB es:
- Centralizar y estandarizar la operación de mantenimiento preventivo y correctivo en las plantas productivas.
- Reducir al mínimo los tiempos de inactividad de las máquinas (paradas de planta) y los costos asociados por minuto detenido.
- Facilitar a los trabajadores en terreno (operadores y técnicos) el acceso instantáneo a manuales, directrices de seguridad y soporte técnico a través del asistente conversacional con IA (**DocChat**).
- Agilizar la detección temprana de fallas mediante **Avisos de Falla** y su conversión controlada en **Órdenes de Trabajo (OT)**.
- Proveer a la gerencia y supervisión métricas confiables de desempeño operacional (SLA, MTBF, MTTR y costos).

---

## 2. Módulos y funcionalidades para el usuario

### 2.1 DocChat (Asistente de Mantenimiento con IA)
DocChat es el asistente conversacional experto de BARB disponible para todos los usuarios de la empresa. Sus capacidades principales incluyen:
- **Consulta inteligente de documentación (RAG):** Responde preguntas sobre procedimientos de mantención, pares de apriete (torque), tolerancias, lubricación y diagnóstico de fallas basándose exclusivamente en los manuales de fabricante cargados en la empresa.
- **Consulta en tiempo real de Órdenes de Trabajo (OT):** Informa al instante cuántas OTs abiertas tiene un equipo, en qué estado se encuentran y su prioridad.
- **Reporte conversacional de Avisos de Falla:** Permite a operadores y técnicos describir una anomalía en lenguaje natural; el asistente estructura la propuesta de aviso y solicita confirmación antes de guardarla.
- **Topología y catálogo de equipos:** Permite consultar la cantidad y nombres de plantas, sedes, ubicaciones y máquinas registradas.
- **Análisis multimodal (Imágenes):** Permite adjuntar fotos o capturas de pantallas, paneles de control o componentes mecánicos dañados para recibir orientación visual técnica preliminar.
- **Candado de confirmación humana:** Toda acción de impacto operativo (proponer OTs, registrar avisos, crear plantas o modificar SLA/costos) requiere siempre la confirmación explícita del usuario (`sí` / `no`). El asistente nunca escribe directamente en la base de datos sin aprobación humana.

### 2.2 Órdenes de Trabajo (OT)
El módulo de Órdenes de Trabajo permite planificar, ejecutar y certificar las tareas de mantenimiento en cada máquina.
- **Ciclo de vida de una OT:**
  1. `Pendiente`: La OT ha sido creada y asignada a un técnico responsable.
  2. `En curso`: El técnico asignado inicia formalmente la intervención en terreno.
  3. `Por validar`: El técnico concluye la labor y remite la OT a revisión de supervisión.
  4. `Cerrada`: El supervisor valida y aprueba el trabajo realizado con éxito.
  5. `Cancelada`: La OT se anula por motivo justificado registrado en el sistema.
- **Prioridades:** Baja, Media, Alta y Urgente.
- **SLA de Máquina:** Tiempo máximo (en horas) estipulado para restablecer la operatividad del equipo antes de considerar la OT atrasada.

### 2.3 Avisos de Falla
Canal ágil para la detección temprana de anomalías:
- Cualquier usuario en planta (operador, técnico, supervisor) puede registrar un aviso indicando equipo, severidad (baja, media, alta, crítica) y descripción del problema.
- Los avisos ingresan a la bandeja del supervisor en estado `Pendiente`.
- El supervisor evalúa el aviso y decide si genera una Orden de Trabajo vinculada o descarta el aviso indicando el motivo.

### 2.4 Topología y Mantenedor de Plantas y Máquinas
Visualiza y gestiona la estructura de activos de la empresa:
- **Jerarquía:** Empresa → Plantas (con ubicación geográfica/comuna) → Máquinas.
- **Disciplinas:** Clasificación técnica de equipos (Mecánica, Eléctrica, Neumática, Hidráulica, Automatización, etc.).
- **Parámetros operativos críticos:**
  - **SLA (horas):** Plazo máximo tolerado de detención del equipo.
  - **Costo de inactividad por minuto ($/min):** Impacto financiero estimado por cada minuto que la máquina permanece fuera de servicio.

### 2.5 Módulo de Documentos
Biblioteca digital de conocimiento técnico:
- Almacena manuales de servicio, esquemas eléctricos, catálogos de piezas y fichas técnicas en formato PDF, Word (DOCX) o Markdown (MD).
- Cada documento se indexa automáticamente para que DocChat pueda citar párrafos específicos y procedimientos exactos al responder.

### 2.6 Dashboard y Métricas (KPIs)
Panel de control para supervisores, ingenieros y gerencia:
- Monitoreo del porcentaje de cumplimiento de SLA.
- Métricas de confiabilidad: MTBF (Tiempo Medio Entre Fallas) y MTTR (Tiempo Medio de Reparación).
- Análisis de costo directo por inactividad y ahorro económico generado por la gestión preventiva.

### 2.7 Historial y Bitácora
- Registro detallado de OTs finalizadas e histórico de intervenciones por equipo.
- Trazabilidad y auditoría de acciones realizadas por cada usuario en la plataforma.

---

## 3. Delimitación y alcance de DocChat

DocChat es un asistente de **propósito específico**:
- Su ámbito se circunscribe **estrictamente al mantenimiento industrial, a los activos de la empresa y a la operación del software BARB**.
- **No responde preguntas de conocimiento general ajenas a la industria**, tales como gastronomía, turismo, deportes, entretenimiento, farándula, política o consultas personales.
- **No cuenta chistes, cuentos ni participa en entretenimientos o juegos.**
- **No emite opiniones ni recomendaciones sobre maquinaria externa de internet** que no pertenezca a la empresa o no esté debidamente respaldada en sus manuales técnicos.
