# Guía técnica — Equipos eléctricos: Motor Drive D1 (MOTOR-D1) y Generador de Respaldo G1 (GEN-G1)

**Máquinas cubiertas:** Motor Drive D1 (MOTOR-D1) · Generador de Respaldo G1 (GEN-G1)
**Disciplina:** Eléctrica · **Ubicación:** Planta Central San Bernardo · **Empresa:** Planta Demo BARB

## 1. Alcance

Guía de mantenimiento eléctrico de los dos equipos de fuerza de la planta San
Bernardo: el motor–variador de frecuencia de la línea (**Motor Drive D1,
MOTOR-D1**) y el grupo electrógeno de respaldo (**Generador de Respaldo G1,
GEN-G1**).

## 2. Motor Drive D1 (MOTOR-D1)

Motor trifásico de inducción (IE3) con variador de frecuencia (VFD) para el drive
principal de la línea:

| Tarea | Cada | Detalle |
|-------|------|---------|
| Termografía de tablero y bornes | 500 h de operación | Cámara IR: ΔT > 15 K sobre ambiente = investigación. |
| Engrase de rodamientos del motor | 3.000 h de operación | 2 inyecciones de grasa poli-urea; purga del excedente por el otro tapón. |
| medición de aislamiento (megado) | 6.000 h de operación | Medir a 500 V DC: > 1 MΩ correcto; si < 0.5 MΩ, secado o reparación de bobinado. |
| Limpieza de disipadores del VFD | 3.000 h de operación | Aire comprimido seco; revisar ventiladores y filtro del gabinete. |
| Chequeo de parámetros del VFD | 1.000 h de operación | Corriente, torque, eventos y contador de horas; registrar en bitácora. |

**Fallas frecuentes:** sobrecorriente por rotor bloqueado (freno mecánico de la
línea agarrotado), sobretemperatura del disipador del VFD por suciedad, disparo
por sub-tensión con las variaciones de la red. Arrancar solo con la carga
desacoplada para verificación del sentido de giro.

## 3. Generador de Respaldo G1 (GEN-G1)

Grupo electrógeno diésel de emergencia (categoría standby) para cargas esenciales:

| Tarea | Cada | Detalle |
|-------|------|---------|
| Prueba de arranque sin carga | semanal (automática) | El arranque automático corre 15 min; revisar registro de alarmas. |
| Chequeo de refrigerante, aceite y combustible | mensual | Nivel y estado; muestra del refrigerante a laboratorio cada semestre. |
| Cambio de aceite y filtros | 250 h operadas o 1 año | Aceite 15W-40 de motor diésel; filtros de aceite, combustible y aire. |
| Prueba con carga real (banco) | anual | 2 h escalonadas al 50/75/100% aplicando transferencia real de la red. |
| Baterías y cargador | mensual | Tensión en circuito abierto ≥ 12.6 V; limpieza de bornas y vaselina. |

**Fallas frecuentes:** no arranca por batería descargada, hongos en el combustible
por diésel viejo (aplicar biocida y renovar), sobrecarga térmica por radiador
obstruido. Mantener al día el contador de horas de operación para el cronograma
de cambios.

**Combustible:** mantener el depósito al nivel mínimo del plan de contingencia
(2 días de operación standby al 100%).

## 4. Seguridad eléctrica

Trabajos solo de eléctricos habilitados (protección contra arco eléctrico: EPP clase 2).
LOTO en el tablero de fuerza y verificación de ausencia de tensión (5 reglas de
oro). El GEN-G1 debe quedar **desacoplado** de la red (transferencia abierta) antes
de cualquier trabajo en el tablero general — riesgo de retroalimentación.

---

*Documento de muestra del proyecto BARB para poblar la base de conocimiento (RAG).*
