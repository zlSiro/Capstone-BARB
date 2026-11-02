# Guía BARB — SLA de máquinas y costo de inactividad por minuto

**Alcance:** conceptos y política de gestión · **Empresa:** Planta Demo BARB

## 1. ¿Qué es el SLA de una máquina?

El **SLA (Service Level Agreement)** de una máquina en BARB es el plazo máximo, en
**horas**, que el negocio tolera que el equipo esté detenido desde que se abre la
orden de trabajo (OT) hasta que quede operativa de nuevo. Es una meta de
**tiempo de respuesta de mantenimiento**, no un dato del fabricante: se define por
equipo según el impacto del equipo en la producción.

- SLA corto (por ejemplo 6 h): equipos críticos cuyo para detiene la línea —
  como la **Pump E4 (PUMP-E4)** de San Bernardo.
- SLA largo (por ejemplo 24 h o más): equipos con redundancia o margen de buffer,
  como el **Compressor A1 (COMP-A1)**.

Cada vez que en BARB se crea una OT para una máquina con SLA definido, la fecha de
vencimiento de la OT se calcula con ese SLA; si la máquina no lo tiene definido,
se aplica el parámetro general de la planta.

## 2. ¿Qué es el costo de inactividad por minuto?

El **costo de inactividad por minuto** estima lo que cuesta al negocio cada minuto
con la máquina detenida: producción no hecha, horas-hombre ociosas, retrabajo y
multas. BARB lo usa para:

1. priorizar las OT y las decisiones de mantenimiento;
2. estimar el impacto económico de un incidente en los reportes;
3. comparar costo de parada contra costo de prevención en el análisis
  costo–beneficio del activo.

Ejemplos de referencia en la planta San Bernardo: una bomba del circuito hidráulico
que abastece a toda la línea tiene costo por minuto alto; un equipo de respaldo con
redundancia, costo bajo.

## 3. ¿Quién puede cambiar SLA y costo?

En BARB solo los roles con permiso de gestión del mantenedor (gerente o
administrador) actualizan estos parámetros. Tanto por la página (botón **Editar**
de la máquina) como por el chat: el asistente **propone** el cambio y el cambio
real solo ocurre si el usuario confirma explícitamente el «sí» — sin confirmación
no se escribe nada en la base de datos.

## 4. Kit de repuestos y su relación con el SLA

El **kit de repuestos** es el conjunto mínimo de repuestos y consumibles en bodega
para atender la falla más probable de cada equipo sin esperar la compra (ver los
manuales de cada máquina). Política BARB:

- todo equipo con SLA definido debe tener su kit mínimo disponible en bodega;
- cada OT registra los repuestos usados para alimentar el control de inventario;
- si una OT no puede arrancar por falta de repuesto del kit, se marca la causa
  de la espera y ese tiempo **no cuenta contra el SLA de la máquina**.

## 5. Preguntas que el chat IA puede responder con esta base

- «¿Qué es el SLA del Pump E4?» «Cambia el SLA del Pump E4 a 8 horas» (propone y
  pide confirmación).
- «¿Qué kit de repuestos lleva la PRESS-B3?»
- «¿Qué chequea el mantenimiento de 500 h del compresor?» (ver manual del COMP-A1).

---

*Documento de muestra del proyecto BARB: define el vocabulario de gestión (SLA,
costo por minuto, kit de repuestos) usado por los demás documentos de la base.*
