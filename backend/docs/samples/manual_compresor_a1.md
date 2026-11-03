# Manual de mantenimiento — Compressor A1 (COMP-A1)

**Máquina:** Compressor A1 · **Código:** COMP-A1 · **Disciplina:** Mecánica
**Ubicación:** Planta Central San Bernardo · **Empresa:** Planta Demo BARB

## 1. Descripción del equipo

El **Compressor A1 (COMP-A1)** es un compresor de tornillo rotativo de inyección de
aceite que entrega aire comprimido a la línea de producción de la planta San
Bernardo. Trabaja a 100 psi de presión de línea nominal y define el intervalo de
referencia del plan preventivo de compresores de la empresa.

> Nota BARB: el SLA y el costo de inactividad por minuto del COMP-A1 se definen en el
> mantenedor de máquinas, no en este manual. Este documento cubre el plan de
> mantenimiento y los procedimientos técnicos.

## 2. Plan de mantenimiento preventivo

| Tarea | Cada | Detalle |
|-------|------|---------|
| Inspección visual y audición | 8 h de operación | Ruidos anómalos en el tornillo, vibración, fugas de aire en racores. |
| Revisión de nivel de aceite | 40 h de operación | Nivel entre MIN y MAX del visor; completar solo con aceite del fabricante. |
| Limpieza del prefiltro y filtro de aire | 500 h de operación | Sustituir el elemento filtrante si ΔP > 5 psi (kit BP-FILT-A1). |
| Separador de aceite y filtro de aceite | 2.000 h de operación | Cambio completo; anotar el remanente de aceite en el kit de repuestos. |
| Servicio mayor (tornillo y rodamientos) | 8.000 h de operación | Lo ejecuta servicio externo; previa orden de parada. La referencia
histórica del plan es el chequeo de **500 h** para filtros y purga. |

## 3. Fallas frecuentes

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| Caudal menor al requerido | Filtro de aire saturado o fuga en la red | Chequear ΔP del filtro; purgar condensados; reapretar racores (usar solución jabonosa para detectar fugas). |
| Temperatura de aceite alta | Radiador obstruído o aceite degradado | Limpieza del radiador con aire; si > 105 °C, parada correctiva. |
| Arranques cortos por presión | Presostato descalibrado | Re-calibrar cut-off 100 psi / cut-in 85 psi. |
| Trip de sobrecarga térmica del motor | Acoplamiento desalineado | Alineación láser del acoplamiento motor–tornillo. |

## 4. Procedimiento de parada segura (para OT correctiva)

1. Aviso de parada al jefe de planta de San Bernardo y apertura de OT en BARB.
2. Descargar presión del depósito (0 psi en el manómetro antes de abrir tapas).
3. Seccionar el disyuntor de fuerza del tablero del COMP-A1 y candado LOTO.
4. Repuesto según tabla de la sección 3; verificar disponibilidad del kit
   de repuestos antes de arrancar el trabajo (ver §5).

## 5. Kit de repuestos mínimo en bodega

- Filtro de aire (2 unidades) · filtro de aceite (1) · kit separador (1)
- Aceite sintético específico del fabricante (20 L)
- Juego de racores y mangueras hidráulicas/aire estándar 3/8" y 1/2"
- Sondas de temperatura tipo K y presión 0–160 psi (instrumental calibrado)

## 6. Seguridad

Solo técnicos mecánicos con formación LOTO habilitada. El tanque de aire opera con
presión — nunca abrir tapas con el sistema cargado. Trabajo en altura no aplica;
riesgo eléctrico de tablero de fuerza 380 V trifásico.

---

*Documento de muestra del proyecto BARB para poblar la base de conocimiento (RAG).
Valores de SLA y costo por minuto: ver mantenedor de máquinas en BARB, no aquí.*
